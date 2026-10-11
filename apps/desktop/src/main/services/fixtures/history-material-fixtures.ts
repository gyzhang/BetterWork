import type { MaterialReference } from '@betterwork/agent-protocol';

import type { AppStore } from '../../persistence';

/** 对照保留原逐引用读取，不去重，也不把列表身份当作可用性证明。 */
export const legacyMaterialAvailability = (
  store: AppStore,
  references: readonly MaterialReference[],
): boolean[] =>
  references.map((reference) => {
    switch (reference.kind) {
      case 'knowledge-revision':
        return reference.sourcePath.trim().length > 0;
      case 'artifact-version':
        return store.artifacts.getVersionDetail(reference.artifactVersionId) !== undefined;
      case 'workspace-input-snapshot':
        return store.inputSnapshots.get(reference.snapshotId) !== undefined;
    }
  });

export const seedHistoryMaterials = (
  store: AppStore,
  input: { taskId: string; sessionId: string; workspaceId: string; index: number },
): MaterialReference[] => {
  const runId = `material-source-${input.index}`;
  store.runs.create({
    id: runId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    prompt: 'source',
    status: 'cancelled',
    createdAt: -2,
    completedAt: -1,
  });
  for (let index = 0; index < 3; index += 1)
    store.evidence.saveLocal({
      taskId: input.taskId,
      runId,
      sourceUri: `/tmp/source-${input.index}-${index}.md`,
      title: `source ${index}`,
      locator: 'whole',
      excerpt: 'evidence '.repeat(200),
      contentHash: 'a'.repeat(64),
    });
  const markdown = store.artifacts.saveMarkdown({
    taskId: input.taskId,
    origin: 'assistant-run',
    runId,
    title: 'markdown',
    content: '# material\n'.repeat(800),
  });
  const file = store.artifacts.registerFile({
    taskId: input.taskId,
    runId,
    title: 'presentation',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    fileSize: 1_024,
    fileHash: 'b'.repeat(64),
    fileKey: `material-${input.index}.pptx`,
    executionId: `execution-${input.index}`,
    description: 'file description',
    validation: { structure: 'passed', visual: 'not-checked', manualEdit: 'not-checked' },
  });
  const snapshot = store.inputSnapshots.createPreparing({
    workspaceId: input.workspaceId,
    sourcePath: `/tmp/input-${input.index}.txt`,
    contentHash: 'c'.repeat(64),
    byteSize: 512,
    format: 'text',
    fileKey: `input-${input.index}.txt`,
    createdAt: input.index,
  });
  store.inputSnapshots.markReady(snapshot.id, input.index + 1);
  const detail = store.artifacts.getVersionDetail(markdown.currentVersionId);
  if (detail?.type !== 'markdown') throw new Error('Missing fixture markdown version');
  return [
    {
      kind: 'artifact-version',
      artifactId: markdown.id,
      artifactVersionId: markdown.currentVersionId,
      contentHash: detail.contentHash,
      originWorkspaceId: input.workspaceId,
    },
    {
      kind: 'artifact-version',
      artifactId: file.artifactId,
      artifactVersionId: file.versionId,
      contentHash: file.fileHash,
      originWorkspaceId: input.workspaceId,
    },
    {
      kind: 'workspace-input-snapshot',
      snapshotId: snapshot.id,
      workspaceId: input.workspaceId,
      contentHash: snapshot.contentHash,
      format: snapshot.format,
      fileKey: snapshot.fileKey,
    },
    {
      kind: 'knowledge-revision',
      knowledgeDocumentId: `document-${input.index}`,
      knowledgeRevisionId: `revision-${input.index}`,
      contentHash: 'd'.repeat(64),
      sourcePath: `/tmp/knowledge-${input.index}.md`,
    },
  ];
};
