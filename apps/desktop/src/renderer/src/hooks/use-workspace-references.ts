import type {
  ListWorkspaceReferenceVersionsRequest,
  MaterialReference,
  RemoveWorkspaceReferenceVersionRequest,
  Result,
  SetWorkspaceReferenceVersionRequest,
  WorkspaceArtifactReference,
  WorkspaceReferenceListItem,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { trackAction } from '../lib/async-action';
import { settleMemoryCall } from '../lib/memory-result';

/**
 * 本空间的参考成果版本（产品设计 §3.6、实施契约 §10）。
 *
 * 三条契约约束落在这里：
 * 1. 参考标记固定 `artifactVersionId` ＋ `contentHash`，**不跟随最新**——成果新增版本后
 *    参考仍指旧版本，界面也不把它当成本期已读取；
 * 2. 写命令走 CAS：新建时 `expectedRevision` 为 0，更新时带标记行的当前修订；
 * 3. 「指定参考」只表示参考选择，不表示内容正确或审批通过，因此回执之外不额外造状态。
 */

export interface ReferenceVersionResult {
  ok: boolean;
  /** 成功时 Main 回带的既有 MaterialReference：引用到当前任务直接复用它，不自己拼引用。 */
  material: MaterialReference | undefined;
  message: string;
  revisionConflict: boolean;
}

export interface WorkspaceReferencesState {
  items: WorkspaceReferenceListItem[];
  loading: boolean;
  error: string;
  /** 正在写入的 artifactVersionId，用于禁用重复点击。 */
  pendingVersionId: string;
  referenceOf: (artifactVersionId: string) => WorkspaceArtifactReference | undefined;
  refresh: () => void;
  markReference: (artifactVersionId: string, label?: string) => Promise<ReferenceVersionResult>;
  removeReference: (reference: WorkspaceArtifactReference) => Promise<ReferenceVersionResult>;
  /** 已标记过就不再重复写，直接拿既有引用去「引用到当前任务」。 */
  ensureReference: (artifactVersionId: string, label?: string) => Promise<ReferenceVersionResult>;
}

export function useWorkspaceReferences(workspaceId: string | undefined): WorkspaceReferencesState {
  const [items, setItems] = useState<WorkspaceReferenceListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingVersionId, setPendingVersionId] = useState('');
  const guard = useRef({ key: '', request: 0 });

  const load = useCallback((): void => {
    if (workspaceId === undefined) {
      guard.current = { key: '', request: guard.current.request + 1 };
      setItems([]);
      setError('');
      return;
    }
    guard.current.request += 1;
    const requestId = guard.current.request;
    guard.current.key = workspaceId;
    const input: ListWorkspaceReferenceVersionsRequest = { workspaceId };
    setLoading(true);
    trackAction(
      settleMemoryCall(
        window.betterwork.workspace.listReferenceVersions(input),
        '参考版本列表读取失败，请重试。',
      ).then((outcome) => {
        if (guard.current.request !== requestId || guard.current.key !== workspaceId) return;
        setLoading(false);
        if (outcome.ok) {
          setItems(outcome.data.items);
          setError('');
        } else {
          setItems([]);
          setError(outcome.message);
        }
      }),
      '读取参考成果版本',
    );
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const referenceOf = useCallback(
    (artifactVersionId: string): WorkspaceArtifactReference | undefined =>
      items.find((item) => item.reference.artifactVersionId === artifactVersionId)?.reference,
    [items],
  );

  const write = useCallback(
    async <TData>(
      artifactVersionId: string,
      call: Promise<Result<TData>>,
      fallback: string,
      // 两个写命令的回执形状不同（set 带 material，remove 只带回执），
      // 因此由调用方告知如何取出可引用的 MaterialReference。
      materialOf: (data: TData) => MaterialReference | undefined,
    ): Promise<ReferenceVersionResult> => {
      setPendingVersionId(artifactVersionId);
      const outcome = await settleMemoryCall(call, fallback);
      setPendingVersionId('');
      // 写入期间的响应可能属于别的空间：只刷新、不回报成功，避免误提示。
      if (guard.current.key !== (workspaceId ?? '')) {
        return { ok: false, material: undefined, message: fallback, revisionConflict: false };
      }
      if (outcome.ok) {
        setError('');
        load();
        return {
          ok: true,
          material: materialOf(outcome.data),
          message: '',
          revisionConflict: false,
        };
      }
      setError(outcome.message);
      return {
        ok: false,
        material: undefined,
        message: outcome.message,
        revisionConflict: outcome.code === 'REVISION_CONFLICT',
      };
    },
    [load, workspaceId],
  );

  const markReference = useCallback(
    (artifactVersionId: string, label?: string): Promise<ReferenceVersionResult> => {
      if (workspaceId === undefined) {
        return Promise.resolve({
          ok: false,
          material: undefined,
          message: '工作空间尚未确定，无法指定参考版本。',
          revisionConflict: false,
        });
      }
      const existing = referenceOf(artifactVersionId);
      const input: SetWorkspaceReferenceVersionRequest = {
        operationId: crypto.randomUUID(),
        workspaceId,
        artifactVersionId,
        expectedRevision: existing?.revision ?? 0,
        ...(label ? { label } : {}),
      };
      return write(
        artifactVersionId,
        window.betterwork.workspace.setReferenceVersion(input),
        '指定参考版本失败，请重试。',
        (data) => data.material,
      );
    },
    [referenceOf, workspaceId, write],
  );

  const removeReference = useCallback(
    (reference: WorkspaceArtifactReference): Promise<ReferenceVersionResult> => {
      const input: RemoveWorkspaceReferenceVersionRequest = {
        operationId: crypto.randomUUID(),
        id: reference.id,
        expectedRevision: reference.revision,
      };
      return write(
        reference.artifactVersionId,
        window.betterwork.workspace.removeReferenceVersion(input),
        '取消参考失败，请重试。',
        () => undefined,
      );
    },
    [write],
  );

  const ensureReference = useCallback(
    async (artifactVersionId: string, label?: string): Promise<ReferenceVersionResult> => {
      const existing = items.find((item) => item.reference.artifactVersionId === artifactVersionId);
      if (existing && existing.status === 'ready') {
        return {
          ok: true,
          material: materialOfReference(existing),
          message: '',
          revisionConflict: false,
        };
      }
      return markReference(artifactVersionId, label);
    },
    [items, markReference],
  );

  return {
    items,
    loading,
    error,
    pendingVersionId,
    referenceOf,
    refresh: load,
    markReference,
    removeReference,
    ensureReference,
  };
}

/**
 * 取消参考后仍要能「引用到当前任务」时用的回退：列表项自带 artifactId 与版本 id，
 * 而 MaterialReference 还需要 contentHash 与 originWorkspaceId——这三个字段都在
 * `WorkspaceReferenceListItem.reference` 里，因此可以不靠 Main 额外回带就构造引用。
 */
function materialOfReference(item: WorkspaceReferenceListItem): MaterialReference {
  return {
    kind: 'artifact-version',
    artifactId: item.artifactId,
    artifactVersionId: item.reference.artifactVersionId,
    contentHash: item.reference.contentHash,
    originWorkspaceId: item.reference.workspaceId,
  };
}
