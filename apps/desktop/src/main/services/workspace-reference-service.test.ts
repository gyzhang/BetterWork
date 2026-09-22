import { createHash, randomUUID } from 'node:crypto';

import type { Result, SetWorkspaceReferenceVersionRequest } from '@betterwork/agent-protocol';
import { WORKSPACE_REFERENCE_ACTIVE_LIMIT } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { WorkspaceReferenceService } from './workspace-reference-service';

const sha = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

interface Fixture {
  workspaceId: string;
  taskId: string;
}

interface PinnedVersion {
  artifactId: string;
  versionId: string;
  contentHash: string;
}

interface Setup {
  store: AppStore;
  service: WorkspaceReferenceService;
  fixture: Fixture;
}

const stores: AppStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

const makeFixture = (store: AppStore, label: string): Fixture => {
  const workspaceId = store.workspaces.getOrCreate(
    `/tmp/workspace-reference-service/${label}`,
    label,
  ).id;
  return {
    workspaceId,
    taskId: store.tasks.create(workspaceId, label, '产出可参考的成果').task.id,
  };
};

const openStore = (label: string): Setup => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return {
    store,
    service: new WorkspaceReferenceService({ store }),
    fixture: makeFixture(store, label),
  };
};

const saveVersion = (store: AppStore, fixture: Fixture, seed: string): PinnedVersion => {
  const content = `第 ${seed} 版毛利口径说明。`;
  const artifact = store.artifacts.saveMarkdown({
    taskId: fixture.taskId,
    origin: 'user-edit',
    title: `成果 ${seed}`,
    content,
  });
  return {
    artifactId: artifact.id,
    versionId: artifact.currentVersionId,
    contentHash: sha(content),
  };
};

const setReference = (
  setup: Setup,
  version: PinnedVersion,
  overrides: {
    operationId?: string;
    expectedRevision?: number;
    label?: string;
    workspaceId?: string;
  } = {},
) => {
  const input: SetWorkspaceReferenceVersionRequest = {
    operationId: overrides.operationId ?? randomUUID(),
    workspaceId: overrides.workspaceId ?? setup.fixture.workspaceId,
    artifactVersionId: version.versionId,
    expectedRevision: overrides.expectedRevision ?? 0,
    ...(overrides.label === undefined ? {} : { label: overrides.label }),
  };
  return setup.service.setReferenceVersion(input);
};

/** 成功分支断言收口：拿到 data，失败直接把错误码摊给断言信息。 */
const expectOk = <TData>(result: Result<TData>): TData => {
  expect(result.ok).toBe(true);
  if (!result.ok)
    throw new Error(`unexpected failure: ${result.error.code} ${result.error.message}`);
  return result.data;
};

describe('WorkspaceReferenceService', () => {
  it('pins, lists, relabels and removes the exact version end to end', () => {
    const setup = openStore('全链路');
    const { store, service, fixture } = setup;
    const version = saveVersion(store, fixture, '甲');

    const created = expectOk(setReference(setup, version, { label: '收入对比基准' }));
    expect(created.receipt).toMatchObject({
      commit: 'committed',
      effect: 'created',
      projectionState: 'synced',
    });
    expect(created.receipt.currentReference).toMatchObject({
      workspaceId: fixture.workspaceId,
      artifactVersionId: version.versionId,
      contentHash: version.contentHash,
      label: '收入对比基准',
      status: 'active',
      revision: 1,
    });
    expect(created.material).toEqual({
      kind: 'artifact-version',
      artifactId: version.artifactId,
      artifactVersionId: version.versionId,
      contentHash: version.contentHash,
      originWorkspaceId: fixture.workspaceId,
    });
    const referenceId = created.receipt.currentReference.id;

    const listed = expectOk(service.listReferenceVersions({ workspaceId: fixture.workspaceId }));
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({ artifactId: version.artifactId, status: 'ready' });

    const relabeled = expectOk(
      setReference(setup, version, { expectedRevision: 1, label: '续约基准' }),
    );
    expect(relabeled.receipt.effect).toBe('updated');
    expect(relabeled.receipt.currentReference.revision).toBe(2);

    const unchanged = expectOk(
      setReference(setup, version, { expectedRevision: 2, label: '续约基准' }),
    );
    expect(unchanged.receipt.effect).toBe('unchanged');
    expect(unchanged.receipt.currentReference.revision).toBe(2);

    const removed = expectOk(
      service.removeReferenceVersion({
        operationId: randomUUID(),
        id: referenceId,
        expectedRevision: 2,
      }),
    );
    expect(removed.effect).toBe('updated');
    expect(removed.currentReference.status).toBe('removed');

    const after = expectOk(service.listReferenceVersions({ workspaceId: fixture.workspaceId }));
    expect(after.items).toEqual([]);
    expect(store.workspaceReferences.countActive(fixture.workspaceId)).toBe(0);
  });

  it('replays the same operationId with the same payload without writing twice', () => {
    const setup = openStore('幂等重放');
    const { store, service, fixture } = setup;
    const version = saveVersion(store, fixture, '甲');
    const operationId = randomUUID();

    const first = expectOk(setReference(setup, version, { operationId, label: '收入口径' }));
    const second = expectOk(setReference(setup, version, { operationId, label: '收入口径' }));
    expect(second).toEqual(first);
    expect(store.workspaceReferences.countActive(fixture.workspaceId)).toBe(1);
    const listed = expectOk(service.listReferenceVersions({ workspaceId: fixture.workspaceId }));
    expect(listed.items).toHaveLength(1);

    // 重放返回「当前最新展示状态」：外部更新后再重放，看到的是最新修订。
    setReference(setup, version, { expectedRevision: 1, label: '改名' });
    const replayed = expectOk(setReference(setup, version, { operationId, label: '收入口径' }));
    expect(replayed.receipt.currentReference.label).toBe('改名');
    expect(replayed.receipt.effect).toBe('created');
    expect(service.listReferenceVersions({ workspaceId: fixture.workspaceId }).ok).toBe(true);
  });

  it('rejects the same operationId carrying a different payload with IDEMPOTENCY_CONFLICT', () => {
    const setup = openStore('幂等冲突');
    const { store, service, fixture } = setup;
    const version = saveVersion(store, fixture, '甲');
    const operationId = randomUUID();

    const created = expectOk(setReference(setup, version, { operationId, label: '第一版标签' }));
    const conflicting = setReference(setup, version, { operationId, label: '第二版标签' });
    expect(conflicting.ok).toBe(false);
    if (conflicting.ok) return;
    expect(conflicting.error).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', retryable: true });

    // 同一幂等身份跨到另一类命令（不同 operationKind）同样被拒。
    const crossed = service.removeReferenceVersion({
      operationId,
      id: created.receipt.currentReference.id,
      expectedRevision: 1,
    });
    expect(crossed.ok).toBe(false);
    if (crossed.ok) return;
    expect(crossed.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(store.workspaceReferences.countActive(fixture.workspaceId)).toBe(1);
  });

  it('surfaces REVISION_CONFLICT with the current revision for stale expectedRevision', () => {
    const setup = openStore('修订冲突');
    const { store, service, fixture } = setup;
    const version = saveVersion(store, fixture, '甲');

    const created = expectOk(setReference(setup, version, { label: '基准' }));
    setReference(setup, version, { expectedRevision: 1, label: '更新过的标签' });

    const staleSet = setReference(setup, version, { expectedRevision: 1, label: '过期写入' });
    expect(staleSet.ok).toBe(false);
    if (staleSet.ok) return;
    expect(staleSet.error).toMatchObject({
      code: 'REVISION_CONFLICT',
      retryable: true,
      currentRevision: 2,
    });

    const staleRemove = service.removeReferenceVersion({
      operationId: randomUUID(),
      id: created.receipt.currentReference.id,
      expectedRevision: 1,
    });
    expect(staleRemove.ok).toBe(false);
    if (staleRemove.ok) return;
    expect(staleRemove.error).toMatchObject({ code: 'REVISION_CONFLICT', currentRevision: 2 });

    // 目标行不存在时 currentRevision 无法给出（schema 要求正整数），省略而非伪装。
    const neverSet = setReference(setup, saveVersion(store, fixture, '乙'), {
      expectedRevision: 3,
    });
    expect(neverSet.ok).toBe(false);
    if (neverSet.ok) return;
    expect(neverSet.error.code).toBe('REVISION_CONFLICT');
    expect(neverSet.error.currentRevision).toBeUndefined();
  });

  it('refuses cross-workspace versions and unreadable versions', () => {
    const setup = openStore('跨空间拒绝');
    const { store, service, fixture } = setup;
    const foreign = makeFixture(store, '外来空间');
    const foreignVersion = saveVersion(store, foreign, '外');

    // 版本属于另一个空间：以本空间为 workspaceId 提交才会命中归属校验。
    const mismatch = setReference(setup, foreignVersion, {
      label: '想参考别家',
      workspaceId: fixture.workspaceId,
    });
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) return;
    expect(mismatch.error.code).toBe('REFERENCE_WORKSPACE_MISMATCH');
    expect(mismatch.error.retryable).toBe(false);

    const missing = service.setReferenceVersion({
      operationId: randomUUID(),
      workspaceId: fixture.workspaceId,
      artifactVersionId: 'version-does-not-exist',
      expectedRevision: 0,
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe('REFERENCE_UNAVAILABLE');
    expect(store.workspaceReferences.countActive(fixture.workspaceId)).toBe(0);
  });

  it('enforces the active reference cap of the same workspace with REFERENCE_LIMIT', () => {
    const setup = openStore('上限');
    const { store, service, fixture } = setup;
    const versions = Array.from({ length: WORKSPACE_REFERENCE_ACTIVE_LIMIT + 1 }, (_, index) =>
      saveVersion(store, fixture, `批${index}`),
    );
    const overflowVersion = versions[WORKSPACE_REFERENCE_ACTIVE_LIMIT];
    if (!overflowVersion) return;

    for (const [index, version] of versions.entries()) {
      if (index >= WORKSPACE_REFERENCE_ACTIVE_LIMIT) continue;
      expectOk(setReference(setup, version, { label: `标记${index}` }));
    }
    expect(store.workspaceReferences.countActive(fixture.workspaceId)).toBe(
      WORKSPACE_REFERENCE_ACTIVE_LIMIT,
    );

    const overflow = setReference(setup, overflowVersion, { label: '多出的一个' });
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.error.code).toBe('REFERENCE_LIMIT');

    // 取消一个之后，新 operationId 即可写入：上限只约束 active。
    const listed = expectOk(service.listReferenceVersions({ workspaceId: fixture.workspaceId }));
    const victim = listed.items[0];
    if (!victim) return;
    expectOk(
      service.removeReferenceVersion({
        operationId: randomUUID(),
        id: victim.reference.id,
        expectedRevision: victim.reference.revision,
      }),
    );
    expectOk(setReference(setup, overflowVersion, { label: '多出的一个' }));
    expect(store.workspaceReferences.countActive(fixture.workspaceId)).toBe(
      WORKSPACE_REFERENCE_ACTIVE_LIMIT,
    );
  });

  it('refuses to unpin a version still consumed as material by a persisted run', () => {
    const setup = openStore('历史阻断');
    const { store, service, fixture } = setup;
    const consumed = saveVersion(store, fixture, '被历史用过');
    const fresh = saveVersion(store, fixture, '只是参考');

    const pinnedConsumed = expectOk(setReference(setup, consumed, { label: '历史材料' }));
    const pinnedFresh = expectOk(setReference(setup, fresh, { label: '结构参考' }));

    const extraTask = store.tasks.create(fixture.workspaceId, '历史任务', '使用过材料');
    store.runs.create({
      id: 'run-history-block',
      taskId: extraTask.task.id,
      sessionId: extraTask.sessionId,
      prompt: '按参考版本产出',
      status: 'completed',
      createdAt: 1,
    });
    store.runContextSnapshots.create({
      runId: 'run-history-block',
      taskId: extraTask.task.id,
      workspaceId: fixture.workspaceId,
      contextSegmentId: 'segment-history',
      materials: [
        {
          reference: {
            kind: 'artifact-version',
            artifactId: consumed.artifactId,
            artifactVersionId: consumed.versionId,
            contentHash: consumed.contentHash,
            originWorkspaceId: fixture.workspaceId,
          },
          purpose: 'historical-comparison',
          addedFrom: 'expert-reference',
        },
      ],
      createdAt: 2,
    });

    const blocked = service.removeReferenceVersion({
      operationId: randomUUID(),
      id: pinnedConsumed.receipt.currentReference.id,
      expectedRevision: 1,
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error).toMatchObject({
      code: 'HISTORY_REFERENCE_BLOCKS_DELETE',
      retryable: false,
    });

    // 未被历史消费的其它标记不受牵连，仍可正常取消。
    expectOk(
      service.removeReferenceVersion({
        operationId: randomUUID(),
        id: pinnedFresh.receipt.currentReference.id,
        expectedRevision: 1,
      }),
    );
    const listed = expectOk(service.listReferenceVersions({ workspaceId: fixture.workspaceId }));
    expect(listed.items.map((item) => item.reference.id)).toEqual([
      pinnedConsumed.receipt.currentReference.id,
    ]);
  });

  it('replays a remove receipt and rejects unknown ids', () => {
    const setup = openStore('移除重放');
    const { store, service, fixture } = setup;
    const created = expectOk(
      setReference(setup, saveVersion(store, fixture, '甲'), { label: '要取消' }),
    );

    const operationId = randomUUID();
    const removed = expectOk(
      service.removeReferenceVersion({
        operationId,
        id: created.receipt.currentReference.id,
        expectedRevision: 1,
      }),
    );
    const replayed = expectOk(
      service.removeReferenceVersion({
        operationId,
        id: created.receipt.currentReference.id,
        expectedRevision: 1,
      }),
    );
    expect(replayed).toEqual(removed);
    expect(replayed.currentReference.status).toBe('removed');
    expect(store.workspaceReferences.countActive(fixture.workspaceId)).toBe(0);

    const missing = service.removeReferenceVersion({
      operationId: randomUUID(),
      id: 'reference-does-not-exist',
      expectedRevision: 1,
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe('REFERENCE_UNAVAILABLE');
  });
});
