import type { MemoryJobSummary, MemoryViewItem } from '@betterwork/agent-protocol';
import { MEMORY_CANDIDATE_CONTENT_MAX_CODE_POINTS } from '@betterwork/agent-protocol';
import { useState } from 'react';

import { InlineError } from '../components/InlineError';
import type { MemorySuggestionsState } from '../hooks/use-memory-suggestions';
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
import { InlineLoading } from './AsyncButton';
import { Badge, type BadgeTone } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { ConfirmationDialog } from './ConfirmationDialog';
import { Disclosure } from './Disclosure';
import { EmptyNotice } from './EmptyState';
import { ListRow } from './ListRow';
import { SectionHeader } from './SectionHeader';
import { StatusNote } from './StatusNote';
import { Switch } from './Switch';
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
 *    只有读取失败才落 `InlineError`（docs/10 §11.5.1 第二落点）；
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
    <section
      className={`${variant === 'context' ? 'context-section ' : ''}suggestion-section suggestion-${variant}`}
    >
      <SectionHeader
        title="经验建议"
        hint={
          suggestions.loadingCandidates
            ? '正在读取建议批次…'
            : variant === 'settings'
              ? `${suggestions.jobs.length === 0 ? '暂无提炼作业' : jobLabel} · ${candidates.length} 条待确认`
              : `${jobLabel} · 候选不会自动生效，也不会自动进入模型`
        }
        actions={
          variant === 'context' && onOpenMemoryPage ? (
            <Button variant="chip" size="sm" type="button" onClick={onOpenMemoryPage}>
              集中管理
            </Button>
          ) : undefined
        }
      />
      {variant === 'settings' && <SuggestionSettings suggestions={suggestions} />}
      {suggestions.candidatesError && <InlineError message={suggestions.candidatesError} />}
      {suggestions.polling && (
        <InlineLoading
          className="suggestion-polling"
          label="正在提炼，本面板可见期间才会查询进度。"
        />
      )}
      {variant === 'settings' ? (
        candidates.length > 0 ? (
          <StatusNote
            message={`当前有 ${candidates.length} 条待确认候选，见下方「待确认」分组。`}
          />
        ) : null
      ) : candidates.length === 0 ? (
        <EmptyNotice
          title="没有与本任务相关的建议"
          detail="开启自动建议后，每次运行最多产生 3 条，全部需要你亲自确认。"
        />
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
      <ListRow
        variant="plain"
        title="任务完成后自动提炼建议"
        meta={
          suggestions.settingsLoading
            ? '正在读取本空间设置…'
            : suggestions.savingSettings
              ? '正在提交…'
              : `${enabled ? '已开启' : '已关闭'} · ${consentLabel}`
        }
        actions={
          <Switch
            label="自动提炼建议"
            checked={enabled}
            disabled={suggestions.settingsLoading || suggestions.savingSettings}
            onChange={() => setPendingToggle(!enabled)}
          />
        }
      />
      {suggestions.settingsError && <InlineError message={suggestions.settingsError} />}
      {suggestions.jobsError && <InlineError message={suggestions.jobsError} />}
      {suggestions.jobs.some((job) => isActiveMemoryJob(job.status) || canRetryJob(job)) && (
        <ul className="suggestion-job-list">
          {suggestions.jobs
            .filter((job) => isActiveMemoryJob(job.status) || canRetryJob(job))
            .map((job) => (
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
      <Disclosure label="提炼规则与历史作业">
        <StatusNote message={consentStateNotice(suggestions.settings)} />
        <StatusNote message="候选不会自动生效，也不会自动进入模型；确认前请核对内容与适用范围。" />
        {suggestions.jobs.some((job) => !isActiveMemoryJob(job.status) && !canRetryJob(job)) && (
          <ul className="suggestion-job-list">
            {suggestions.jobs
              .filter((job) => !isActiveMemoryJob(job.status) && !canRetryJob(job))
              .slice(0, 5)
              .map((job) => (
                <SuggestionJobRow
                  key={job.id}
                  job={job}
                  busy={suggestions.savingSettings}
                  onCancel={(job) => trackAction(suggestions.cancelJob(job), '取消提炼作业')}
                  onRetry={(job) => trackAction(suggestions.retryJob(job), '重新提炼作业')}
                />
              ))}
          </ul>
        )}
      </Disclosure>
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
    <ListRow
      as="li"
      variant="plain"
      className="suggestion-job-row"
      title={memoryJobStatusLabel[job.status]}
      meta={
        <>
          {jobOutcomeLabel(job)} · {formatTime(job.updatedAt)}
          {job.modelLabel ? ` · ${job.modelLabel}` : ''}
          {job.attempt > 1 ? ` · 第 ${job.attempt} 次尝试` : ''}
        </>
      }
      actions={
        <>
          {isActiveMemoryJob(job.status) && (
            <Button
              variant="quiet"
              size="sm"
              type="button"
              disabled={busy}
              onClick={() => onCancel(job)}
            >
              取消
            </Button>
          )}
          {canRetryJob(job) && (
            <Button
              variant="quiet"
              size="sm"
              type="button"
              disabled={busy}
              onClick={() => onRetry(job)}
            >
              重新提炼
            </Button>
          )}
        </>
      }
    />
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
  /**
   * 生效状态 → 徽标档位（docs/10 §10.1）：状态文字一律由 `Badge` 画，
   * 页面只决定用语义色。待确认＝需要用户处理，已确认＝品牌色，
   * 已被替代／过期／以后不用＝历史状态，降到低对比档。
   */
  const effectiveStatusTone: Record<MemoryViewItem['effectiveStatus'], BadgeTone> = {
    candidate: 'warning',
    rejected: 'outline',
    confirmed: 'brand',
    superseded: 'outline',
    expired: 'outline',
    deleted: 'outline',
  };

  const bodyLimit = Math.min(MEMORY_CANDIDATE_CONTENT_MAX_CODE_POINTS, 500);
  return (
    <Card
      className="suggestion-card"
      footer={
        <>
          <Button variant="primary" size="md" type="button" onClick={() => onEdit(candidate)}>
            编辑并确认
          </Button>
          <Button variant="secondary" size="md" type="button" onClick={() => onReject(candidate)}>
            暂不采用
          </Button>
          <Button
            variant="quiet"
            size="md"
            tone="danger"
            type="button"
            onClick={() => onDelete(candidate)}
          >
            删除
          </Button>
        </>
      }
    >
      <div className="suggestion-head">
        <Badge shape="tag">{facetLabel[candidate.facet]}</Badge>
        <Badge shape="tag" tone={effectiveStatusTone[candidate.effectiveStatus]}>
          {effectiveStatusLabel[candidate.effectiveStatus]}
        </Badge>
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
    </Card>
  );
}
