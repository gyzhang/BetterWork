import type { MaterialReference } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { KnowledgeVault } from './knowledge-vault';
import { RunDiagnosticsSourcesService } from './run-diagnostics-sources';

const stores: AppStore[] = [];
const vaults: KnowledgeVault[] = [];
const open = () => {
  const store = AppStore.open(':memory:');
  const vault = new KnowledgeVault(':memory:');
  stores.push(store);
  vaults.push(vault);
  const workspace = store.workspaces.getOrCreate('/tmp/run-sources-workspace', 'Sources');
  const task = store.tasks.create(workspace.id, 'Source task', 'fixture');
  store.runs.create(
    {
      id: 'source-run',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'private prompt',
      status: 'completed',
      createdAt: 1,
    },
    { version: 1, sections: ['core'] },
  );
  return { store, vault, workspace, task };
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const vault of vaults.splice(0)) vault.close();
});

describe('RunDiagnosticsSourcesService', () => {
  it('keeps selected materials separate from read facts and omits bodies, paths, and file keys', () => {
    const { store, vault, workspace, task } = open();
    const contentHash = 'a'.repeat(64);
    store.inputSnapshots.createPreparing({
      id: 'input-snapshot',
      workspaceId: workspace.id,
      sourcePath: '/private/customer/plan.docx',
      contentHash,
      byteSize: 10,
      format: 'docx',
      fileKey: '/private/cache/secret-key',
      createdAt: 1,
    });
    store.inputSnapshots.markReady('input-snapshot', 2);
    const reference: MaterialReference = {
      kind: 'workspace-input-snapshot',
      snapshotId: 'input-snapshot',
      workspaceId: workspace.id,
      contentHash,
      format: 'docx',
      fileKey: '/private/cache/secret-key',
      sourcePath: '/private/customer/plan.docx',
    };
    store.runContextSnapshots.create({
      runId: 'source-run',
      taskId: task.task.id,
      workspaceId: workspace.id,
      contextSegmentId: 'segment-1',
      materials: [
        {
          reference,
          purpose: 'current-input',
          addedFrom: 'user-input',
        },
      ],
      createdAt: 3,
    });
    store.materialReads.save({
      id: 'search-only',
      runId: 'source-run',
      material: reference,
      operation: 'search',
      locator: 'private locator',
      contentHash,
      capturedAt: 4,
    });

    const result = new RunDiagnosticsSourcesService(store, vault).get({
      workspaceId: workspace.id,
      taskId: task.task.id,
      runId: 'source-run',
    });

    expect(result).toMatchObject({
      runId: 'source-run',
      integrity: 'complete',
      materials: {
        state: 'recorded',
        selected: [
          {
            reference: {
              kind: 'workspace-input-snapshot',
              snapshotId: 'input-snapshot',
              state: 'recorded',
            },
            wasRead: false,
          },
        ],
        reads: [{ id: 'search-only', operation: 'search' }],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('/private/customer/plan.docx');
    expect(serialized).not.toContain('/private/cache/secret-key');
    expect(serialized).not.toContain('private locator');
    expect(serialized).not.toContain('private prompt');

    store.materialReads.save({
      id: 'actual-read',
      runId: 'source-run',
      material: {
        kind: 'workspace-input-snapshot',
        snapshotId: 'input-snapshot',
        workspaceId: workspace.id,
        contentHash,
        format: 'docx',
        fileKey: '/private/cache/secret-key',
      },
      operation: 'read',
      contentHash,
      capturedAt: 5,
    });
    const afterRead = new RunDiagnosticsSourcesService(store, vault).get({
      workspaceId: workspace.id,
      taskId: task.task.id,
      runId: 'source-run',
    });
    expect(afterRead?.materials.selected[0]?.wasRead).toBe(true);
  });

  it('rejects forged cross-Workspace and cross-Run diagnostic scopes', () => {
    const { store, vault, workspace, task } = open();
    const service = new RunDiagnosticsSourcesService(store, vault);
    expect(
      service.get({
        workspaceId: 'another-workspace',
        taskId: task.task.id,
        runId: 'source-run',
      }),
    ).toBeUndefined();
    expect(
      service.get({
        workspaceId: workspace.id,
        taskId: 'another-task',
        runId: 'source-run',
      }),
    ).toBeUndefined();
  });

  it('resolves the exact selected ArtifactVersion after a newer version becomes current', () => {
    const { store, vault, workspace, task } = open();
    const original = store.artifacts.saveMarkdown({
      taskId: task.task.id,
      runId: 'source-run',
      title: 'Original title',
      content: 'private original body',
      origin: 'assistant-run',
    });
    const exact = store.artifacts.getMaterialVersion(original.currentVersionId);
    if (!exact) throw new Error('Original ArtifactVersion missing');
    store.runContextSnapshots.create({
      runId: 'source-run',
      taskId: task.task.id,
      workspaceId: workspace.id,
      contextSegmentId: 'artifact-source-context',
      materials: [
        {
          reference: {
            kind: 'artifact-version',
            artifactId: exact.artifactId,
            artifactVersionId: exact.id,
            contentHash: exact.contentHash,
            originWorkspaceId: exact.workspaceId,
          },
          purpose: 'background',
          addedFrom: 'user-input',
        },
      ],
      createdAt: 3,
    });
    store.artifacts.saveMarkdown({
      artifactId: original.id,
      taskId: task.task.id,
      title: 'Current title must not replace the source title',
      content: 'latest private body',
      origin: 'user-edit',
    });

    const result = new RunDiagnosticsSourcesService(store, vault).get({
      workspaceId: workspace.id,
      taskId: task.task.id,
      runId: 'source-run',
    });

    expect(result?.materials.selected[0]).toMatchObject({
      reference: {
        kind: 'artifact-version',
        artifactId: original.id,
        versionId: exact.id,
        versionNumber: 1,
        contentHash: exact.contentHash,
        state: 'recorded',
      },
      wasRead: false,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private original body');
    expect(serialized).not.toContain('latest private body');
    expect(serialized).not.toContain('Current title must not replace');
  });

  it('keeps the bound Skill revision and name after the Skill configuration changes', () => {
    const { store, vault, workspace, task } = open();
    store.skills.save({
      id: 'skill-source',
      name: 'Historical skill',
      description: 'old config',
      sourceKind: 'user',
      currentRevisionId: 'skill-revision-old',
    });
    const oldRevisionId = store.skills.saveRevision({
      id: 'skill-revision-old',
      skillId: 'skill-source',
      contentHash: 'old-revision-hash',
      resourceKey: 'user/skill-source/old',
      frontmatter: { name: 'Historical skill' },
    });
    const oldProfileId = store.skills.saveProfile({
      id: 'skill-profile-old',
      skillId: 'skill-source',
      profileHash: 'old-profile-hash',
      profile: { commands: [], environmentRequirements: [] },
    });
    const environment = store.environments.createEnvironment({
      id: 'skill-environment-old',
      environmentKey: 'skill-environment-old-key',
      base: {
        kind: 'managed',
        distributionId: 'cpython',
        version: '3.12.7',
        sha256: 'e'.repeat(64),
      },
      platform: { os: 'darwin', arch: 'arm64', abi: 'macos-15' },
      lockHash: 'f'.repeat(64),
      lock: {
        lockVersion: 1,
        platform: { os: 'darwin', arch: 'arm64', abi: 'macos-15' },
        pythonRequirement: '3.12',
        packages: [],
        importProbes: [],
      },
      pathKey: '/private/runtime/path',
    });
    store.skills.save({
      id: 'skill-source',
      name: 'Historical skill',
      description: 'old config',
      sourceKind: 'user',
      currentRevisionId: oldRevisionId,
      currentProfileRevisionId: oldProfileId,
    });
    const grantId = store.skills.saveTrustGrant({
      id: 'skill-grant-old',
      skillId: 'skill-source',
      revisionId: oldRevisionId,
      profileHash: 'old-profile-hash',
      dependencyFingerprint: 'old-dependencies',
      scopeHash: 'old-scope',
      source: 'user',
    });
    const dependency = store.snapshots.createSnapshot({
      id: 'dependency-snapshot-old',
      origin: '/private/toolchain/origin',
      originState: 'dirty',
      manifestHash: '9'.repeat(64),
      pathKey: '/private/toolchain/snapshot',
      fileCount: 1,
      totalBytes: 10,
      exclusions: [],
    });
    const binding = store.executions.createBinding({
      id: 'skill-binding-old',
      runId: 'source-run',
      skillRevisionId: oldRevisionId,
      profileRevisionId: oldProfileId,
      environmentId: environment.id,
      dependencySnapshotIds: [dependency.id],
      grantId,
    });
    store.runContextSnapshots.create({
      runId: 'source-run',
      taskId: task.task.id,
      workspaceId: workspace.id,
      contextSegmentId: 'skill-source-context',
      materials: [],
      createdAt: 3,
    });

    const latestRevisionId = store.skills.saveRevision({
      id: 'skill-revision-latest',
      skillId: 'skill-source',
      contentHash: 'latest-revision-hash',
      resourceKey: 'user/skill-source/latest',
      frontmatter: { name: 'Current skill name' },
    });
    const latestProfileId = store.skills.saveProfile({
      id: 'skill-profile-latest',
      skillId: 'skill-source',
      profileHash: 'latest-profile-hash',
      profile: { commands: [], environmentRequirements: [] },
    });
    store.skills.save({
      id: 'skill-source',
      name: 'Current skill name',
      description: 'new config',
      sourceKind: 'user',
      currentRevisionId: latestRevisionId,
      currentProfileRevisionId: latestProfileId,
    });

    const result = new RunDiagnosticsSourcesService(store, vault).get({
      workspaceId: workspace.id,
      taskId: task.task.id,
      runId: 'source-run',
    });

    expect(result?.fixedContext.skills).toMatchObject([
      {
        bindingId: binding.id,
        skillId: 'skill-source',
        skillRevisionId: oldRevisionId,
        profileRevisionId: oldProfileId,
        name: 'Historical skill',
        state: 'recorded',
        environment: {
          id: environment.id,
          state: 'recorded',
          status: 'unprepared',
          lockHash: 'f'.repeat(64),
          platform: { os: 'darwin', arch: 'arm64', abi: 'macos-15' },
        },
        dependencySnapshots: [
          {
            id: dependency.id,
            state: 'recorded',
            manifestHash: '9'.repeat(64),
          },
        ],
      },
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('Current skill name');
    expect(serialized).not.toContain('/private/runtime/path');
    expect(serialized).not.toContain('/private/toolchain');
  });

  it('marks a foreign Workspace input reference unavailable without exposing its path', () => {
    const { store, vault, workspace, task } = open();
    const foreign = store.workspaces.getOrCreate('/tmp/foreign-source-workspace', 'Foreign');
    const contentHash = 'c'.repeat(64);
    store.inputSnapshots.createPreparing({
      id: 'foreign-input',
      workspaceId: foreign.id,
      sourcePath: '/private/foreign/input.pdf',
      contentHash,
      byteSize: 12,
      format: 'pdf',
      fileKey: '/private/cache/foreign-key',
      createdAt: 1,
    });
    store.inputSnapshots.markReady('foreign-input', 2);
    store.runContextSnapshots.create({
      runId: 'source-run',
      taskId: task.task.id,
      workspaceId: workspace.id,
      contextSegmentId: 'forged-source-context',
      materials: [
        {
          reference: {
            kind: 'workspace-input-snapshot',
            snapshotId: 'foreign-input',
            workspaceId: foreign.id,
            contentHash,
            format: 'pdf',
            fileKey: '/private/cache/foreign-key',
            sourcePath: '/private/foreign/input.pdf',
          },
          purpose: 'background',
          addedFrom: 'user-input',
        },
      ],
      createdAt: 3,
    });

    const result = new RunDiagnosticsSourcesService(store, vault).get({
      workspaceId: workspace.id,
      taskId: task.task.id,
      runId: 'source-run',
    });

    expect(result?.materials).toMatchObject({
      state: 'unavailable',
      selected: [
        {
          reference: { state: 'unavailable', reason: 'scope-mismatch' },
          wasRead: false,
        },
      ],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('/private/foreign/input.pdf');
    expect(serialized).not.toContain('/private/cache/foreign-key');
  });

  it('does not invent fixed sources for a legacy Run without a context snapshot', () => {
    const { store, vault, workspace, task } = open();
    const result = new RunDiagnosticsSourcesService(store, vault).get({
      workspaceId: workspace.id,
      taskId: task.task.id,
      runId: 'source-run',
    });
    expect(result).toMatchObject({
      integrity: 'unavailable',
      fixedContext: { state: 'not-recorded', skills: [] },
      materials: { state: 'not-recorded', selected: [], reads: [] },
      continuity: { state: 'not-recorded', sourceRunIds: [], artifactVersionIds: [] },
    });
  });
});
