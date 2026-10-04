import type {
  WorkspaceBrief,
  WorkspaceBriefMemoryItem,
  WorkspaceBriefOpenIssue,
  WorkspaceReferenceListItem,
} from '@betterwork/agent-protocol';
import { useState } from 'react';

import { ChevronRightIcon } from '../icons';
import { memoryScopeLabel } from '../lib/memory-labels';
import { InlineLoading } from './AsyncButton';
import { Button } from './Button';
import { EmptyNotice } from './EmptyState';
import { InlineError } from './InlineError';
import { ListRow } from './ListRow';
import { SectionHeader } from './SectionHeader';
import { TransientToast } from './TransientToast';

/**
 * 工作空间简报：现有事实的可重建视图（产品设计 §3.6、实施契约 §10）。
 *
 * 只读、不整体注入、不调用模型；每条都能跳回来源。三态必须诚实：
 * - 空态说明「这里只汇总已确认的口径」，不自动补内容；
 * - 错误态给重试入口——简报每次现取，失败时不拿上一次的旧内容冒充现状；
 * - 未决讨论节点标成「未决事项」，不写成已确认结论；
 * - 资料派生的条目标注「使用时仍需本期选入资料」，不因进入简报而获得读取授权。
 */

const SECTIONS: { key: BriefSectionKey; label: string; hint: string }[] = [
  { key: 'goals', label: '目标', hint: '已确认要达成的事' },
  { key: 'constraints', label: '约束', hint: '已确认不能越过的线' },
  { key: 'decisions', label: '决策', hint: '已确认的口径与取舍' },
  { key: 'methods', label: '方法', hint: '已确认的工作方法' },
];

type BriefSectionKey = 'goals' | 'constraints' | 'decisions' | 'methods';

export interface WorkspaceBriefProps {
  brief: WorkspaceBrief | undefined;
  loading: boolean;
  error: string;
  workspaceName: string | undefined;
  expertName: string | undefined;
  onRetry: () => void;
  onOpenMemory: (item: WorkspaceBriefMemoryItem) => void;
  onOpenIssue: (issue: WorkspaceBriefOpenIssue) => void;
  onOpenReference: (item: WorkspaceReferenceListItem) => void;
}

export function WorkspaceBrief({
  brief,
  loading,
  error,
  workspaceName,
  expertName,
  onRetry,
  onOpenMemory,
  onOpenIssue,
  onOpenReference,
}: WorkspaceBriefProps): React.JSX.Element {
  const [notice, setNotice] = useState('');
  if (error) {
    return (
      <div className="brief-panel">
        <InlineError message={error} onRetry={onRetry} />
        <p className="brief-note">简报每次现取，读取失败时不会用旧内容代替现状。</p>
      </div>
    );
  }
  if (loading && brief === undefined) {
    return <InlineLoading className="brief-loading" label="正在读取工作空间简报…" />;
  }
  if (!brief) {
    // 空态由 `EmptyNotice` 渲染，列内缩仍归 `.brief-panel` 这件已登记的分段壳——
    // 此前 `.context-placeholder` 一个类同时管这两件事，于是简报的空态长得跟别处不一样。
    return (
      <div className="brief-panel">
        <EmptyNotice
          placement="start"
          title="暂无简报"
          detail="确认几条目标、约束或方法后，这里会按当前空间汇总。简报不落库，也不会整体交给模型。"
        />
      </div>
    );
  }
  const nothingYet =
    SECTIONS.every(({ key }) => brief[key].items.length === 0) &&
    brief.openIssues.items.length === 0 &&
    brief.referenceVersions.items.length === 0;
  if (nothingYet) {
    return (
      <div className="brief-panel">
        <EmptyNotice
          placement="start"
          title="这个空间还没有可汇总的工作积累"
          detail="在任务里保存或确认记忆后，简报会把已确认的目标、约束、决策与方法按当前空间列在这里；候选与未确认内容不会进入简报。"
        />
      </div>
    );
  }
  return (
    <div className="brief-panel">
      <p className="brief-note">
        简报每次现取、只读不注入：这里显示已确认内容，不代表本次运行一定带入模型。
      </p>
      {SECTIONS.map(({ key, label, hint }) => (
        <BriefSection
          key={key}
          title={label}
          hint={hint}
          section={brief[key]}
          workspaceName={workspaceName}
          expertName={expertName}
          onOpenMemory={onOpenMemory}
        />
      ))}
      <section className="brief-section">
        <SectionHeader title="未决事项" hint="讨论节点原样保留，未确认的结论不会被写成已确认" />
        {brief.openIssues.items.length === 0 ? (
          <EmptyNotice title="当前没有开放的讨论节点。" />
        ) : (
          <ul className="brief-list">
            {brief.openIssues.items.map((issue) => (
              <li key={issue.checkpointId}>
                <ListRow
                  multiline
                  variant="plain"
                  onClick={() => onOpenIssue(issue)}
                  label={`查看未决事项「${issue.summary || '（无小结）'}」`}
                  title={issue.summary || '（无小结）'}
                  meta={
                    <>
                      未决事项
                      {issue.nextAction ? ` · 下一步：${issue.nextAction}` : ''}
                      {issue.feedback ? ' · 已有反馈' : ''}
                    </>
                  }
                  trailing={<ChevronRightIcon size={12} />}
                />
              </li>
            ))}
          </ul>
        )}
        {brief.openIssues.truncated && (
          <small className="brief-truncated">
            共 {brief.openIssues.total} 项，这里只列最近 {brief.openIssues.items.length} 项。
          </small>
        )}
      </section>
      <section className="brief-section">
        <SectionHeader
          title="参考成果版本"
          hint="标记只表示「选它作参考」，不表示内容正确、审批通过或本期已读取"
        />
        {brief.referenceVersions.items.length === 0 ? (
          <EmptyNotice title="还没有指定参考版本。在成果版本详情里可「指定为本空间参考版本」。" />
        ) : (
          <ul className="brief-list">
            {brief.referenceVersions.items.map((item) => (
              <li key={item.reference.id}>
                <ListRow
                  multiline
                  variant="plain"
                  onClick={() => onOpenReference(item)}
                  label={`查看参考版本「${item.reference.label ?? '未命名参考版本'}」`}
                  title={item.reference.label ?? '未命名参考版本'}
                  meta={`${item.status === 'ready' ? '版本可用' : '版本已不可用'} · 固定精确版本，不跟随最新`}
                  trailing={<ChevronRightIcon size={12} />}
                />
              </li>
            ))}
          </ul>
        )}
        {brief.referenceVersions.total > brief.referenceVersions.items.length && (
          <Button
            variant="text"
            size="sm"
            type="button"
            onClick={() => setNotice('简报只列最近 5 个参考版本，完整列表在成果页。')}
          >
            共 {brief.referenceVersions.total} 个参考版本
          </Button>
        )}
      </section>
      {notice && <TransientToast tone="success" message={notice} onDismiss={() => setNotice('')} />}
    </div>
  );
}

function BriefSection({
  title,
  hint,
  section,
  workspaceName,
  expertName,
  onOpenMemory,
}: {
  title: string;
  hint: string;
  section: WorkspaceBrief['goals'];
  workspaceName: string | undefined;
  expertName: string | undefined;
  onOpenMemory: (item: WorkspaceBriefMemoryItem) => void;
}): React.JSX.Element {
  if (section.items.length === 0) return <></>;
  return (
    <section className="brief-section">
      <SectionHeader title={title} hint={hint} />
      <ul className="brief-list">
        {section.items.map((item) => (
          <li key={`${item.memoryId}:${item.revisionId}`}>
            <ListRow
              multiline
              variant="plain"
              onClick={() => onOpenMemory(item)}
              label={`查看记忆「${item.content}」`}
              title={item.content}
              meta={
                <>
                  {memoryScopeLabel(item.scope, workspaceName, expertName)} ·{' '}
                  {item.requiresMaterialSelection
                    ? '使用时仍需本期选入资料'
                    : '自包含口径，可直接复用'}
                  {item.sourceAvailability === 'unavailable' ? ' · 来源已不可用' : ''}
                  {item.sourceAvailability === 'review-required' ? ' · 来源待复核' : ''}
                </>
              }
              trailing={<ChevronRightIcon size={12} />}
            />
          </li>
        ))}
      </ul>
      {section.truncated && (
        <small className="brief-truncated">
          共 {section.total} 条，这里只列最近 {section.items.length} 条。
        </small>
      )}
    </section>
  );
}
