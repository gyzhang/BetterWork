import type {
  AgentRuntimeEvent,
  ArtifactSummary,
  EvidenceSummary,
  MaterialCandidate,
  McpConnectionSummary,
  McpToolBinding,
  MemoryDecisionSummary,
  MemoryRecallExclusion,
  MemoryRunContextData,
  MemorySelectedMemory,
  MemoryViewItem,
  RunSummary,
  TaskMaterialSelection,
  WorkspaceBriefMemoryItem,
  WorkspaceBriefOpenIssue,
  WorkspaceReferenceListItem,
} from '@betterwork/agent-protocol';
import { Fragment, useCallback, useState } from 'react';

import type { ActivityGroup } from '../activity';
import type { MemorySuggestionsState } from '../hooks/use-memory-suggestions';
import type { RunMemoriesState, TaskMemoryExclusionState } from '../hooks/use-run-memories';
import { useRunSourcePreview } from '../hooks/use-run-source-preview';
import type { TaskMemoryExclusionsState } from '../hooks/use-task-memory-exclusions';
import type { WorkspaceBriefState } from '../hooks/use-workspace-brief';
import { ArtifactIcon, ChevronRightIcon } from '../icons';
import { reportAction } from '../lib/async-action';
import { formatTime } from '../lib/format';
import { fileTypeLabel, materialPurposeName, runStatusName } from '../lib/labels';
import { materialCandidateKey, taskMaterialKey } from '../lib/materials';
import {
  effectiveStatusLabel,
  memoryRunPhaseLabel,
  memoryScopeLabel,
  recallExclusionLabel,
  replayBoundaryLabel,
  selectionReasonLabel,
} from '../lib/memory-labels';
import { handleTitlebarDoubleClick } from '../lib/titlebar';
import type { ContextTab } from '../lib/view-types';
import { AsyncButton, InlineLoading } from './AsyncButton';
import { Button } from './Button';
import { Disclosure } from './Disclosure';
import { EmptyContext, EmptyNotice } from './EmptyState';
import { IconButton } from './IconButton';
import { InlineError } from './InlineError';
import { ListRow } from './ListRow';
import { McpToolBindingsPicker } from './McpToolBindingsPicker';
import { MemorySuggestionList } from './MemorySuggestionList';
import { RunSummaryRow } from './RunSummaryRow';
import { SectionHeader } from './SectionHeader';
import { SourceRow } from './SourceRow';
import { StatusNote } from './StatusNote';
import { Tabs } from './Tabs';
import { ToolActivity } from './ToolActivity';
import { type ToastTone, TransientToast } from './TransientToast';
import { WorkspaceBrief } from './WorkspaceBrief';

const CONTEXT_TABS: ReadonlyArray<readonly [ContextTab, string]> = [
  ['process', '过程'],
  ['sources', '资料'],
  ['memory', '记忆'],
  ['brief', '简报'],
  ['artifacts', '成果'],
];

const artifactTypeLabel = (artifact: ArtifactSummary): string =>
  artifact.type === 'presentation' && artifact.mimeType
    ? fileTypeLabel(artifact.mimeType)
    : 'Markdown';

export interface ContextPanelProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  tab: ContextTab;
  setTab: (tab: ContextTab) => void;
  events: AgentRuntimeEvent[];
  evidence: EvidenceSummary[];
  artifacts: ArtifactSummary[];
  activeRun?: RunSummary | undefined;
  taskRuns: RunSummary[];
  activityGroups: ActivityGroup[];
  onSelectRun: (run: RunSummary) => void;
  onOpenSource: (sourcePath: string) => Promise<void>;
  materials: TaskMaterialSelection[];
  /** 当前范围内的记忆清单（契约 §9.1 治理视图），用于把选中的修订回显成正文。 */
  memories: MemoryViewItem[];
  excludedMemoryIds: string[];
  /** 排除只更新本任务的 TaskContext，保存时必须带上完整上下文（产品设计 §3.5）。 */
  onToggleMemory: (memoryId: string) => void;
  /** 排除的保存状态：逐行「正在调整」与内联失败原因（§11.5.1）。 */
  exclusion: TaskMemoryExclusionState;
  /** 「本任务已排除」独立清单：不依赖词面命中或预览成功（契约 §11.2）。 */
  exclusions: TaskMemoryExclusionsState;
  materialCandidates: MaterialCandidate[];
  onRequestMaterials: (kind: 'file' | 'knowledge' | 'artifact') => void;
  mcpConnections: McpConnectionSummary[];
  mcpToolBindings: McpToolBinding[];
  onMcpToolBindingsChange: (bindings: McpToolBinding[]) => void;
  onSelectArtifact?: (artifact: ArtifactSummary) => void;
  /** §3.5 三段可见性：范围预览 / 本次运行记忆 / 历史上下文调整。 */
  runMemories: RunMemoriesState;
  /** §3.6 工作空间简报：只读、可收起、不新增一级导航。 */
  brief: WorkspaceBriefState;
  workspaceName: string | undefined;
  expertName: string | undefined;
  onOpenBriefMemory: (item: WorkspaceBriefMemoryItem) => void;
  onOpenBriefIssue: (issue: WorkspaceBriefOpenIssue) => void;
  onOpenBriefReference: (item: WorkspaceReferenceListItem) => void;
  /** §3.3 经验建议：只显示与本任务相关的候选批次。 */
  suggestions: MemorySuggestionsState;
  taskCandidates: MemoryViewItem[];
  onEditCandidate: (candidate: MemoryViewItem) => void;
  onRejectCandidate: (candidate: MemoryViewItem) => void;
  onDeleteCandidate: (candidate: MemoryViewItem) => void;
  onOpenMemoryPage: () => void;
  /** 当前任务记忆清单的读取失败与截断提示；两者落点不同，不合并成一个字符串。 */
  memoriesError: string;
  memoriesWarning: string;
}

export function ContextPanel({
  open,
  setOpen,
  tab,
  setTab,
  events,
  evidence,
  artifacts,
  activeRun,
  taskRuns,
  activityGroups,
  onSelectRun,
  onOpenSource,
  materials,
  memories,
  excludedMemoryIds,
  onToggleMemory,
  exclusion,
  exclusions,
  materialCandidates,
  onRequestMaterials,
  mcpConnections,
  mcpToolBindings,
  onMcpToolBindingsChange,
  onSelectArtifact,
  runMemories,
  brief,
  workspaceName,
  expertName,
  onOpenBriefMemory,
  onOpenBriefIssue,
  onOpenBriefReference,
  suggestions,
  taskCandidates,
  onEditCandidate,
  onRejectCandidate,
  onDeleteCandidate,
  onOpenMemoryPage,
  memoriesError,
  memoriesWarning,
}: ContextPanelProps): React.JSX.Element | null {
  const [sourceToast, setSourceToast] = useState<{ tone: ToastTone; message: string }>();
  const dismissSourceToast = useCallback(() => setSourceToast(undefined), []);

  if (!open) return null;
  return (
    <>
      <aside className="context-panel">
        <div className="context-topline" onDoubleClick={handleTitlebarDoubleClick}>
          <span>当前任务</span>
          <IconButton
            label="收起上下文面板"
            icon={ChevronRightIcon}
            onClick={() => setOpen(false)}
          />
        </div>
        <Tabs
          fill
          label="任务上下文"
          items={CONTEXT_TABS.map(([id, label]) => ({ id, label }))}
          value={tab}
          onChange={setTab}
        />
        <div className="context-content">
          {tab === 'process' &&
            (events.length === 0 ? (
              <EmptyContext
                title="等待任务开始"
                detail="开始后，这里会按工作阶段呈现过程，而不是堆叠底层日志。"
              />
            ) : (
              <div className="activity-list">
                <div className="activity-summary">
                  <span
                    className={`status-dot ${activeRun?.status === 'running' ? 'running' : ''}`}
                  />
                  <div>
                    <strong>{activeRun ? runStatusName[activeRun.status] : '正在处理任务'}</strong>
                    <p>{activityGroups.length} 个工作阶段</p>
                  </div>
                </div>
                {activityGroups.map((group) => (
                  <ActivityGroupRow group={group} key={group.id} />
                ))}
                <ToolActivity key={activeRun?.id ?? events[0]?.runId} events={events} />
                {taskRuns.length > 1 && (
                  <Disclosure
                    className="task-run-history"
                    label={`执行记录 · ${taskRuns.length} 次`}
                  >
                    {taskRuns.map((run) => (
                      <RunSummaryRow
                        key={run.id}
                        run={run}
                        title={run.prompt}
                        action="查看执行记录"
                        selected={run.id === activeRun?.id}
                        onSelect={() => onSelectRun(run)}
                      />
                    ))}
                  </Disclosure>
                )}
              </div>
            ))}
          {tab === 'memory' && (
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
                onSelectMaterials={() => {
                  setTab('sources');
                  onRequestMaterials('file');
                }}
                onOpenArtifacts={() => {
                  setTab('sources');
                  onRequestMaterials('artifact');
                }}
                onOpenMemoryPage={onOpenMemoryPage}
              />
            </>
          )}
          {tab === 'brief' && (
            <WorkspaceBrief
              brief={brief.brief}
              loading={brief.loading}
              error={brief.error}
              workspaceName={workspaceName}
              expertName={expertName}
              onRetry={brief.refresh}
              onOpenMemory={onOpenBriefMemory}
              onOpenIssue={onOpenBriefIssue}
              onOpenReference={onOpenBriefReference}
            />
          )}
          {tab === 'sources' && (
            <>
              <section className="context-section">
                <SectionHeader
                  title="本次材料"
                  hint={materials.length > 0 ? `${materials.length} 项已选择` : '尚未选择'}
                  actions={
                    <>
                      <Button
                        variant="chip"
                        size="sm"
                        type="button"
                        onClick={() => onRequestMaterials('file')}
                      >
                        文件
                      </Button>
                      <Button
                        variant="chip"
                        size="sm"
                        type="button"
                        onClick={() => onRequestMaterials('knowledge')}
                      >
                        知识
                      </Button>
                      <Button
                        variant="chip"
                        size="sm"
                        type="button"
                        onClick={() => onRequestMaterials('artifact')}
                      >
                        成果
                      </Button>
                    </>
                  }
                />
                {materials.length > 0 && (
                  <div className="selected-materials-list">
                    {materials.map((selection) => {
                      const candidate = materialCandidates.find(
                        (item) => materialCandidateKey(item) === taskMaterialKey(selection),
                      );
                      return (
                        <ListRow
                          key={taskMaterialKey(selection)}
                          multiline
                          variant="plain"
                          title={candidate?.title ?? '已选材料'}
                          meta={
                            <>
                              {candidate?.sourceLabel ?? selection.reference.kind} ·{' '}
                              {materialPurposeName[selection.purpose]}
                              {candidate?.status === 'unavailable' ? ' · 不可读取' : ''}
                            </>
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </section>
              <section className="context-section">
                <SectionHeader
                  title="本次 MCP 工具"
                  hint={
                    mcpToolBindings.length > 0
                      ? `${mcpToolBindings.length} 项已选择`
                      : '未选择，专家预设也不会自动加入'
                  }
                />
                <McpToolBindingsPicker
                  connections={mcpConnections}
                  bindings={mcpToolBindings}
                  onChange={onMcpToolBindingsChange}
                />
              </section>
              <EvidenceSection
                key={activeRun?.id ?? 'task'}
                evidence={evidence}
                activeRunId={activeRun?.id}
                onOpenSource={onOpenSource}
              />
            </>
          )}
          {tab === 'artifacts' &&
            (artifacts.length === 0 ? (
              <EmptyContext
                title="尚无工作成果"
                detail="将完成的回复保存为 Markdown 后，它会出现在这里。"
              />
            ) : (
              <section className="context-section">
                <div className="evidence-list">
                  {artifacts.map((artifact) => (
                    <ListRow
                      key={artifact.id}
                      onClick={() => onSelectArtifact?.(artifact)}
                      label={`查看成果「${artifact.title}」`}
                      leading={
                        <span aria-hidden="true">
                          <ArtifactIcon size={12} />
                        </span>
                      }
                      title={artifact.title}
                      meta={
                        <>
                          {artifactTypeLabel(artifact)} · v{artifact.versionNumber}
                        </>
                      }
                      trailing={<ChevronRightIcon size={12} />}
                    />
                  ))}
                </div>
              </section>
            ))}
        </div>
      </aside>
      {sourceToast && <TransientToast {...sourceToast} onDismiss={dismissSourceToast} />}
    </>
  );
}

/**
 * 已查阅来源（KM04）：默认只呈现当前 Run，历史运行折叠显式展开；
 * 精确知识来源可回看当时实际返回的区间，legacy 与旧数据只标注范围未记录，
 * 不伪造 span、不提供续读入口。「原文」走主进程白名单，与区间回看是两件事。
 */
function EvidenceSection({
  evidence,
  activeRunId,
  onOpenSource,
}: {
  evidence: EvidenceSummary[];
  activeRunId: string | undefined;
  onOpenSource: (sourcePath: string) => Promise<void>;
}): React.JSX.Element {
  const [sourceToast, setSourceToast] = useState<{ tone: ToastTone; message: string }>();
  const dismissSourceToast = useCallback(() => setSourceToast(undefined), []);
  const runSource = useRunSourcePreview();
  const current = activeRunId ? evidence.filter((item) => item.runId === activeRunId) : [];
  const historical = activeRunId
    ? evidence.filter((item) => item.runId !== activeRunId)
    : [...evidence];

  const openSourceWithToast = (item: EvidenceSummary): void => {
    reportAction(
      onOpenSource(item.sourceUri).then(() =>
        setSourceToast({ tone: 'success', message: `已打开「${item.title}」的原始资料。` }),
      ),
      (errorMessage) =>
        setSourceToast({ tone: 'error', message: errorMessage || '无法打开原始资料。' }),
    );
  };

  const renderRow = (item: EvidenceSummary): React.JSX.Element => {
    const knowledge = item.knowledgeSource;
    const isPreviewing = runSource.selectedEvidenceId === item.id;
    return (
      <Fragment key={item.id}>
        <SourceRow
          item={item}
          showExcerpt
          {...(knowledge
            ? {
                metaExtra: ` · 修订 ${knowledge.reference.knowledgeRevisionId.slice(0, 8)} · 第 ${
                  knowledge.span.sectionOrdinal + 1
                } 段 ${knowledge.span.start}–${knowledge.span.end} 字`,
              }
            : {})}
          {...(knowledge
            ? {
                actions: (
                  <AsyncButton
                    busy={isPreviewing && runSource.loading}
                    label="查看区间"
                    busyLabel="正在回看…"
                    onClick={() => runSource.previewRunSource(item.runId, item.id)}
                  />
                ),
              }
            : {})}
          onOpenSource={() => openSourceWithToast(item)}
        />
        {isPreviewing && <EvidencePreview state={runSource} onClose={runSource.close} />}
      </Fragment>
    );
  };

  return (
    <>
      {evidence.length === 0 ? (
        <EmptyContext
          title="尚无已查阅来源"
          detail="本次运行实际读取的本地资料、网页与 MCP 来源会显示在这里。"
        />
      ) : (
        <>
          <section className="context-section">
            <SectionHeader title={activeRunId ? '本次运行' : '任务来源'} />
            {current.length === 0 ? (
              <EmptyNotice
                title={activeRunId ? '本次运行还没有登记已查阅来源。' : '尚未开始运行。'}
              />
            ) : (
              <div className="evidence-list">{current.map((item) => renderRow(item))}</div>
            )}
          </section>
          {historical.length > 0 && (
            <section className="context-section">
              <Disclosure label={`历史运行来源 · ${historical.length} 条`}>
                <div className="evidence-list">{historical.map((item) => renderRow(item))}</div>
              </Disclosure>
            </section>
          )}
        </>
      )}
      {sourceToast && <TransientToast {...sourceToast} onDismiss={dismissSourceToast} />}
    </>
  );
}

function EvidencePreview({
  state,
  onClose,
}: {
  state: ReturnType<typeof useRunSourcePreview>;
  onClose: () => void;
}): React.JSX.Element {
  const { loading, error, preview } = state;
  return (
    <div className="evidence-preview" role="note">
      {loading ? (
        <InlineLoading label="正在回看当时返回的区间…" />
      ) : error ? (
        <InlineError
          message={error}
          actions={
            <Button variant="text" size="sm" type="button" onClick={onClose}>
              关闭
            </Button>
          }
        />
      ) : preview === undefined ? null : preview.kind === 'exact' ? (
        <>
          <StatusNote
            message={
              <>
                「{preview.page.title}」固定修订{' '}
                {preview.page.reference.knowledgeRevisionId.slice(0, 8)} · 共返回{' '}
                {preview.page.returnedCodePoints} 字，止于该区间；不提供续读。
              </>
            }
          />
          {preview.page.warnings.length > 0 && (
            <StatusNote tone="warning" message={`解析提示：${preview.page.warnings.join('、')}`} />
          )}
          <ul>
            {preview.page.parts.map((part) => (
              <li key={`${part.span.sectionOrdinal}-${part.span.start}-${part.span.end}`}>
                <small>
                  {part.locator} · 第 {part.span.sectionOrdinal + 1} 段 {part.span.start}–
                  {part.span.end} 字
                </small>
                <p>{part.text}</p>
              </li>
            ))}
          </ul>
          <Button variant="text" size="sm" type="button" onClick={onClose}>
            关闭
          </Button>
        </>
      ) : (
        <StatusNote message="这条来源没有记录精确区间（历史数据），只能查看摘录与本机原文。" />
      )}
    </div>
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
            className="chip-button"
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

function ActivityGroupRow({ group }: { group: ActivityGroup }): React.JSX.Element {
  return (
    <div className={`activity-row ${group.status}`}>
      <span className="activity-marker" />
      <div>
        <strong>{group.title}</strong>
        <p>{group.description}</p>
        <small>{group.status === 'running' ? '进行中' : formatTime(group.updatedAt)}</small>
      </div>
    </div>
  );
}
