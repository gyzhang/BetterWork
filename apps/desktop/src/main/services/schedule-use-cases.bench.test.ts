import { expect, it } from 'vitest';

import {
  createScheduleUseCaseFixture,
  dispatchFixtureOccurrence,
} from './fixtures/schedule-use-case-fixture';

it('projects first-Run artifacts among 3,200 unrelated versions without decoding their metadata', () => {
  const f = createScheduleUseCaseFixture();
  try {
    const first = dispatchFixtureOccurrence(f);
    f.store.runs.create({
      id: 'followup',
      taskId: first.draft.task.id,
      sessionId: first.draft.sessionId,
      prompt: 'synthetic followup',
      status: 'running',
      createdAt: f.now + 5,
    });
    const input = {
      kind: 'knowledge-revision' as const,
      knowledgeDocumentId: 'doc',
      knowledgeRevisionId: 'revision',
      contentHash: 'hash',
      sourcePath: '/tmp/fixture.md',
    };
    f.store.transaction(() => {
      for (let index = 0; index < 3; index++) {
        const artifact = f.store.artifacts.saveMarkdown({
          taskId: first.draft.task.id,
          runId: first.runId,
          origin: 'assistant-run',
          title: `target-${index}`,
          content: 'target body',
        });
        f.store.artifactInputRelations.saveForRun(
          artifact.currentVersionId,
          first.runId,
          [{ input, relation: 'data' }],
          () => true,
        );
      }
      for (let index = 0; index < 400; index++) {
        let artifactId: string | undefined;
        for (let version = 0; version < 8; version++) {
          const artifact = f.store.artifacts.saveMarkdown({
            ...(artifactId ? { artifactId } : {}),
            taskId: first.draft.task.id,
            runId: 'followup',
            origin: 'assistant-run',
            title: `unrelated-${index}`,
            content: 'x'.repeat(2_000),
          });
          artifactId = artifact.id;
        }
      }
    });
    let legacyVersionRows = 0;
    const legacyStarted = performance.now();
    const legacyRelations = f.store.artifacts.list(first.draft.task.id).flatMap((artifact) => {
      const versions = f.store.artifacts.listVersions(artifact.id);
      legacyVersionRows += versions.length;
      return versions
        .filter((version) => version.sourceRunId === first.runId)
        .flatMap((version) => f.store.artifactInputRelations.listByVersion(version.id));
    });
    const legacyMs = performance.now() - legacyStarted;
    const started = performance.now();
    const versions = f.store.artifacts.listVersionsBySourceRun(first.draft.task.id, first.runId);
    const relations = f.store.artifactInputRelations.listBySourceRun(
      first.draft.task.id,
      first.runId,
    );
    const elapsedMs = performance.now() - started;
    console.warn(
      `[schedule projection] artifacts=403; versions=${legacyVersionRows}->${versions.length}; relations=${relations.length}; bodyBytes=0; legacy=${legacyMs.toFixed(2)}ms; scoped=${elapsedMs.toFixed(2)}ms`,
    );
    // 2026-10-10 macOS/arm64 首轮投影 0.89ms；预算只放在串行 bench 车道。
    expect(elapsedMs).toBeLessThan(50);
    expect(legacyVersionRows).toBe(3_203);
    expect(versions).toHaveLength(3);
    expect(
      [...relations].sort((a, b) => a.outputVersionId.localeCompare(b.outputVersionId)),
    ).toEqual(
      [...legacyRelations].sort((a, b) => a.outputVersionId.localeCompare(b.outputVersionId)),
    );
    expect(versions.every((version) => !('content' in version))).toBe(true);
    expect(f.queries.getOccurrence(first.occurrenceId).adoptedMaterialCount).toBe(1);
  } finally {
    f.store.close();
  }
});
