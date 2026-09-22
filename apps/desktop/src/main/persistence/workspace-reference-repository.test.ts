import { createHash } from 'node:crypto';

import {
  type MaterialReference,
  WORKSPACE_BRIEF_REFERENCE_ITEM_LIMIT,
  WORKSPACE_REFERENCE_ACTIVE_LIMIT,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AppStore,
  MemoryConflictError,
  WorkspaceReferenceLimitError,
  WorkspaceReferenceMismatchError,
  WorkspaceReferenceUnavailableError,
} from './index';

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const T_BASE = 1_700_000_000_000;

interface PinnedVersion {
  artifactId: string;
  versionId: string;
  contentHash: string;
}

interface WorkspaceFixture {
  workspaceId: string;
  taskId: string;
}

describe('WorkspaceReferenceRepository', () => {
  const stores: AppStore[] = [];

  const openStore = (): AppStore => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    return store;
  };

  const newFixture = (store: AppStore, label: string): WorkspaceFixture => {
    const workspaceId = store.workspaces.getOrCreate(`/tmp/workspace-reference/${label}`, label).id;
    return {
      workspaceId,
      taskId: store.tasks.create(workspaceId, label, '产出可参考的成果').task.id,
    };
  };

  /** 参考标记只能指向真实存在的成果精确版本，版本行由成果仓储建出来。 */
  const saveVersion = (store: AppStore, fixture: WorkspaceFixture, seed: string): PinnedVersion => {
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
      contentHash: sha256Hex(content),
    };
  };

  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
  });

  it('pins the exact version with the hash Main reads back, not what the caller claims', () => {
    const store = openStore();
    const fixture = newFixture(store, '钉住版本');
    const version = saveVersion(store, fixture, '甲');

    const created = store.workspaceReferences.set({
      workspaceId: fixture.workspaceId,
      artifactVersionId: version.versionId,
      expectedRevision: 0,
      label: '收入对比基准',
      at: T_BASE,
    });
    expect(created.effect).toBe('created');
    const referenceId = created.reference.id;
    expect(referenceId.length).toBeGreaterThan(0);
    expect(created.reference).toEqual({
      id: referenceId,
      workspaceId: fixture.workspaceId,
      artifactVersionId: version.versionId,
      contentHash: version.contentHash,
      label: '收入对比基准',
      status: 'active',
      revision: 1,
      selectedAt: T_BASE,
      updatedAt: T_BASE,
    });
    // 交回的是可直接进 TaskContext 的既有 MaterialReference。
    const material: MaterialReference = created.material;
    expect(material).toEqual({
      kind: 'artifact-version',
      artifactId: version.artifactId,
      artifactVersionId: version.versionId,
      contentHash: version.contentHash,
      originWorkspaceId: fixture.workspaceId,
    });
    // 同标签重复提交：unchanged，不涨修订。
    const again = store.workspaceReferences.set({
      workspaceId: fixture.workspaceId,
      artifactVersionId: version.versionId,
      expectedRevision: 1,
      label: '收入对比基准',
      at: T_BASE + 100,
    });
    expect(again.effect).toBe('unchanged');
    expect(again.reference.updatedAt).toBe(T_BASE);
    // 不传标签也不抹掉原标签。
    expect(
      store.workspaceReferences.set({
        workspaceId: fixture.workspaceId,
        artifactVersionId: version.versionId,
        expectedRevision: 1,
        at: T_BASE + 200,
      }).effect,
    ).toBe('unchanged');

    const relabeled = store.workspaceReferences.set({
      workspaceId: fixture.workspaceId,
      artifactVersionId: version.versionId,
      expectedRevision: 1,
      label: '改用季度口径',
      at: T_BASE + 300,
    });
    expect(relabeled.effect).toBe('updated');
    expect(relabeled.reference.label).toBe('改用季度口径');
    expect(relabeled.reference.revision).toBe(2);

    expect(() =>
      store.workspaceReferences.set({
        workspaceId: fixture.workspaceId,
        artifactVersionId: version.versionId,
        expectedRevision: 1,
        label: '过期修订',
      }),
    ).toThrow(MemoryConflictError);
    // 已存在的标记不能再用「新建」的 expectedRevision 0 挤进去。
    expect(() =>
      store.workspaceReferences.set({
        workspaceId: fixture.workspaceId,
        artifactVersionId: version.versionId,
        expectedRevision: 0,
      }),
    ).toThrow(/期望参考修订/u);
    expect(store.workspaceReferences.find(fixture.workspaceId, version.versionId)?.revision).toBe(
      2,
    );
    expect(store.workspaceReferences.get('ref-ghost')).toBeUndefined();
  });

  it('refuses versions that do not exist or belong to another workspace', () => {
    const store = openStore();
    const mine = newFixture(store, '本空间');
    const yours = newFixture(store, '他空间');
    const foreign = saveVersion(store, yours, '乙');

    expect(() =>
      store.workspaceReferences.set({
        workspaceId: mine.workspaceId,
        artifactVersionId: 'version-ghost',
        expectedRevision: 0,
      }),
    ).toThrow(WorkspaceReferenceUnavailableError);
    expect(() =>
      store.workspaceReferences.set({
        workspaceId: mine.workspaceId,
        artifactVersionId: foreign.versionId,
        expectedRevision: 0,
      }),
    ).toThrow(WorkspaceReferenceMismatchError);
    expect(() =>
      store.workspaceReferences.remove({ id: 'ref-ghost', expectedRevision: 1 }),
    ).toThrow(/参考标记不存在/u);
    expect(store.workspaceReferences.listActive(mine.workspaceId)).toEqual([]);
    // 归属预检失败同样不许留下半行。
    expect(store.workspaceReferences.countActive(mine.workspaceId)).toBe(0);
  });

  it('treats removal as a status change the history can still explain', () => {
    const store = openStore();
    const fixture = newFixture(store, '移除与复活');
    const version = saveVersion(store, fixture, '丙');
    const created = store.workspaceReferences.set({
      workspaceId: fixture.workspaceId,
      artifactVersionId: version.versionId,
      expectedRevision: 0,
      label: '历史基准',
      at: T_BASE,
    });

    const removed = store.workspaceReferences.remove({
      id: created.reference.id,
      expectedRevision: 1,
      at: T_BASE + 400,
    });
    expect(removed.effect).toBe('updated');
    expect(removed.reference.status).toBe('removed');
    expect(removed.reference.revision).toBe(2);
    // 移除是状态变化：行还在，简报与当时解释得通。
    expect(store.workspaceReferences.get(created.reference.id)?.label).toBe('历史基准');
    expect(store.workspaceReferences.listActive(fixture.workspaceId)).toEqual([]);
    expect(store.workspaceReferences.countActive(fixture.workspaceId)).toBe(0);

    expect(
      store.workspaceReferences.remove({
        id: created.reference.id,
        expectedRevision: 2,
        at: T_BASE + 500,
      }).effect,
    ).toBe('unchanged');
    expect(() =>
      store.workspaceReferences.remove({
        id: created.reference.id,
        expectedRevision: 1,
        at: T_BASE + 600,
      }),
    ).toThrow(MemoryConflictError);

    // 复活走同一条唯一键，重新钉住并推进 selectedAt。
    const revived = store.workspaceReferences.set({
      workspaceId: fixture.workspaceId,
      artifactVersionId: version.versionId,
      expectedRevision: 2,
      at: T_BASE + 700,
    });
    expect(revived.effect).toBe('updated');
    expect(revived.reference.status).toBe('active');
    expect(revived.reference.revision).toBe(3);
    expect(revived.reference.selectedAt).toBe(T_BASE + 700);
    expect(revived.reference.label).toBe('历史基准');
    expect(
      store.workspaceReferences.listActive(fixture.workspaceId).map((item) => item.id),
    ).toEqual([created.reference.id]);
  });

  it('caps active pins per workspace and frees a slot on removal', () => {
    const store = openStore();
    const fixture = newFixture(store, '配额空间');
    let firstReferenceId = '';
    let firstVersionId = '';
    for (let index = 0; index < WORKSPACE_REFERENCE_ACTIVE_LIMIT; index += 1) {
      const version = saveVersion(store, fixture, `编号-${index}`);
      const outcome = store.workspaceReferences.set({
        workspaceId: fixture.workspaceId,
        artifactVersionId: version.versionId,
        expectedRevision: 0,
        at: T_BASE + index,
      });
      if (index === 0) {
        firstReferenceId = outcome.reference.id;
        firstVersionId = version.versionId;
      }
    }
    expect(store.workspaceReferences.countActive(fixture.workspaceId)).toBe(
      WORKSPACE_REFERENCE_ACTIVE_LIMIT,
    );

    const extra = saveVersion(store, fixture, '溢出的一条');
    expect(() =>
      store.workspaceReferences.set({
        workspaceId: fixture.workspaceId,
        artifactVersionId: extra.versionId,
        expectedRevision: 0,
      }),
    ).toThrow(WorkspaceReferenceLimitError);

    // 更新已有标记不占新额度。
    expect(
      store.workspaceReferences.set({
        workspaceId: fixture.workspaceId,
        artifactVersionId: firstVersionId,
        expectedRevision: 1,
        label: '换个说法',
        at: T_BASE + 100,
      }).effect,
    ).toBe('updated');

    store.workspaceReferences.remove({
      id: firstReferenceId,
      expectedRevision: 2,
      at: T_BASE + 200,
    });
    expect(
      store.workspaceReferences.set({
        workspaceId: fixture.workspaceId,
        artifactVersionId: extra.versionId,
        expectedRevision: 0,
        at: T_BASE + 300,
      }).effect,
    ).toBe('created');
    // 另一空间自己还能开 20 个：额度按空间算，不按全库算。
    const elsewhere = newFixture(store, '对照空间');
    const elsewhereVersion = saveVersion(store, elsewhere, '别处的第一条');
    expect(
      store.workspaceReferences.set({
        workspaceId: elsewhere.workspaceId,
        artifactVersionId: elsewhereVersion.versionId,
        expectedRevision: 0,
      }).reference.workspaceId,
    ).toBe(elsewhere.workspaceId);
  });

  it('orders the reference area newest first and feeds the brief with at most five', () => {
    const store = openStore();
    const fixture = newFixture(store, '简报空间');
    for (let index = 0; index < WORKSPACE_BRIEF_REFERENCE_ITEM_LIMIT + 2; index += 1) {
      const version = saveVersion(store, fixture, `条目-${index}`);
      store.workspaceReferences.set({
        workspaceId: fixture.workspaceId,
        artifactVersionId: version.versionId,
        expectedRevision: 0,
        at: T_BASE + index * 10,
      });
    }
    const active = store.workspaceReferences.listActive(fixture.workspaceId);
    expect(active.map((item) => item.selectedAt)).toEqual([
      T_BASE + 60,
      T_BASE + 50,
      T_BASE + 40,
      T_BASE + 30,
      T_BASE + 20,
      T_BASE + 10,
      T_BASE,
    ]);
    const brief = store.workspaceReferences.listBriefReferences(fixture.workspaceId);
    expect(brief.map((item) => item.selectedAt)).toEqual([
      T_BASE + 60,
      T_BASE + 50,
      T_BASE + 40,
      T_BASE + 30,
      T_BASE + 20,
    ]);
    // 简报截断不等于列表截断。
    expect(active.length).toBeGreaterThan(brief.length);
  });

  it('reports availability for active pins and pre-checks deletion blocks', () => {
    const store = openStore();
    const fixture = newFixture(store, '可用性空间');
    const first = saveVersion(store, fixture, '可用一条');
    const second = saveVersion(store, fixture, '另一条');
    store.workspaceReferences.set({
      workspaceId: fixture.workspaceId,
      artifactVersionId: first.versionId,
      expectedRevision: 0,
      label: '口径基准',
      at: T_BASE,
    });
    const secondRef = store.workspaceReferences.set({
      workspaceId: fixture.workspaceId,
      artifactVersionId: second.versionId,
      expectedRevision: 0,
      at: T_BASE + 10,
    });
    store.workspaceReferences.remove({
      id: secondRef.reference.id,
      expectedRevision: 1,
      at: T_BASE + 20,
    });

    const items = store.workspaceReferences.listActiveWithAvailability(fixture.workspaceId);
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe('ready');
    expect(items[0]?.artifactId).toBe(first.artifactId);
    expect(items[0]?.reference.label).toBe('口径基准');
    // §8.3：被标记绑定的精确版本删除会撞 RESTRICT，预检先把数量报清楚。
    expect(store.workspaceReferences.assessVersionDeletionBlock(first.versionId)).toBe(1);
    expect(store.workspaceReferences.assessVersionDeletionBlock(second.versionId)).toBe(1);
    expect(store.workspaceReferences.assessVersionDeletionBlock('version-ghost')).toBe(0);
    // 同空间规则下不该出现他空间引用；出现异常也必须如实回答而不是猜。
    expect(store.workspaceReferences.assessWorkspaceDeletionImpact(fixture.workspaceId)).toEqual({
      workspaceId: fixture.workspaceId,
      blockingReferenceCount: 0,
      foreignWorkspaceIds: [],
      blocking: false,
    });
    expect(store.workspaceReferences.assessWorkspaceDeletionImpact('ws-ghost').blocking).toBe(
      false,
    );
  });
});
