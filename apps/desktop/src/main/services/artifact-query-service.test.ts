import { randomUUID } from 'node:crypto';

import type {
  KnowledgeEvidenceSource,
  KnowledgeMaterialReference,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { ArtifactQueryService } from './artifact-query-service';

const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});

describe('ArtifactQueryService', () => {
  it('joins input relations into Markdown artifact and version details', () => {
    const store = AppStore.open(':memory:');
    cleanup.push(() => store.close());
    const workspace = store.workspaces.getOrCreate('/tmp/artifact-query', 'Artifact query');
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
      contentHash: reference.contentHash,
      knowledgeSource,
    });
    const markdown = store.artifacts.saveMarkdown(
      {
        taskId: created.task.id,
        origin: 'assistant-run',
        runId,
        title: 'Report',
        content: '# Report',
      },
      'model',
    );
    if (markdown.type !== 'markdown') throw new Error('Expected Markdown artifact');
    store.artifactInputRelations.saveForRun(
      markdown.currentVersionId,
      runId,
      [{ input: { kind: 'evidence', evidenceId: evidence.id }, relation: 'background' }],
      () => true,
    );

    const queries = new ArtifactQueryService(store);
    const artifactDetail = queries.getArtifact(markdown.id);
    if (!artifactDetail || artifactDetail.type !== 'markdown') {
      throw new Error('Expected Markdown artifact detail');
    }
    expect(artifactDetail.evidence.map((item) => item.id)).toEqual([evidence.id]);
    expect(artifactDetail.inputRelations).toHaveLength(1);

    const versionDetail = queries.getArtifactVersion(markdown.currentVersionId);
    if (!versionDetail || versionDetail.type !== 'markdown') {
      throw new Error('Expected Markdown artifact version detail');
    }
    expect(versionDetail.inputRelations).toEqual(artifactDetail.inputRelations);
    expect(queries.getArtifact(randomUUID())).toBeNull();
    expect(queries.getArtifactVersion(randomUUID())).toBeNull();
  });

  it('returns file details only for a presentation and a version owned by it', () => {
    const store = AppStore.open(':memory:');
    cleanup.push(() => store.close());
    const workspace = store.workspaces.getOrCreate('/tmp/artifact-file-query', 'File query');
    const created = store.tasks.create(workspace.id, 'Slides', 'Create slides');
    const runId = randomUUID();
    store.runs.create({
      id: runId,
      taskId: created.task.id,
      sessionId: created.sessionId,
      prompt: 'Create slides',
      status: 'completed',
      createdAt: Date.now(),
    });
    const reference: KnowledgeMaterialReference = {
      kind: 'knowledge-revision',
      knowledgeDocumentId: randomUUID(),
      knowledgeRevisionId: randomUUID(),
      contentHash: 'a'.repeat(64),
      sourcePath: '/vault/slides-source.md',
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
      title: 'Slides source',
      locator: 'Section 1',
      excerpt: 'Slides source excerpt',
      contentHash: reference.contentHash,
      knowledgeSource,
    });
    const file = store.artifacts.registerFile({
      taskId: created.task.id,
      title: 'Slides',
      runId,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      fileSize: 128,
      fileHash: 'c'.repeat(64),
      fileKey: `${randomUUID()}/slides.pptx`,
      executionId: randomUUID(),
      validation: { structure: 'passed', visual: 'not-checked', manualEdit: 'not-checked' },
    });
    const markdown = store.artifacts.saveMarkdown({
      taskId: created.task.id,
      origin: 'assistant-run',
      runId,
      title: 'Notes',
      content: '# Notes',
    });
    const queries = new ArtifactQueryService(store);

    const current = queries.getFileArtifact(file.artifactId);
    if (!current) throw new Error('Expected current file artifact detail');
    expect(current.currentVersionId).toBe(file.versionId);
    expect(current.fileHash).toBe('c'.repeat(64));
    expect(current.inputRelations).toBeUndefined();

    const selected = queries.getFileArtifact(file.artifactId, file.versionId);
    if (!selected) throw new Error('Expected selected file artifact detail');
    expect(selected.fileKey).toBe(file.fileKey);
    expect(selected.evidence.map((item) => item.id)).toEqual([evidence.id]);
    expect(queries.getFileArtifact(file.artifactId, markdown.currentVersionId)).toBeNull();
    expect(queries.getFileArtifact(markdown.id)).toBeNull();
    expect(queries.getFileArtifact(randomUUID())).toBeNull();
  });
});
