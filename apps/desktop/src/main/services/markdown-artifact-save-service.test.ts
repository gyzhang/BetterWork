import { randomUUID } from 'node:crypto';

import type {
  KnowledgeEvidenceSource,
  KnowledgeMaterialReference,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { MarkdownArtifactSaveService } from './markdown-artifact-save-service';

const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});

describe('MarkdownArtifactSaveService', () => {
  it('keeps Run Evidence on the assistant version and inherits it into a user edit', () => {
    const store = AppStore.open(':memory:');
    cleanup.push(() => store.close());

    const workspace = store.workspaces.getOrCreate('/tmp/artifact-save', 'Artifact save');
    const created = store.tasks.create(workspace.id, 'Report', 'Create a report');
    const runId = randomUUID();
    store.runs.create({
      id: runId,
      taskId: created.task.id,
      sessionId: created.sessionId,
      prompt: 'Create a report',
      status: 'completed',
      createdAt: Date.now(),
    });
    const reference: KnowledgeMaterialReference = {
      kind: 'knowledge-revision',
      knowledgeDocumentId: randomUUID(),
      knowledgeRevisionId: randomUUID(),
      contentHash: 'a'.repeat(64),
      sourcePath: '/vault/source.md',
    };
    const knowledgeSource: KnowledgeEvidenceSource = {
      reference,
      textHash: 'b'.repeat(64),
      span: { sectionOrdinal: 0, start: 0, end: 12 },
      operation: 'search',
    };
    const evidence = store.evidence.saveKnowledge({
      taskId: created.task.id,
      runId,
      sourceUri: reference.sourcePath,
      title: 'Source',
      locator: 'Section 1',
      excerpt: 'Source excerpt',
      contentHash: 'a'.repeat(64),
      knowledgeSource,
    });

    const service = new MarkdownArtifactSaveService(store);
    const assistantArtifact = service.save({
      taskId: created.task.id,
      origin: 'assistant-run',
      runId,
      title: 'Report',
      content: '# Report',
      inputRelations: [
        { input: { kind: 'evidence', evidenceId: evidence.id }, relation: 'background' },
      ],
    });
    if (assistantArtifact.type !== 'markdown') throw new Error('Expected Markdown artifact');

    const assistantVersion = store.artifacts.getVersionDetail(assistantArtifact.currentVersionId);
    if (!assistantVersion || assistantVersion.type !== 'markdown') {
      throw new Error('Expected saved Markdown version');
    }
    expect(assistantVersion.evidence).toHaveLength(1);
    expect(assistantVersion.evidence[0]?.runId).toBe(runId);
    const assistantRelations = store.artifactInputRelations.listByVersion(
      assistantArtifact.currentVersionId,
    );
    expect(assistantRelations).toHaveLength(1);
    expect(assistantRelations[0]?.input).toEqual({ kind: 'evidence', evidenceId: evidence.id });

    const userArtifact = service.save({
      artifactId: assistantArtifact.id,
      taskId: created.task.id,
      origin: 'user-edit',
      title: 'Report',
      content: '# Report\n\nUser edit',
    });
    if (userArtifact.type !== 'markdown') throw new Error('Expected Markdown artifact');

    const userVersion = store.artifacts.getVersionDetail(userArtifact.currentVersionId);
    if (!userVersion || userVersion.type !== 'markdown') {
      throw new Error('Expected edited Markdown version');
    }
    expect(userVersion.origin).toBe('user-edit');
    expect(userVersion.evidence.map((item) => item.id)).toEqual(
      assistantVersion.evidence.map((item) => item.id),
    );
    const userRelations = store.artifactInputRelations.listByVersion(userArtifact.currentVersionId);
    expect(userRelations).toHaveLength(1);
    expect(userRelations[0]?.input).toEqual(assistantRelations[0]?.input);
    expect(userRelations[0]?.relation).toBe(assistantRelations[0]?.relation);
  });
});
