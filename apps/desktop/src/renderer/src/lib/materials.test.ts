import type {
  MaterialCandidate,
  MaterialReference,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import { materialListIdentity } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import {
  materialCandidateAppliesToWorkspace,
  materialCandidateKey,
  materialReferenceAppliesToWorkspace,
  taskMaterialKey,
} from './materials';

const knowledge = (revisionId: string): MaterialReference => ({
  kind: 'knowledge-revision',
  knowledgeDocumentId: 'doc-1',
  knowledgeRevisionId: revisionId,
  contentHash: 'hash-1',
  sourcePath: '/notes/a.md',
});

const artifactVersion = (versionId: string, originWorkspaceId: string): MaterialReference => ({
  kind: 'artifact-version',
  artifactId: 'art-1',
  artifactVersionId: versionId,
  contentHash: 'hash-1',
  originWorkspaceId,
});

const inputSnapshot = (snapshotId: string): MaterialReference => ({
  kind: 'workspace-input-snapshot',
  snapshotId,
  workspaceId: 'ws-1',
  contentHash: 'hash-1',
  format: 'markdown',
  fileKey: 'budget.csv',
});

const selection = (reference: MaterialReference): TaskMaterialSelection => ({
  reference,
  purpose: 'background',
  addedFrom: 'global-search',
});

const candidate = (reference: MaterialReference): MaterialCandidate => ({
  reference,
  title: '候选材料',
  sourceLabel: '本地资料',
  status: 'ready',
});

describe('materialListIdentity', () => {
  it('keys each reference kind by the identity that makes it the same material', () => {
    expect(materialListIdentity(knowledge('rev-1'))).toBe('knowledge-revision:rev-1');
    expect(materialListIdentity(artifactVersion('ver-2', 'ws-1'))).toBe('artifact-version:ver-2');
    expect(materialListIdentity(inputSnapshot('snap-3'))).toBe('workspace-input-snapshot:snap-3');
  });

  it('collapses repeated picks of one exact version into a single key', () => {
    const again = { ...knowledge('rev-1'), sourcePath: '/renamed/a.md' };
    expect(materialListIdentity(again)).toBe(materialListIdentity(knowledge('rev-1')));
    expect(materialListIdentity(artifactVersion('ver-2', 'ws-9'))).toBe(
      materialListIdentity(artifactVersion('ver-2', 'ws-1')),
    );
    expect(materialListIdentity(knowledge('rev-2'))).not.toBe(
      materialListIdentity(knowledge('rev-1')),
    );
  });

  it('gives selections and candidates the same key as their reference', () => {
    expect(taskMaterialKey(selection(knowledge('rev-1')))).toBe('knowledge-revision:rev-1');
    expect(materialCandidateKey(candidate(knowledge('rev-1')))).toBe('knowledge-revision:rev-1');
    // 去重跨两种载体成立：已选材料与候选列表比较时必须是同一个口径。
    expect(materialCandidateKey(candidate(knowledge('rev-1')))).toBe(
      taskMaterialKey(selection(knowledge('rev-1'))),
    );
  });
});

describe('materialReferenceAppliesToWorkspace', () => {
  it('restricts artifact versions to the workspace that produced them', () => {
    expect(materialReferenceAppliesToWorkspace(artifactVersion('ver-2', 'ws-1'), 'ws-1')).toBe(
      true,
    );
    expect(materialReferenceAppliesToWorkspace(artifactVersion('ver-2', 'ws-1'), 'ws-2')).toBe(
      false,
    );
    expect(materialReferenceAppliesToWorkspace(artifactVersion('ver-2', 'ws-1'), undefined)).toBe(
      false,
    );
  });

  it('lets knowledge revisions and input snapshots cross workspaces', () => {
    expect(materialReferenceAppliesToWorkspace(knowledge('rev-1'), 'ws-2')).toBe(true);
    expect(materialReferenceAppliesToWorkspace(inputSnapshot('snap-1'), undefined)).toBe(true);
  });

  it('judges a candidate by its own reference', () => {
    expect(
      materialCandidateAppliesToWorkspace(candidate(artifactVersion('ver-2', 'ws-1')), 'ws-1'),
    ).toBe(true);
    expect(
      materialCandidateAppliesToWorkspace(candidate(artifactVersion('ver-2', 'ws-1')), 'ws-2'),
    ).toBe(false);
  });
});
