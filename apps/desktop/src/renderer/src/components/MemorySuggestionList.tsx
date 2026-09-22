import type { MemoryJobSummary, MemoryViewItem } from '@betterwork/agent-protocol';
import { MEMORY_CANDIDATE_CONTENT_MAX_CODE_POINTS } from '@betterwork/agent-protocol';
import { useState } from 'react';

import type { MemorySuggestionsState } from '../hooks/use-memory-suggestions';
import { AlertIcon } from '../icons';
import { trackAction } from '../lib/async-action';
import { formatTime } from '../lib/format';
import {
  effectiveStatusLabel,
  facetLabel,
  formatValidityRange,
  isActiveMemoryJob,
  memoryJobStatusLabel,
  memoryProvenanceLabel,
  memoryScopeLabel,
} from '../lib/memory-labels';
import {
  canRetryJob,
  consentStateNotice,
  jobOutcomeLabel,
  latestJobLabel,
  memoryConsentDialogNotice,
} from '../lib/memory-suggestions';
import { ConfirmationDialog } from './ConfirmationDialog';
import { TransientToast } from './TransientToast';

/**
 * 经验建议批次（产品设计 §3.3、§3.4；WM11）。
 *
 * 两种呈现共用一份候选卡片：
 * - `context`：任务上下文面板里只看本任务的候选；
 * - `settings`：记忆页里看整个空间的开关、同意版本、作业与本轮结论。
 *
 * 三条来自验收清单的约束：
 * 1. **逐条候选不弹全局提示**——候选本身就是可见结果，动作交给调用方就地更新列表；
 * 2. **「0 条」与失败分开**——前者由 `jobOutcomeLabel` 说成成功结果，
 *    只有读取失败才落 `.inline-message.error`；
 * 3. **开关前必须看到代价与同意版本**——开启与关闭都先经确认对话框。
 */

export interface MemorySuggestionListProps {
  suggestions: MemorySuggestionsState;
  /** 上下文面板只给本任务的候选；记忆页给整个空间的候选。 */
  candidates: MemoryViewItem[];
  variant: 'settings' | 'context';
  workspaceName: string | undefined;
  expertName: string | undefined;
  /** 编辑并确认：调用方打开记忆编辑器，绝不静默确认。 */
  onEdit: (candidate: MemoryViewItem) => void;
  onReject: (candidate: MemoryViewItem) => void;
  onDelete: (candidate: MemoryViewItem) => void;
  /** 上下文面板才有「集中管理」跳转；记忆页本身就在管理页里。 */
  onOpenMemoryPage?: () => void;
}

export function MemorySuggestionList({
  suggestions,
  candidates,
  variant,
  workspaceName,
  expertName,
  onEdit,
  onReject,
  onDelete,
  onOpenMemoryPage,
}: MemorySuggestionListProps): React.JSX.Element {
  const jobLabel = latestJobLabel(suggestions.jobs);
  return (
    <section className={`context-section suggestion-section suggestion-${variant}`}>
      <div className="selected-materials-heading">
        <div>
          <strong>经验建议</strong>
          <small>
            {suggestions.loadingCandidates ? '正在读取建议批次…' : jobLabel} ·
            候选不会自动生效，也不会自动进入模型
          </small>
        </div>
        {variant === 'context' && onOpenMemoryPage && (
          <button type="button" onClick={onOpenMemoryPage}>
            集中管理
          </button>
        )}
      </div>
      {variant === 'settings' && <SuggestionSettings suggestions={suggestions} />}
      {suggestions.candidatesError && (
        <p className="inline-message error">{suggestions.candidatesError}</p>
      )}
      {suggestions.polling && (
        <p className="suggestion-polling">
          <AlertIcon size={12} /> 正在提炼，本面板可见期间才会查询进度。
        </p>
      )}
      {variant === 'settings' ? (
        <p className="context-hint">
          {candidates.length === 0
            ? '本轮没有待确认的建议。'
            : `当前有 ${candidates.length} 条待确认候选，见下方「待确认」分组。`}
        </p>
      ) : candidates.length === 0 ? (
        <p className="context-hint">
          没有与本任务相关的建议。开启自动建议后，每次运行最多产生 3 条，全部需要你亲自确认。
        </p>
      ) : (
        <div className="suggestion-list">
          {candidates.map((candidate) => (
            <SuggestionCard
              key={candidate.revisionId}
              candidate={candidate}
              workspaceName={workspaceName}
              expertName={expertName}
              onEdit={onEdit}
              onReject={onReject}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
      {suggestions.toast && (
        <TransientToast
          tone={suggestions.toast.tone}
          message={suggestions.toast.message}
          onDismiss={suggestions.dismissToast}
        />
      )}
    </section>
  );
}

/** 开关、同意版本与作业行：只有记忆页需要这一层。 */
function SuggestionSettings({
  suggestions,
}: {
  suggestions: MemorySuggestionsState;
}): React.JSX.Element {
  const [pendingToggle, setPendingToggle] = useState<boolean>();
  const enabled = suggestions.settings?.autoSuggestEnabled === true;
  const consentLabel =
    suggestions.settings?.consentVersion === undefined
      ? '未同意'
      : `同意版本 v${suggestions.settings.consentVersion}`;

  return (
    <div className="suggestion-consent">
      <div className="suggestion-setting-row">
        <div>
          <strong>任务完成后自动提炼建议</strong>
          <small>
            {suggestions.settingsLoading
              ? '正在读取本空间设置…'
              : `${enabled ? '已开启' : '已关闭'} · ${consentLabel}`}
          </small>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={suggestions.savingSettings || suggestions.settingsLoading}
          onClick={() => setPendingToggle(!enabled)}
        >
          {suggestions.savingSettings ? '正在提交…' : enabled ? '关闭自动建议' : '开启自动建议'}
        </button>
      </div>
      <p className="context-hint">{consentStateNotice(suggestions.settings)}</p>
      {suggestions.settingsError && (
        <p className="inline-message error">{suggestions.settingsError}</p>
      )}
      {suggestions.jobsError && <p className="inline-message error">{suggestions.jobsError}</p>}
      {suggestions.jobs.length > 0 && (
        <ul className="suggestion-job-list">
          {suggestions.jobs.slice(0, 5).map((job) => (
            <SuggestionJobRow
              key={job.id}
              job={job}
              busy={suggestions.savingSettings}
              onCancel={(job) => {
                trackAction(suggestions.cancelJob(job), '取消提炼作业');
              }}
              onRetry={(job) => {
                trackAction(suggestions.retryJob(job), '重新提炼作业');
              }}
            />
          ))}
        </ul>
      )}
      {pendingToggle !== undefined && (
        <ConfirmationDialog
          title={pendingToggle ? '开启自动经验建议？' : '关闭自动经验建议？'}
          detail={memoryConsentDialogNotice(pendingToggle)}
          confirmLabel={pendingToggle ? '我已了解，开启' : '确认关闭'}
          onConfirm={() => {
            const next = pendingToggle;
            setPendingToggle(undefined);
            // 开关结果由 hook 呈现（就地短时确认），这里只负责不吞掉异常。
            trackAction(suggestions.setAutoSuggest(next), '更新自动建议开关');
          }}
          onCancel={() => setPendingToggle(undefined)}
        />
      )}
    </div>
  );
}

function SuggestionJobRow({
  job,
  busy,
  onCancel,
  onRetry,
}: {
  job: MemoryJobSummary;
  busy: boolean;
  onCancel: (job: MemoryJobSummary) => void;
  onRetry: (job: MemoryJobSummary) => void;
}): React.JSX.Element {
  return (
    <li className="suggestion-job-row">
      <div>
        <strong>{memoryJobStatusLabel[job.status]}</strong>
        <small>
          {jobOutcomeLabel(job)} · {formatTime(job.updatedAt)}
          {job.modelLabel ? ` · ${job.modelLabel}` : ''}
          {job.attempt > 1 ? ` · 第 ${job.attempt} 次尝试` : ''}
        </small>
      </div>
      {isActiveMemoryJob(job.status) && (
        <button type="button" disabled={busy} onClick={() => onCancel(job)}>
          取消
        </button>
      )}
      {canRetryJob(job) && (
        <button type="button" disabled={busy} onClick={() => onRetry(job)}>
          重新提炼
        </button>
      )}
    </li>
  );
}

function SuggestionCard({
  candidate,
  workspaceName,
  expertName,
  onEdit,
  onReject,
  onDelete,
}: {
  candidate: MemoryViewItem;
  workspaceName: string | undefined;
  expertName: string | undefined;
  onEdit: (candidate: MemoryViewItem) => void;
  onReject: (candidate: MemoryViewItem) => void;
  onDelete: (candidate: MemoryViewItem) => void;
}): React.JSX.Element {
  const unresolved = candidate.conflicts.filter((pair) => pair.state === 'unresolved');
  const dependencies =
    candidate.provenance.verification === 'verified'
      ? candidate.provenance.materialDependencies.length +
        candidate.provenance.memoryDependencies.length
      : 0;
  const bodyLimit = Math.min(MEMORY_CANDIDATE_CONTENT_MAX_CODE_POINTS, 500);
  return (
    <article className="suggestion-card">
      <div className="suggestion-head">
        <span className="memory-kind">{facetLabel[candidate.facet]}</span>
        <span className="memory-state">{effectiveStatusLabel[candidate.effectiveStatus]}</span>
        <small>{memoryScopeLabel(candidate.scope, workspaceName, expertName)}</small>
      </div>
      <p className="suggestion-body">{candidate.content.slice(0, bodyLimit)}</p>
      <ul className="suggestion-facts">
        <li>来源：{memoryProvenanceLabel(candidate)}</li>
        <li>
          依赖：
          {dependencies === 0 ? '无资料或记忆依赖' : `${dependencies} 项，使用时仍需本期可访问`}
        </li>
        <li>
          有效期：
          {formatValidityRange(candidate.validFrom, candidate.validUntil)}
        </li>
        {candidate.requiresMaterialSelection && (
          <li className="warn">这条来自资料；确认不会替你选入原资料。</li>
        )}
        {candidate.sourceAvailability !== 'available' && (
          <li className="warn">来源当前不可直接引用，确认前请先复核。</li>
        )}
        {unresolved.length > 0 && (
          <li className="warn">可能冲突：同一议题下另有待澄清的口径，确认前请先看两边。</li>
        )}
      </ul>
      <div className="suggestion-actions">
        <button type="button" className="primary-button" onClick={() => onEdit(candidate)}>
          编辑并确认
        </button>
        <button type="button" className="secondary-button" onClick={() => onReject(candidate)}>
          暂不采用
        </button>
        <button type="button" className="danger-text" onClick={() => onDelete(candidate)}>
          删除
        </button>
      </div>
    </article>
  );
}
