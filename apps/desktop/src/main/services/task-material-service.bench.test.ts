import type Database from 'better-sqlite3';
import { expect, it, vi } from 'vitest';

import { createMaterialCandidateFixture } from './fixtures/material-candidate-fixture';

it('projects complete material candidates without repeated body and asset reads', async () => {
  const f = await createMaterialCandidateFixture({
    documents: 20,
    revisions: 3,
    artifacts: 20,
    versions: 6,
    assets: 12,
    snapshotsPerAsset: 10,
    bodyBytes: 64 * 1024,
    assetBytes: 1024 * 1024,
  });
  const metrics = { queries: 0, rows: 0, bodyBytes: 0, assetChecks: 0, assetBytes: 0 };
  const recordRows = (value: unknown): void => {
    const rows = Array.isArray(value) ? value : value ? [value] : [];
    metrics.rows += rows.length;
    for (const row of rows) {
      if (typeof row.content === 'string') metrics.bodyBytes += Buffer.byteLength(row.content);
    }
  };
  const instrument = (db: Database.Database): void => {
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      metrics.queries++;
      const statement = prepare(sql);
      const all = statement.all.bind(statement);
      const get = statement.get.bind(statement);
      vi.spyOn(statement, 'all').mockImplementation((...args) => {
        const rows = all(...args);
        recordRows(rows);
        return rows;
      });
      vi.spyOn(statement, 'get').mockImplementation((...args) => {
        const row = get(...args);
        recordRows(row);
        return row;
      });
      return statement;
    });
  };
  try {
    instrument((f.store as unknown as { db: Database.Database }).db);
    instrument((f.vault as unknown as { db: Database.Database }).db);
    const verify = f.inputSnapshots.verify.bind(f.inputSnapshots);
    vi.spyOn(f.inputSnapshots, 'verify').mockImplementation((snapshot) => {
      metrics.assetChecks++;
      metrics.assetBytes += snapshot.byteSize;
      return verify(snapshot);
    });
    const started = performance.now();
    const candidates = await f.service.listCandidatesForWorkspace(f.workspaceId);
    const elapsedMs = performance.now() - started;
    console.warn(
      `[material candidates] ${JSON.stringify(metrics)}; elapsed=${elapsedMs.toFixed(2)}ms\n`,
    );
    expect(candidates).toHaveLength(300);
    expect(candidates.every((candidate) => candidate.status === 'ready')).toBe(true);
    expect(metrics.queries).toBe(4);
    expect(metrics.rows).toBe(301);
    expect(metrics.bodyBytes).toBe(0);
    expect(metrics.assetChecks).toBe(12);
    expect(metrics.assetBytes).toBe(12 * 1024 * 1024);
  } finally {
    vi.restoreAllMocks();
    f.close();
  }
});
