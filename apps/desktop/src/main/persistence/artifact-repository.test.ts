import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { seedHistoryMaterials } from '../services/fixtures/history-material-fixtures';
import { AppStore } from './index';

const stores: AppStore[] = [];
const setup = () => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  const workspaceId = store.workspaces.getOrCreate('/tmp/version-batch-test', 'versions').id;
  const task = store.tasks.create(workspaceId, 'versions', 'versions');
  const refs = seedHistoryMaterials(store, {
    taskId: task.task.id,
    sessionId: task.sessionId,
    workspaceId,
    index: 0,
  });
  const versionIds = refs.flatMap((ref) =>
    ref.kind === 'artifact-version' ? [ref.artifactVersionId] : [],
  );
  const db = (store as unknown as { db: Database.Database }).db;
  return { store, db, versionIds, taskId: task.task.id };
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});

describe('Artifact version detail batches', () => {
  it('matches complete Markdown and presentation details, request order and tied evidence order', () => {
    const { store, db, versionIds } = setup();
    db.prepare('UPDATE evidence SET captured_at = 10').run();
    const ids = [versionIds[1]!, 'missing', versionIds[0]!, versionIds[1]!];
    const expected = [...new Set(ids)].flatMap((id) => {
      const detail = store.artifacts.getVersionDetail(id);
      return detail === undefined ? [] : [detail];
    });
    expect(expected.map((detail) => detail.type)).toEqual(['presentation', 'markdown']);
    expect(expected[0]).toMatchObject({ description: 'file description', fileSize: 1_024 });
    expect(expected[1]).toMatchObject({ content: '# material\n'.repeat(800) });
    expect(expected[0]!.evidence.map((evidence) => evidence.title)).toEqual([
      'source 2',
      'source 1',
      'source 0',
    ]);
    const get = vi.spyOn(store.artifacts, 'getVersionDetail');
    const prepare = vi.spyOn(db, 'prepare');
    expect(store.artifacts.listVersionDetails(ids)).toEqual(expected);
    expect(get).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(store.artifacts.listVersionDetails([])).toEqual([]);
    expect(prepare).toHaveBeenCalledTimes(3);
  });

  it('keeps exact historical versions after a new latest version is saved', () => {
    const { store, versionIds, taskId } = setup();
    const old = store.artifacts.getVersionDetail(versionIds[0]!)!;
    const revised = store.artifacts.saveMarkdown({
      artifactId: old.artifactId,
      taskId,
      title: 'new version',
      content: 'new body',
      origin: 'user-edit',
    });
    expect(revised.currentVersionId).not.toBe(old.id);
    expect(store.artifacts.listVersionDetails([old.id])).toEqual([old]);
  });

  it('omits an unreadable file version and does not decode its unused corrupt evidence', () => {
    const { store, db, versionIds } = setup();
    const id = versionIds[1]!;
    db.prepare('DELETE FROM artifact_files WHERE version_id = ?').run(id);
    db.prepare('DELETE FROM artifact_version_evidence WHERE version_id = ?').run(versionIds[0]);
    db.prepare('UPDATE evidence SET knowledge_source_json = ?').run('{}');
    expect(store.artifacts.getVersionDetail(id)).toBeUndefined();
    expect(store.artifacts.listVersionDetails([id])).toEqual([]);
  });

  it.each(['{', '{}'])('rejects the same corrupt Evidence as the point decoder (%s)', (json) => {
    const { store, db, versionIds } = setup();
    db.prepare('UPDATE evidence SET knowledge_source_json = ?').run(json);
    for (const id of versionIds) {
      expect(() => store.artifacts.getVersionDetail(id)).toThrow();
      expect(() => store.artifacts.listVersionDetails([id])).toThrow();
    }
    expect(store.artifacts.listVersionDetails(['missing'])).toEqual([]);
  });

  it('uses the whole bound request with more than 999 exact IDs and no global cap', () => {
    const { store, db, versionIds } = setup();
    const ids = Array.from({ length: 1_050 }, (_, index) => `version-'${index}-材料`);
    store.transaction(() => {
      for (const [index, id] of ids.entries())
        db.prepare(
          `INSERT INTO artifact_versions (id, artifact_id, version_number, content, content_hash,
             source_run_id, origin, created_at, source_declaration)
           SELECT ?, artifact_id, ?, '', content_hash, '', 'user-edit', 1, 'none'
             FROM artifact_versions WHERE id = ?`,
        ).run(id, index + 10, versionIds[0]);
    });
    ids.reverse();
    const details = store.artifacts.listVersionDetails(ids);
    expect(details.map((detail) => detail.id)).toEqual(ids);
    expect(details[0]).toMatchObject({ type: 'markdown', content: '', evidence: [] });
  });
});
