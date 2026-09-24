import type {
  MemoryConflictDecision,
  MemoryConflictPair,
  MemoryGovernanceAction,
  MemoryViewItem,
} from '@betterwork/agent-protocol';
import {
  countCodePoints,
  MEMORY_APPLICABILITY_NOTE_MAX_CODE_POINTS,
} from '@betterwork/agent-protocol';
import { useEffect, useState } from 'react';

import { ConfirmationDialog } from '../components/ConfirmationDialog';
import type { MemoryEditorSubmission } from '../components/MemoryEditor';
import { MemoryEditor } from '../components/MemoryEditor';
import { MemorySuggestionList } from '../components/MemorySuggestionList';
import type { MemoriesState } from '../hooks/use-memories';
import { newMemoryOperationId } from '../hooks/use-memories';
import type { MemorySuggestionsState } from '../hooks/use-memory-suggestions';
import { AlertIcon, PlusIcon } from '../icons';
import { trackAction } from '../lib/async-action';
import {
  effectiveStatusLabel,
  facetLabel,
  formatValidityRange,
  isTerminalMemory,
  memoryProvenanceLabel,
  memoryScopeLabel,
  sourceAvailabilityLabel,
} from '../lib/memory-labels';

/**
 * 记忆治理页（产品设计 §3.1、§3.2、§3.4；WM07、WM11）。
 *
 * 治理动作全部走协议里的六个 action，配 `expectedRevision` 与 `operationId`；
 * 界面自己不做任何「看起来更安全」的判断：
 * - 冲突只并列呈现并标注「可能冲突」，绝不代替用户判定真假；
 * - `deleted`/`superseded` 是终态，不渲染任何能改回可用状态的按钮；
 * - `expired` 只能通过「修改有效期 + 重新确认」回来；
 * - 删除的措辞说清「以后不用」「历史仍保留」「正在运行不热更新」。
 */

export interface MemoryManagementTarget {
  expertId: string;
  expertName: string;
  workspaceId?: string | undefined;
}

export interface MemoryPageProps {
  state: MemoriesState;
  scopeTarget?: MemoryManagementTarget | undefined;
  onClearScope?: (() => void) | undefined;
  /** 自动建议区；未选中工作空间时省略，此时不渲染该区。 */
  suggestions?: MemorySuggestionsState | undefined;
  /** 当前工作空间；决定可提交的适用范围与简报归属。 */
  workspaceId?: string | undefined;
  /** 只用于范围标签的文字回显，不参与任何判断。 */
  workspaceName?: string | undefined;
  expertName?: string | undefined;
  /** 从任务面板「编辑并确认」跳转过来时预开的候选（WM11）。 */
  focusMemoryId?: string | undefined;
  onFocusHandled?: (() => void) | undefined;
  onOpenArtifact?: ((artifactId: string) => void) | undefined;
}

/** 编辑会话：新建、重新表述、编辑并确认、编辑已确认、过期后重新确认。 */
type EditorSession =
  | { key: string; mode: 'create'; restateFrom: MemoryViewItem | undefined }
  | { key: string; mode: 'confirm'; memory: MemoryViewItem }
  | { key: string; mode: 'edit'; memory: MemoryViewItem }
  | { key: string; mode: 'reconfirm'; memory: MemoryViewItem };

/** 冲突裁决：并列呈现后由用户选择替代或并存，系统不代人判定真假。 */
export type ConflictResolver = (
  left: MemoryViewItem,
  right: MemoryViewItem,
  decision: MemoryConflictDecision,
  options: { winnerId: string; applicabilityNote: string },
) => void;

const memoryMatchesTarget = (
  memory: MemoryViewItem,
  target: MemoryManagementTarget | undefined,
): boolean => {
  if (!target) return true;
  if (memory.scope.kind === 'expert') return memory.scope.expertId === target.expertId;
  return (
    memory.scope.kind === 'expert-workspace' &&
    target.workspaceId !== undefined &&
    memory.scope.expertId === target.expertId &&
    memory.scope.workspaceId === target.workspaceId
  );
};

/** 适用范围候选：有专家默认 expert-workspace，无专家默认 workspace（§3.1）。 */
export const scopeOptionsFor = (
  workspaceId: string | undefined,
  target: MemoryManagementTarget | undefined,
): MemoryViewItem['scope'][] => [
  ...(target && workspaceId
    ? [
        {
          kind: 'expert-workspace' as const,
          expertId: target.expertId,
          workspaceId,
        },
      ]
    : []),
  ...(target ? [{ kind: 'expert' as const, expertId: target.expertId }] : []),
  ...(workspaceId ? [{ kind: 'workspace' as const, workspaceId }] : []),
  { kind: 'user' as const },
];

const groupOf = (memory: MemoryViewItem): 'candidate' | 'confirmed' | 'expired' | 'history' => {
  if (memory.status === 'candidate') return 'candidate';
  if (memory.effectiveStatus === 'expired') return 'expired';
  if (memory.status === 'confirmed') return 'confirmed';
  return 'history';
};

export function MemoryPage({
  state,
  scopeTarget,
  onClearScope,
  suggestions,
  workspaceId,
  workspaceName,
  expertName,
  focusMemoryId,
  onFocusHandled,
}: MemoryPageProps): React.JSX.Element {
  const [session, setSession] = useState<EditorSession>();
  const [pendingDelete, setPendingDelete] = useState<MemoryViewItem>();
  const scopes = scopeOptionsFor(workspaceId, scopeTarget);
  const visible = state.memories.filter(
    (memory) => !isTerminalMemory(memory) && memoryMatchesTarget(memory, scopeTarget),
  );
  const history = state.memories.filter(
    (memory) => isTerminalMemory(memory) && memoryMatchesTarget(memory, scopeTarget),
  );
  const groups = {
    candidate: visible.filter((memory) => groupOf(memory) === 'candidate'),
    confirmed: visible.filter((memory) => groupOf(memory) === 'confirmed'),
    expired: visible.filter((memory) => groupOf(memory) === 'expired'),
  };
  // 契约 §10：待澄清与重复只报计数，不替用户裁决，也不新增跳转目的地。
  const pendingConflictPairs = new Set<string>(
    visible.flatMap((memory) =>
      memory.conflicts
        .filter((pair) => pair.state === 'unresolved')
        .map((pair) => `${pair.leftRevisionId}|${pair.rightRevisionId}`),
    ),
  ).size;
  const pendingDuplicateCandidates = visible.filter(
    (memory) => memory.duplicatesConfirmedMemoryId !== undefined,
  ).length;

  const closeSession = (): void => setSession(undefined);
  // 只有新建会话带重新表述来源；其余模式不读该字段，避免在联合类型上取属性。
  const restateFrom =
    session !== undefined && session.mode === 'create' ? session.restateFrom : undefined;
  // 会话期间列表可能已刷新（修订冲突后的补载）：编辑器始终以最新一版为基准，
  // 这样用户改完草稿重新提交时带的是当前修订，不会一直撞同一个冲突。
  const editorMemory =
    session === undefined || session.mode === 'create'
      ? undefined
      : (state.memories.find((item) => item.id === session.memory.id) ?? session.memory);
  const editorTitle =
    session === undefined
      ? ''
      : session.mode === 'create'
        ? restateFrom
          ? '作为我的工作口径重新保存'
          : '新增一条经验'
        : session.mode === 'reconfirm'
          ? '已过期：修改有效期并重新确认'
          : session.mode === 'edit'
            ? '编辑这条已确认的经验'
            : '编辑并确认';
  const editorSubmitLabel =
    session === undefined || session.mode === 'create'
      ? '保存为经验'
      : session.mode === 'edit'
        ? '保存修改'
        : session.mode === 'reconfirm'
          ? '重新确认并续期'
          : '编辑并确认';

  // 从任务面板带着某条候选跳进来：等列表把这条例出现后再开会话，避免闪空白。
  useEffect(() => {
    if (focusMemoryId === undefined) return;
    const memory = state.memories.find((item) => item.id === focusMemoryId);
    if (!memory) return;
    setSession(
      memory.status === 'candidate'
        ? { key: `confirm-${memory.id}`, mode: 'confirm', memory }
        : memory.effectiveStatus === 'expired'
          ? { key: `reconfirm-${memory.id}`, mode: 'reconfirm', memory }
          : { key: `edit-${memory.id}`, mode: 'edit', memory },
    );
    onFocusHandled?.();
  }, [focusMemoryId, onFocusHandled, state.memories]);

  const submitEditor = async (submission: MemoryEditorSubmission): Promise<boolean> => {
    const outcome =
      submission.kind === 'create'
        ? await state.create(submission.request)
        : submission.kind === 'update'
          ? await state.update({
              operationId: submission.operationId,
              id: submission.memoryId,
              expectedRevision: submission.expectedRevision,
              patch: submission.patch,
              ...(submission.legacySourceReview
                ? { legacySourceReview: submission.legacySourceReview }
                : {}),
            })
          : await state.act({
              operationId: submission.operationId,
              id: submission.memoryId,
              expectedRevision: submission.expectedRevision,
              action: submission.action,
              ...(submission.confirmPatch ? { confirmPatch: submission.confirmPatch } : {}),
            });
    if (outcome.ok) closeSession();
    // 失败（含修订冲突）时返回 false：编辑器保留草稿与幂等键，错误已在 state.error。
    return outcome.ok;
  };

  const actOn = (memory: MemoryViewItem, action: MemoryGovernanceAction): void => {
    trackAction(
      state.act({
        operationId: newMemoryOperationId(),
        id: memory.id,
        expectedRevision: memory.revision,
        action,
      }),
      '更新记忆状态',
    );
  };

  const reviewLegacySource = (memory: MemoryViewItem): void => {
    trackAction(
      state.update({
        operationId: newMemoryOperationId(),
        id: memory.id,
        expectedRevision: memory.revision,
        patch: { facet: memory.facet },
        legacySourceReview: { mode: 'user-instruction' },
      }),
      '复核记忆来源',
    );
  };

  const resolveConflict: ConflictResolver = (left, right, decision, options) => {
    trackAction(
      state.resolveConflict({
        operationId: newMemoryOperationId(),
        left: { id: left.id, expectedRevision: left.revision },
        right: { id: right.id, expectedRevision: right.revision },
        decision,
        ...(decision === 'replace' ? { winnerId: options.winnerId } : {}),
        ...(decision === 'keep-both' ? { applicabilityNote: options.applicabilityNote } : {}),
      }),
      '提交口径裁决',
    );
  };

  const rebuildProjection = (): void => {
    trackAction(state.rebuildProjection(newMemoryOperationId()), '重建记忆投影');
  };

  return (
    <section className="settings-section memory-settings">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">记忆</p>
          <h2>让长期经验可查看、可确认、可撤回</h2>
          <p>
            {scopeTarget
              ? `当前范围：${scopeTarget.expertName}${scopeTarget.workspaceId ? ' · 当前工作空间' : ''}`
              : '只有已确认、来源可用且适用范围命中的经验才会随新任务带入；候选与来源待复核的记录不会自动进入模型。'}
          </p>
        </div>
        <div className="memory-heading-actions">
          {scopeTarget && onClearScope && (
            <button className="text-button" type="button" onClick={onClearScope}>
              查看全部记忆
            </button>
          )}
          <button className="secondary-button" type="button" onClick={state.refresh}>
            刷新
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => setSession({ key: 'create', mode: 'create', restateFrom: undefined })}
          >
            <PlusIcon size={13} /> 新增经验
          </button>
        </div>
      </div>

      {state.error && <p className="inline-message error">{state.error}</p>}
      {state.revisionConflict && (
        <p className="inline-message error" role="alert">
          这条记忆在你编辑期间已被更新（你基于 v{state.revisionConflict.expectedRevision}， 当前 v
          {state.revisionConflict.currentRevision ?? '未知'}）。草稿仍在，
          刷新后可按最新版本重新提交。
          <button type="button" className="text-button" onClick={state.refresh}>
            刷新列表
          </button>
        </p>
      )}
      {state.projectionState !== undefined && state.projectionState !== 'synced' && (
        <div className="memory-projection">
          <AlertIcon size={13} />
          <span>
            {state.projectionState === 'pending'
              ? '记忆已保存，Markdown 投影待重建。'
              : '记忆已保存，但 Markdown 投影重建失败。数据库仍是真相源，可重试重建。'}
          </span>
          <button type="button" className="text-button" onClick={rebuildProjection}>
            重建投影
          </button>
        </div>
      )}

      {state.warnings.length > 0 && (
        // 成功带警告（契约 §9.1）：保存/读取都算成功，但原因必须让用户看得见，
        // 因此这里独立于 `state.error` 呈现，也不借用只表示错误的内联样式。
        <ul className="memory-warnings">
          {state.warnings.map((warning) => (
            <li key={`${warning.code}:${warning.message}`}>{warning.message}</li>
          ))}
        </ul>
      )}

      {(pendingConflictPairs > 0 || pendingDuplicateCandidates > 0) && (
        <div className="memory-pending-governance" role="note">
          <AlertIcon size={13} />
          <span>
            {[
              pendingConflictPairs > 0 ? `${pendingConflictPairs} 组口径待澄清` : '',
              pendingDuplicateCandidates > 0
                ? `${pendingDuplicateCandidates} 条候选与已确认记忆重复`
                : '',
            ]
              .filter((part) => part !== '')
              .join(' · ')}
            ：计数只是管理提示，请在下方对应分组里裁决或拒绝。
          </span>
        </div>
      )}

      {suggestions && (
        <MemorySuggestionList
          suggestions={suggestions}
          candidates={groups.candidate}
          variant="settings"
          workspaceName={workspaceName}
          expertName={expertName}
          onEdit={(candidate) =>
            setSession({ key: `confirm-${candidate.id}`, mode: 'confirm', memory: candidate })
          }
          onReject={(candidate) => actOn(candidate, 'reject')}
          onDelete={(candidate) => setPendingDelete(candidate)}
        />
      )}

      {session && (
        <div className="memory-editor-host">
          <h3>{editorTitle}</h3>
          <MemoryEditor
            scopes={
              session.mode === 'create' ? scopes : uniqueScopes([session.memory.scope, ...scopes])
            }
            {...(editorMemory === undefined ? {} : { memory: editorMemory })}
            {...(session.mode === 'confirm' || session.mode === 'reconfirm'
              ? { confirmAction: session.mode }
              : {})}
            {...(restateFrom ? { restateFrom } : {})}
            submitLabel={editorSubmitLabel}
            {...(workspaceName ? { workspaceName } : {})}
            {...(expertName ? { expertName } : {})}
            onSubmit={submitEditor}
            onCancel={closeSession}
          />
        </div>
      )}

      {state.loading ? (
        <div className="setting-placeholder">正在加载记忆…</div>
      ) : visible.length === 0 && history.length === 0 ? (
        <div className="setting-placeholder">
          <strong>还没有长期记忆</strong>
          <p>在这里记录稳定的偏好和工作方法，下一次任务会按适用范围与来源状态决定是否带入。</p>
        </div>
      ) : (
        <>
          <MemoryGroup
            title="待确认"
            hint="候选不会自动进入模型上下文；确认前请先核对适用范围与有效期。"
            memories={groups.candidate}
            state={state}
            onEdit={(memory) =>
              setSession({ key: `confirm-${memory.id}`, mode: 'confirm', memory })
            }
            onAction={actOn}
            onRestate={(memory) =>
              setSession({ key: `restate-${memory.id}`, mode: 'create', restateFrom: memory })
            }
            onDelete={setPendingDelete}
            onReviewSource={reviewLegacySource}
            onResolve={resolveConflict}
            {...(workspaceName ? { workspaceName } : {})}
            {...(expertName ? { expertName } : {})}
          />
          <MemoryGroup
            title="已确认"
            hint="已确认的经验按范围召回；来源不可用或待复核的不会带入。"
            memories={groups.confirmed}
            state={state}
            onEdit={(memory) => setSession({ key: `edit-${memory.id}`, mode: 'edit', memory })}
            onAction={actOn}
            onRestate={(memory) =>
              setSession({ key: `restate-${memory.id}`, mode: 'create', restateFrom: memory })
            }
            onDelete={setPendingDelete}
            onReviewSource={reviewLegacySource}
            onResolve={resolveConflict}
            {...(workspaceName ? { workspaceName } : {})}
            {...(expertName ? { expertName } : {})}
          />
          <MemoryGroup
            title="已过期"
            hint="到期只由查询派生；要恢复使用必须明确修改有效期并重新确认。"
            memories={groups.expired}
            state={state}
            onEdit={(memory) =>
              setSession({ key: `reconfirm-${memory.id}`, mode: 'reconfirm', memory })
            }
            onAction={actOn}
            onRestate={(memory) =>
              setSession({ key: `restate-${memory.id}`, mode: 'create', restateFrom: memory })
            }
            onDelete={setPendingDelete}
            onReviewSource={reviewLegacySource}
            onResolve={resolveConflict}
            editLabel="修改有效期并重新确认"
            {...(workspaceName ? { workspaceName } : {})}
            {...(expertName ? { expertName } : {})}
          />
          {history.length > 0 && (
            <details className="memory-history-group">
              <summary>历史与已停用 · {history.length} 条</summary>
              <MemoryGroup
                title=""
                hint="已被替代与「以后不用」的记录是终态：不能编辑、确认、续期或恢复，只能显式新建一条。"
                memories={history}
                state={state}
                onEdit={() => undefined}
                onAction={() => undefined}
                onRestate={() => undefined}
                onDelete={() => undefined}
                onReviewSource={() => undefined}
                onResolve={() => undefined}
                readOnly
                {...(workspaceName ? { workspaceName } : {})}
                {...(expertName ? { expertName } : {})}
              />
            </details>
          )}
        </>
      )}

      {pendingDelete && (
        <ConfirmationDialog
          title="不再使用这条经验？"
          detail="这是「以后不用」：历史记录与来源仍保留、可随时回溯；正在运行的任务不会热更新，需要立刻生效请取消该次运行后重跑。"
          confirmLabel="以后不用"
          onConfirm={() => {
            actOn(pendingDelete, 'delete');
            setPendingDelete(undefined);
          }}
          onCancel={() => setPendingDelete(undefined)}
        />
      )}
    </section>
  );
}

const uniqueScopes = (scopes: MemoryViewItem['scope'][]): MemoryViewItem['scope'][] => {
  const seen = new Set<string>();
  return scopes.filter((scope) => {
    const key = `${scope.kind}|${'workspaceId' in scope ? scope.workspaceId : ''}|${
      'expertId' in scope ? scope.expertId : ''
    }`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

interface MemoryGroupProps {
  title: string;
  hint: string;
  memories: MemoryViewItem[];
  state: MemoriesState;
  readOnly?: boolean;
  editLabel?: string;
  onEdit: (memory: MemoryViewItem) => void;
  onAction: (memory: MemoryViewItem, action: MemoryGovernanceAction) => void;
  onRestate: (memory: MemoryViewItem) => void;
  onDelete: (memory: MemoryViewItem) => void;
  onReviewSource: (memory: MemoryViewItem) => void;
  onResolve: ConflictResolver;
  workspaceName?: string;
  expertName?: string;
}

function MemoryGroup({
  title,
  hint,
  memories,
  state,
  readOnly = false,
  editLabel = '编辑',
  onEdit,
  onAction,
  onRestate,
  onDelete,
  onReviewSource,
  onResolve,
  workspaceName,
  expertName,
}: MemoryGroupProps): React.JSX.Element | null {
  if (memories.length === 0) return null;
  return (
    <div className="memory-group">
      {title && (
        <div className="memory-group-heading">
          <strong>{title}</strong>
          <small>{hint}</small>
        </div>
      )}
      {!title && <p className="memory-group-hint">{hint}</p>}
      <div className="memory-list">
        {memories.map((memory) => (
          <MemoryRow
            key={memory.id}
            memory={memory}
            allMemories={state.memories}
            readOnly={readOnly}
            editLabel={editLabel}
            onEdit={onEdit}
            onAction={onAction}
            onRestate={onRestate}
            onDelete={onDelete}
            onReviewSource={onReviewSource}
            onResolve={onResolve}
            {...(workspaceName ? { workspaceName } : {})}
            {...(expertName ? { expertName } : {})}
          />
        ))}
      </div>
    </div>
  );
}

interface MemoryRowProps {
  memory: MemoryViewItem;
  allMemories: MemoryViewItem[];
  readOnly: boolean;
  editLabel: string;
  onEdit: (memory: MemoryViewItem) => void;
  onAction: (memory: MemoryViewItem, action: MemoryGovernanceAction) => void;
  onRestate: (memory: MemoryViewItem) => void;
  onDelete: (memory: MemoryViewItem) => void;
  onReviewSource: (memory: MemoryViewItem) => void;
  onResolve: ConflictResolver;
  workspaceName?: string;
  expertName?: string;
}

function MemoryRow({
  memory,
  allMemories,
  readOnly,
  editLabel,
  onEdit,
  onAction,
  onRestate,
  onDelete,
  onReviewSource,
  onResolve,
  workspaceName,
  expertName,
}: MemoryRowProps): React.JSX.Element {
  const dependencies =
    memory.provenance.verification === 'verified'
      ? {
          materials: memory.provenance.materialDependencies.length,
          memories: memory.provenance.memoryDependencies.length,
        }
      : undefined;
  return (
    <article className={`memory-row memory-${memory.effectiveStatus}`} key={memory.id}>
      <div className="memory-main">
        <div className="memory-meta">
          <span className="memory-status-badge">
            {effectiveStatusLabel[memory.effectiveStatus]}
          </span>
          <span>{facetLabel[memory.facet]}</span>
          <span>{memoryScopeLabel(memory.scope, workspaceName, expertName)}</span>
          <span>{formatValidityRange(memory.validFrom, memory.validUntil)}</span>
          <span className={`memory-source-${memory.sourceAvailability.replace(' ', '-')}`}>
            {sourceAvailabilityLabel[memory.sourceAvailability]}
          </span>
          <span>
            修订 v{memory.revision} · {memoryProvenanceLabel(memory)}
          </span>
        </div>
        <p>{memory.content}</p>
        {memory.topicKey && <small>议题：{memory.topicKey}</small>}
        {dependencies !== undefined &&
          (dependencies.materials > 0 || dependencies.memories > 0) && (
            <small className="memory-dependencies">
              依赖：资料 {dependencies.materials} 项 · 既有记忆 {dependencies.memories} 条
              {memory.requiresMaterialSelection ? '；使用时仍需在本任务选入对应资料' : ''}
            </small>
          )}
        {memory.requiresMaterialSelection && dependencies === undefined && (
          <small className="memory-dependencies">使用时仍需在本任务选入对应资料。</small>
        )}
        {memory.duplicatesConfirmedMemoryId !== undefined && (
          <small className="memory-duplicate-hint">
            与已确认记忆重复：确认后会出现两条同口径记录，通常直接拒绝候选即可。
          </small>
        )}
        {memory.conflicts.map((pair) => (
          <ConflictPair
            key={`${pair.leftRevisionId}:${pair.rightRevisionId}`}
            pair={pair}
            memory={memory}
            allMemories={allMemories}
            onResolve={onResolve}
            {...(workspaceName ? { workspaceName } : {})}
            {...(expertName ? { expertName } : {})}
          />
        ))}
      </div>
      <div className="memory-actions">
        {!readOnly && (
          <button type="button" onClick={() => onEdit(memory)}>
            {editLabel}
          </button>
        )}
        {!readOnly &&
          memory.status === 'candidate' &&
          memory.candidateDisposition === 'pending' && (
            <>
              <button type="button" onClick={() => onAction(memory, 'confirm')}>
                确认
              </button>
              <button type="button" onClick={() => onAction(memory, 'reject')}>
                暂不采用
              </button>
            </>
          )}
        {!readOnly &&
          memory.status === 'candidate' &&
          memory.candidateDisposition === 'rejected' && (
            <button type="button" onClick={() => onAction(memory, 'restore-candidate')}>
              恢复待确认
            </button>
          )}
        {!readOnly && memory.sourceAvailability === 'review-required' && (
          <button type="button" onClick={() => onReviewSource(memory)}>
            复核来源
          </button>
        )}
        {!readOnly && memory.effectiveStatus !== 'expired' && memory.status === 'confirmed' && (
          <button type="button" onClick={() => onAction(memory, 'expire')}>
            设为过期
          </button>
        )}
        {!readOnly && !isGlobalScopeOf(memory) && isDerived(memory) && (
          <button type="button" onClick={() => onRestate(memory)}>
            作为我的工作口径重新保存
          </button>
        )}
        {!readOnly && !isTerminalMemory(memory) && (
          <button className="danger-text" type="button" onClick={() => onDelete(memory)}>
            以后不用
          </button>
        )}
        {readOnly && <span className="memory-terminal-note">终态记录，不可恢复</span>}
      </div>
    </article>
  );
}

const isGlobalScopeOf = (memory: MemoryViewItem): boolean =>
  memory.scope.kind === 'user' || memory.scope.kind === 'expert';

const isDerived = (memory: MemoryViewItem): boolean =>
  memory.provenance.verification === 'verified' && memory.provenance.authority === 'derived';

interface ConflictPairProps {
  pair: MemoryConflictPair;
  memory: MemoryViewItem;
  allMemories: MemoryViewItem[];
  onResolve: ConflictResolver;
  workspaceName?: string;
  expertName?: string;
}

/**
 * 冲突并列呈现（产品设计 §3.4、契约 §5.5）。
 *
 * 文案固定为「可能冲突」：系统不按置信度或更新时间判断业务真假，
 * 用户可选替代旧规则（必须指明胜出记录）、写明适用条件后保留两条，或暂不处理。
 */
function ConflictPair({
  pair,
  memory,
  allMemories,
  onResolve,
  workspaceName,
  expertName,
}: ConflictPairProps): React.JSX.Element {
  const [note, setNote] = useState('');
  const [winner, setWinner] = useState(memory.id);
  const other = allMemories.find(
    (item) =>
      item.revisionId ===
      (pair.leftRevisionId === memory.revisionId ? pair.rightRevisionId : pair.leftRevisionId),
  );
  const state = pair.state;
  const notePoints = countCodePoints(note.trim());
  const canKeepBoth = notePoints >= 1 && notePoints <= MEMORY_APPLICABILITY_NOTE_MAX_CODE_POINTS;
  return (
    <div className={`memory-conflict conflict-${state}`} role="note">
      <strong>
        {state === 'unresolved'
          ? '可能冲突：两条口径指向同一议题，需要你澄清'
          : state === 'keep-both'
            ? '已确认并存（成对带入，适用条件见裁决记录）'
            : '已裁决为替代'}
      </strong>
      <div className="memory-conflict-bodies">
        <div>
          <span>本条</span>
          <p>{memory.content}</p>
          <small>{memoryScopeLabel(memory.scope, workspaceName, expertName)}</small>
        </div>
        <div>
          <span>另一条</span>
          {other ? (
            <>
              <p>{other.content}</p>
              <small>{memoryScopeLabel(other.scope, workspaceName, expertName)}</small>
            </>
          ) : (
            <p className="muted-text">另一条记录不在当前列表，可能已被替代或超出筛选范围。</p>
          )}
        </div>
      </div>
      {state === 'unresolved' && other && !isTerminalMemory(other) && !isTerminalMemory(memory) && (
        <div className="memory-conflict-actions">
          <label>
            <span>替代：保留哪一条</span>
            <select
              aria-label="替代后保留的记忆"
              value={winner}
              onChange={(event) => setWinner(event.target.value)}
            >
              <option value={memory.id}>本条</option>
              <option value={other.id}>另一条</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() =>
              onResolve(memory, other, 'replace', {
                winnerId: winner,
                applicabilityNote: '',
              })
            }
          >
            {winner === memory.id ? '替代另一条' : '替代本条'}
          </button>
          <input
            aria-label="适用条件说明"
            value={note}
            placeholder="并存：写出两条各自的适用条件"
            onChange={(event) => setNote(event.target.value)}
          />
          <button
            type="button"
            disabled={!canKeepBoth}
            onClick={() =>
              onResolve(memory, other, 'keep-both', {
                winnerId: '',
                applicabilityNote: note.trim(),
              })
            }
          >
            确认两条并存
          </button>
          <p className="memory-conflict-hint">
            替代要求两条处于同一规范范围，否则请先调整适用范围；写不出适用条件时不要确认并存。
            暂不处理可以让这组口径继续留在待澄清状态。
          </p>
        </div>
      )}
    </div>
  );
}
