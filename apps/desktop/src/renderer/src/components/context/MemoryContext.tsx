import type {
  MemoryDecisionSummary,
  MemoryRecallExclusion,
  MemoryRunContextData,
  MemorySelectedMemory,
  MemoryViewItem,
} from '@betterwork/agent-protocol';

import type { MemorySuggestionsState } from '../../hooks/use-memory-suggestions';
import type { RunMemoriesState, TaskMemoryExclusionState } from '../../hooks/use-run-memories';
import type { TaskMemoryExclusionsState } from '../../hooks/use-task-memory-exclusions';
import {
  effectiveStatusLabel,
  memoryRunPhaseLabel,
  memoryScopeLabel,
  recallExclusionLabel,
  replayBoundaryLabel,
  selectionReasonLabel,
} from '../../lib/memory-labels';
import { AsyncButton, InlineLoading } from '../AsyncButton';
import { Button } from '../Button';
import { Disclosure } from '../Disclosure';
import { EmptyNotice } from '../EmptyState';
import { InlineError } from '../InlineError';
import { ListRow } from '../ListRow';
import { MemorySuggestionList } from '../MemorySuggestionList';
import { SectionHeader } from '../SectionHeader';
import { StatusNote } from '../StatusNote';

export interface MemoryContextProps {
  suggestions: MemorySuggestionsState;
  taskCandidates: MemoryViewItem[];
  workspaceName: string | undefined;
  expertName: string | undefined;
  onEditCandidate: (candidate: MemoryViewItem) => void;
  onRejectCandidate: (candidate: MemoryViewItem) => void;
  onDeleteCandidate: (candidate: MemoryViewItem) => void;
  onOpenMemoryPage: () => void;
  memoriesError: string;
  memoriesWarning: string;
  runMemories: RunMemoriesState;
  memories: MemoryViewItem[];
  excludedMemoryIds: string[];
  onToggleMemory: (memoryId: string) => void;
  exclusion: TaskMemoryExclusionState;
  exclusions: TaskMemoryExclusionsState;
  onSelectMaterials: () => void;
  onOpenArtifacts: () => void;
}

export function MemoryContext({
  suggestions,
  taskCandidates,
  workspaceName,
  expertName,
  onEditCandidate,
  onRejectCandidate,
  onDeleteCandidate,
  onOpenMemoryPage,
  memoriesError,
  memoriesWarning,
  runMemories,
  memories,
  excludedMemoryIds,
  onToggleMemory,
  exclusion,
  exclusions,
  onSelectMaterials,
  onOpenArtifacts,
}: MemoryContextProps): React.JSX.Element {
  return (
    <>
      <MemorySuggestionList
        suggestions={suggestions}
        candidates={taskCandidates}
        variant="context"
        workspaceName={workspaceName}
        expertName={expertName}
        onEdit={onEditCandidate}
        onReject={onRejectCandidate}
        onDelete={onDeleteCandidate}
        onOpenMemoryPage={onOpenMemoryPage}
      />
      {memoriesError && <InlineError message={memoriesError} />}
      {memoriesWarning && (
        <section className="context-section">
          <StatusNote tone="warning" message={memoriesWarning} />
        </section>
      )}
      <NextRunScopeSection
        runMemories={runMemories}
        memories={memories}
        excludedMemoryIds={excludedMemoryIds}
        onToggleMemory={onToggleMemory}
        exclusion={exclusion}
        workspaceName={workspaceName}
        expertName={expertName}
      />
      <ExcludedTaskMemoriesSection
        exclusions={exclusions}
        excludedMemoryIds={excludedMemoryIds}
        onToggleMemory={onToggleMemory}
        exclusion={exclusion}
        workspaceName={workspaceName}
        expertName={expertName}
      />
      <ThisRunMemorySection runMemories={runMemories} memories={memories} />
      <HistoryAdjustmentSection
        runMemories={runMemories}
        onSelectMaterials={onSelectMaterials}
        onOpenArtifacts={onOpenArtifacts}
        onOpenMemoryPage={onOpenMemoryPage}
      />
    </>
  );
}

/** 「下次运行可用」：范围预览，不是实际使用记录（产品设计 §3.5）。 */
function NextRunScopeSection({
  runMemories,
  memories,
  excludedMemoryIds,
  onToggleMemory,
  exclusion,
  workspaceName,
  expertName,
}: {
  runMemories: RunMemoriesState;
  memories: MemoryViewItem[];
  excludedMemoryIds: string[];
  onToggleMemory: (memoryId: string) => void;
  exclusion: TaskMemoryExclusionState;
  workspaceName: string | undefined;
  expertName: string | undefined;
}): React.JSX.Element {
  const { preview, previewLoading, previewError, previewAvailable, requestPreview } = runMemories;
  const byId = new Map(memories.map((memory) => [memory.id, memory]));
  return (
    <section className="context-section memory-scope-section">
      <SectionHeader
        title="下次运行可用"
        hint="范围预览：按当前任务输入试算，不是本次实际使用记录"
        actions={
          <Button
            variant="chip"
            size="sm"
            type="button"
            onClick={requestPreview}
            disabled={!previewAvailable}
          >
            重新试算
          </Button>
        }
      />
      {!previewAvailable ? (
        <EmptyNotice
          title="还没有可试算的输入"
          detail="任务上下文或输入变化后，这里才会给出候选范围。"
        />
      ) : previewLoading ? (
        <InlineLoading label="正在按当前输入试算可用范围…" />
      ) : previewError ? (
        <InlineError message={previewError} onRetry={requestPreview} />
      ) : preview === undefined ? (
        <EmptyNotice title="暂无预览结果。" />
      ) : (
        <>
          {preview.selectedItems.length === 0 ? (
            <EmptyNotice title="按当前输入，没有匹配到可用记忆。" />
          ) : (
            <div className="context-list">
              {preview.selectedItems.map((item) => (
                <MemoryScopeRow
                  key={item.revisionId}
                  item={item}
                  memory={byId.get(item.memoryId)}
                  excluded={excludedMemoryIds.includes(item.memoryId)}
                  saving={exclusion.savingMemoryId === item.memoryId}
                  onToggleMemory={onToggleMemory}
                  workspaceName={workspaceName}
                  expertName={expertName}
                />
              ))}
            </div>
          )}
          {exclusion.error && <InlineError message={exclusion.error} />}
          <RecallExclusions summary={preview.decisionSummary} byId={byId} />
          <p className="context-note">
            以上是范围预览。本次运行真正带了哪些，以下方「本次运行记忆」为准。
          </p>
        </>
      )}
    </section>
  );
}

function MemoryScopeRow({
  item,
  memory,
  excluded,
  saving,
  onToggleMemory,
  workspaceName,
  expertName,
}: {
  item: MemorySelectedMemory;
  memory: MemoryViewItem | undefined;
  excluded: boolean;
  saving: boolean;
  onToggleMemory: (memoryId: string) => void;
  workspaceName: string | undefined;
  expertName: string | undefined;
}): React.JSX.Element {
  return (
    <ListRow
      variant="card"
      className={excluded ? 'excluded' : undefined}
      title={memory?.content ?? '该记忆的正文不在当前清单内'}
      meta={
        <>
          第 {item.order} 位 · {selectionReasonLabel[item.reason]} ·{' '}
          {memory ? memoryScopeLabel(memory.scope, workspaceName, expertName) : item.memoryId} ·{' '}
          {memory ? `v${memory.revision}` : ''}
        </>
      }
      actions={
        <AsyncButton
          size="sm"
          busy={saving}
          label={excluded ? '恢复使用' : '本任务不用'}
          busyLabel="正在调整…"
          onClick={() => onToggleMemory(item.memoryId)}
        />
      }
    />
  );
}

/**
 * 「本任务已排除」独立清单（改进 Spec §5）：条目来自持久化 TaskContext，
 * 换问法、预览失败、重启后都还在；恢复的只是参与选择的资格，不保证重新入选。
 * 越范围或已不存在的 ID 只显示占位，不泄露正文、标题或来源。
 */
function ExcludedTaskMemoriesSection({
  exclusions,
  excludedMemoryIds,
  onToggleMemory,
  exclusion,
  workspaceName,
  expertName,
}: {
  exclusions: TaskMemoryExclusionsState;
  excludedMemoryIds: string[];
  onToggleMemory: (memoryId: string) => void;
  exclusion: TaskMemoryExclusionState;
  workspaceName: string | undefined;
  expertName: string | undefined;
}): React.JSX.Element {
  return (
    <section className="context-section memory-excluded-section">
      <SectionHeader
        title="本任务已排除"
        hint="来自本任务的持久化设置：换问法、重启或预览失败都保留在这里"
        actions={
          <AsyncButton
            variant="chip"
            size="sm"
            busy={exclusions.loading}
            label="刷新"
            busyLabel="正在读取…"
            onClick={exclusions.reload}
          />
        }
      />
      {exclusions.error !== '' && (
        <InlineError message={exclusions.error} onRetry={exclusions.reload} />
      )}
      {exclusions.error === '' && exclusions.items.length === 0 ? (
        <EmptyNotice title="这个任务目前没有排除任何记忆。" />
      ) : (
        <div className="context-list">
          {exclusions.items.map((item) => (
            <ListRow
              key={item.memoryId}
              variant="card"
              title={item.visibility === 'visible' ? item.content : '此项当前不可查看'}
              meta={
                item.visibility === 'visible' ? (
                  <>
                    {effectiveStatusLabel[item.effectiveStatus]} ·{' '}
                    {memoryScopeLabel(item.scope, workspaceName, expertName)}
                  </>
                ) : (
                  '不在本任务可管理范围内，或记录已被删除'
                )
              }
              actions={
                <AsyncButton
                  size="sm"
                  busy={exclusion.savingMemoryId === item.memoryId}
                  label={item.visibility === 'visible' ? '恢复参与选择' : '移除此排除'}
                  busyLabel="正在调整…"
                  onClick={() => onToggleMemory(item.memoryId)}
                />
              }
            />
          ))}
        </div>
      )}
      {excludedMemoryIds.length > 0 && exclusions.items.length === 0 && exclusions.error === '' ? (
        <StatusNote tone="warning" message="任务上下文记录了排除项，但清单尚未读取，请点击刷新。" />
      ) : null}
    </section>
  );
}

/** 落选原因逐条可解释；「预算落选」不等于授权撤销，措辞必须区分（契约 §6.1）。 */
function RecallExclusions({
  summary,
  byId,
}: {
  summary: MemoryDecisionSummary;
  byId: Map<string, MemoryViewItem>;
}): React.JSX.Element | null {
  const shown = summary.exclusions.filter((exclusion) => exclusion.count > 0);
  if (shown.length === 0 && !summary.conflictReviewRequired) return null;
  return (
    <Disclosure className="context-details" label="为什么这些没有进入范围">
      {summary.conflictReviewRequired && (
        <StatusNote
          tone="warning"
          message="存在待澄清口径：同一议题下两条已确认规则尚未裁决，本次一组都不带入。请到记忆页澄清。"
        />
      )}
      <ul className="context-exclusion-list">
        {shown.map((exclusion) => (
          <ExclusionRow key={exclusion.reason} exclusion={exclusion} byId={byId} />
        ))}
      </ul>
      <small>
        本次条目 {summary.budget.totalItems} 项 · 正文 {summary.budget.contentCodePoints} 字 · 整块{' '}
        {summary.budget.blockCodePoints} 字
        {summary.queryTruncated ? ' · 输入过长，已按首尾片段试算' : ''}
      </small>
    </Disclosure>
  );
}

function ExclusionRow({
  exclusion,
  byId,
}: {
  exclusion: MemoryRecallExclusion;
  byId: Map<string, MemoryViewItem>;
}): React.JSX.Element {
  // 未裁决的口径与待复核来源只报身份，不展示正文：§3.4 要求这组在澄清前不进入召回，
  // 界面也不能替用户判定哪条该生效。
  const hidesBody =
    exclusion.reason === 'conflict-unresolved' || exclusion.reason === 'source-review-required';
  const names = hidesBody
    ? []
    : exclusion.identities
        .map((identity) => byId.get(identity.memoryId)?.content)
        .filter((content): content is string => content !== undefined);
  return (
    <li>
      <span>
        {recallExclusionLabel[exclusion.reason]} · {exclusion.count} 条
      </span>
      {names.length > 0 && (
        <small>
          {names.slice(0, 2).join('；')}
          {names.length > 2 ? ` 等 ${names.length} 条` : ''}
        </small>
      )}
    </li>
  );
}

/** 「本次运行记忆」：精确修订、顺序、理由与请求阶段（产品设计 §3.5）。 */
function ThisRunMemorySection({
  runMemories,
  memories,
}: {
  runMemories: RunMemoriesState;
  memories: MemoryViewItem[];
}): React.JSX.Element {
  const { runContext, contextLoading, contextError, refreshRunContext } = runMemories;
  return (
    <section className="context-section memory-run-section">
      <SectionHeader
        title="本次运行记忆"
        hint="登记的是宿主的准备阶段，不表示模型已读到"
        actions={
          <Button variant="chip" size="sm" type="button" onClick={refreshRunContext}>
            刷新
          </Button>
        }
      />
      {contextError ? (
        <InlineError message={contextError} onRetry={refreshRunContext} />
      ) : contextLoading && runContext === undefined ? (
        <InlineLoading label="正在读取本次运行的记忆登记…" />
      ) : runContext === undefined ? (
        <EmptyNotice title="还没有运行记录" detail="任务开始后才能看到本次登记的精确修订。" />
      ) : (
        <RunContextBody context={runContext} memories={memories} />
      )}
    </section>
  );
}

function RunContextBody({
  context,
  memories,
}: {
  context: MemoryRunContextData;
  memories: MemoryViewItem[];
}): React.JSX.Element {
  const byId = new Map(memories.map((memory) => [memory.id, memory]));
  const selected = context.context?.selectedItems ?? [];
  return (
    <>
      <StatusNote
        message={
          <>
            请求阶段：{memoryRunPhaseLabel[context.phase]}
            {context.phase === 'legacy_unknown' ? '' : ' · 阶段只描述宿主做到哪一步'}
          </>
        }
      />
      {context.phase === 'legacy_unknown' && (
        <StatusNote message="这是记忆治理改造前的旧运行，没有请求审计行，无法确认当时带到哪一步；这里只列已登记的引用，不回填发送时间与请求哈希。" />
      )}
      {context.context === undefined && context.phase !== 'legacy_unknown' ? (
        <StatusNote message="审计行尚未写入，只有引用记录可读。" />
      ) : (
        selected.length === 0 && <EmptyNotice title="本次运行没有登记带入的记忆。" />
      )}
      <div className="context-list">
        {selected.map((item) => {
          const memory = byId.get(item.memoryId);
          const read = context.reads.find((entry) => entry.memoryRevisionId === item.revisionId);
          return (
            <ListRow
              key={item.revisionId}
              multiline
              variant="plain"
              title={memory?.content ?? `记忆 ${item.memoryId}`}
              meta={
                <>
                  第 {item.order} 位 · {selectionReasonLabel[item.reason]} · 修订{' '}
                  {item.revisionId.slice(0, 8)} · 哈希 {item.contentHash.slice(0, 8)}
                  {read?.provenanceState === 'legacy_unknown' ? ' · 旧版来源' : ''}
                  {read && read.replayedViaRunIds.length > 0
                    ? ` · 经 ${read.replayedViaRunIds.length} 次历史轮次带入`
                    : ''}
                </>
              }
            />
          );
        })}
      </div>
      {context.context && (
        <RecallExclusions summary={context.context.decisionSummary} byId={byId} />
      )}
    </>
  );
}

/** 「历史上下文调整」：被截断的轮次与可解释原因（产品设计 §3.5、契约 §6.3）。 */
function HistoryAdjustmentSection({
  runMemories,
  onSelectMaterials,
  onOpenArtifacts,
  onOpenMemoryPage,
}: {
  runMemories: RunMemoriesState;
  /** MI08：历史截断后给可返回的恢复入口，而不是只解释为什么没带。 */
  onSelectMaterials: () => void;
  onOpenArtifacts: () => void;
  onOpenMemoryPage: () => void;
}): React.JSX.Element {
  const replay = runMemories.runContext?.context?.replay ?? [];
  const known = runMemories.runContext?.phase !== 'legacy_unknown';
  return (
    <section className="context-section memory-history-section">
      <SectionHeader title="历史上下文调整" hint="哪些旧轮次没带、为什么没带" />
      {!known ? (
        <StatusNote message="旧版运行没有历史重放审计，无法确认当时的轮次取舍。" />
      ) : replay.length === 0 ? (
        <EmptyNotice title="本次没有复用历史轮次" detail="只按当前任务上下文工作。" />
      ) : (
        <ul className="context-replay-list">
          {replay.map((entry) => (
            <li key={entry.runId}>
              {entry.replayed ? (
                <span>
                  已带入旧轮次 {entry.runId.slice(0, 8)} · {entry.contentCodePoints} 字
                </span>
              ) : (
                <span>
                  未带入 {entry.runId.slice(0, 8)} · {replayBoundaryLabel[entry.reason]}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="context-note">
        旧轮次只是这次不发送，对话没有被删除；记忆被修订、排除、失效或材料换版本时，相关旧回答不会继续当作事实使用。
      </p>
      <div className="context-continuity-actions">
        <Button variant="chip" size="sm" type="button" onClick={onSelectMaterials}>
          选择本期材料
        </Button>
        <Button variant="chip" size="sm" type="button" onClick={onOpenArtifacts}>
          查看上期成果版本
        </Button>
        <Button variant="chip" size="sm" type="button" onClick={onOpenMemoryPage}>
          到记忆详情保留方法
        </Button>
      </div>
      <p className="context-note">
        引用旧成果只固定你选定的那一版，标记参考不等于已读取；要把上期方法长期留下，请在记忆详情以你的口径重新表述，系统不会自动摘要旧回答。
      </p>
    </section>
  );
}
