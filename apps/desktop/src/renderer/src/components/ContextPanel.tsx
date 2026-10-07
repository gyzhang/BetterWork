import type {
  AgentRuntimeEvent,
  ArtifactSummary,
  EvidenceSummary,
  MaterialCandidate,
  MaterialPurpose,
  McpConnectionSummary,
  McpToolBinding,
  MemoryDecisionSummary,
  MemoryRecallExclusion,
  MemoryRunContextData,
  MemorySelectedMemory,
  MemoryViewItem,
  RunSummary,
  ScheduleOccurrenceDetail,
  TaskContinuityBrief,
  TaskMaterialSelection,
  WorkspaceBriefMemoryItem,
  WorkspaceBriefOpenIssue,
  WorkspaceReferenceListItem,
} from '@betterwork/agent-protocol';
import {
  TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX,
  TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX_CODE_POINTS,
  TASK_CONTINUITY_OBJECTIVE_MAX_CODE_POINTS,
  TASK_CONTINUITY_PROGRESS_MAX_CODE_POINTS,
} from '@betterwork/agent-protocol';
import { Fragment, useCallback, useEffect, useId, useState } from 'react';

import type { ActivityGroup } from '../activity';
import type { MemorySuggestionsState } from '../hooks/use-memory-suggestions';
import type { RunMemoriesState, TaskMemoryExclusionState } from '../hooks/use-run-memories';
import { useRunSourcePreview } from '../hooks/use-run-source-preview';
import type { TaskContinuityState } from '../hooks/use-task-continuity';
import type { TaskMemoryExclusionsState } from '../hooks/use-task-memory-exclusions';
import type { WorkspaceBriefState } from '../hooks/use-workspace-brief';
import { ArtifactIcon, ChevronRightIcon, CloseIcon } from '../icons';
import { reportAction, trackAction } from '../lib/async-action';
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
import { scheduleSourceSnapshotStatusLabel } from '../lib/schedule-detail';
import { handleTitlebarDoubleClick } from '../lib/titlebar';
import type { ContextTab } from '../lib/view-types';
import { ActionBar } from './ActionBar';
import { AsyncButton, InlineLoading } from './AsyncButton';
import { Button } from './Button';
import { Disclosure } from './Disclosure';
import { EmptyContext, EmptyNotice } from './EmptyState';
import { Field } from './Field';
import { FieldSelect } from './FieldSelect';
import { IconButton } from './IconButton';
import { InlineError } from './InlineError';
import { ListRow } from './ListRow';
import { McpToolBindingsPicker } from './McpToolBindingsPicker';
import { MemorySuggestionList } from './MemorySuggestionList';
import { RunSummaryRow } from './RunSummaryRow';
import { SectionHeader } from './SectionHeader';
import { SourceRow } from './SourceRow';
import { StatusNote } from './StatusNote';
import { Tab, TabList, TabPanel, Tabs } from './Tabs';
import { TextArea } from './TextField';
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

const MATERIAL_PURPOSE_OPTIONS = Object.entries(materialPurposeName).map(([id, label]) => ({
  id,
  label,
}));

export interface ContextPanelProps {
  taskId?: string | undefined;
  taskContinuity: TaskContinuityState;
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
  onCommitMaterials: (materials: TaskMaterialSelection[]) => void;
  materialsDisabled: boolean;
  /** 从定时任务详情打开原 Task 时，展示不可变本期快照事实；仅此 Task 后续 Run 使用。 */
  scheduleContinuation?: {
    occurrence: ScheduleOccurrenceDetail;
    sourceSnapshotId?: string;
    scopeAttached: boolean;
    removingScope: boolean;
    scopeError: string;
    onRemoveScope: () => void;
  };
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
  onOpenArtifactVersion: (versionId: string) => Promise<void>;
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
  taskId,
  taskContinuity,
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
  onCommitMaterials,
  materialsDisabled,
  scheduleContinuation,
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
  onOpenArtifactVersion,
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
            size="md"
            label="收起上下文面板"
            icon={ChevronRightIcon}
            onClick={() => setOpen(false)}
          />
        </div>
        <Tabs value={tab} onChange={setTab}>
          <TabList size="sm" fill label="任务上下文">
            {CONTEXT_TABS.map(([id, label]) => (
              <Tab key={id} value={id}>
                {label}
              </Tab>
            ))}
          </TabList>
          <TabPanel value="process" className="context-content">
            {tab === 'process' && (
              <>
                {taskId && (
                  <TaskContinuitySection
                    taskId={taskId}
                    state={taskContinuity}
                    taskRuns={taskRuns}
                    artifacts={artifacts}
                    onSelectRun={onSelectRun}
                    onOpenArtifactVersion={onOpenArtifactVersion}
                    onError={(tone, message) => setSourceToast({ tone, message })}
                  />
                )}
                {events.length === 0 ? (
                  <EmptyContext
                    placement="start"
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
                        <strong>
                          {activeRun ? runStatusName[activeRun.status] : '正在处理任务'}
                        </strong>
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
                )}
              </>
            )}
          </TabPanel>
          <TabPanel value="memory" className="context-content">
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
          </TabPanel>
          <TabPanel value="brief" className="context-content">
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
          </TabPanel>
          <TabPanel value="sources" className="context-content">
            {tab === 'sources' && (
              <>
                {scheduleContinuation && (
                  <section className="context-section">
                    <SectionHeader
                      title="定时任务本期范围"
                      hint={
                        scheduleContinuation.scopeAttached
                          ? '后续运行仍包含此快照'
                          : '当前任务未绑定此快照'
                      }
                    />
                    <ListRow
                      multiline
                      variant="plain"
                      title={scheduleContinuation.occurrence.occurrence.period.label}
                      detail={`规则「${scheduleContinuation.occurrence.config.name}」 · 固定配置 v${scheduleContinuation.occurrence.occurrence.configVersion} · ${scheduleContinuation.occurrence.occurrence.period.timeZone}`}
                      meta={
                        scheduleContinuation.occurrence.sourceSnapshot
                          ? `来源快照 ${scheduleContinuation.sourceSnapshotId ?? '不可用'} · ${scheduleSourceSnapshotStatusLabel(scheduleContinuation.occurrence.sourceSnapshot.status)} · ${scheduleContinuation.occurrence.sourceSnapshot.itemCount} 项 · ${scheduleContinuation.occurrence.sourceSnapshot.totalFileBytes} 字节 · 清单 ${scheduleContinuation.occurrence.sourceSnapshot.manifestHash}`
                          : `来源快照 ${scheduleContinuation.sourceSnapshotId ?? '不可用'} · 快照详情暂不可用`
                      }
                    />
                    <StatusNote
                      tone={scheduleContinuation.scopeAttached ? 'warning' : 'neutral'}
                      message={
                        scheduleContinuation.scopeAttached
                          ? '此 Task 的后续 Run 会沿用本期固定来源。移除会缩小后续权限范围并触发现有安全历史分段；不改变已经开始的 Run、本期历史或 Schedule 的后续配置。'
                          : '本 Task 的后续 Run 当前不含这期自动来源；本期快照与历史仍保留，Schedule 的后续配置不变。下方补充材料只作用于当前原 Task。'
                      }
                    />
                    {scheduleContinuation.scopeError && (
                      <InlineError message={scheduleContinuation.scopeError} />
                    )}
                    {scheduleContinuation.scopeAttached && (
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        disabled={scheduleContinuation.removingScope}
                        onClick={scheduleContinuation.onRemoveScope}
                      >
                        {scheduleContinuation.removingScope ? '正在移除本期范围…' : '移除本期范围'}
                      </Button>
                    )}
                    <StatusNote message="下面选择的文件、知识或成果会补充到当前原 Task 的后续 Run，不会写回 Schedule。" />
                  </section>
                )}
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
                          disabled={materialsDisabled}
                          onClick={() => onRequestMaterials('file')}
                        >
                          文件
                        </Button>
                        <Button
                          variant="chip"
                          size="sm"
                          type="button"
                          disabled={materialsDisabled}
                          onClick={() => onRequestMaterials('knowledge')}
                        >
                          知识
                        </Button>
                        <Button
                          variant="chip"
                          size="sm"
                          type="button"
                          disabled={materialsDisabled}
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
                        const materialKey = taskMaterialKey(selection);
                        const candidate = materialCandidates.find(
                          (item) => materialCandidateKey(item) === materialKey,
                        );
                        const title = candidate?.title ?? '已选材料';
                        return (
                          <ListRow
                            key={materialKey}
                            multiline
                            variant="plain"
                            title={title}
                            meta={
                              <>
                                {candidate?.sourceLabel ?? selection.reference.kind}
                                {candidate?.status === 'unavailable' ? ' · 不可读取' : ''}
                              </>
                            }
                            actionsPlacement="below"
                            actions={
                              <ActionBar as="div" label={`管理材料 ${title}`}>
                                <FieldSelect
                                  size="sm"
                                  ariaLabel={`${title}用途`}
                                  value={selection.purpose}
                                  disabled={materialsDisabled}
                                  options={MATERIAL_PURPOSE_OPTIONS}
                                  onChange={(purpose) =>
                                    onCommitMaterials(
                                      materials.map((item) =>
                                        taskMaterialKey(item) === materialKey
                                          ? { ...item, purpose: purpose as MaterialPurpose }
                                          : item,
                                      ),
                                    )
                                  }
                                />
                                <IconButton
                                  size="sm"
                                  label={`移除材料 ${title}`}
                                  icon={CloseIcon}
                                  disabled={materialsDisabled}
                                  onClick={() =>
                                    onCommitMaterials(
                                      materials.filter(
                                        (item) => taskMaterialKey(item) !== materialKey,
                                      ),
                                    )
                                  }
                                />
                              </ActionBar>
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
          </TabPanel>
          <TabPanel value="artifacts" className="context-content">
            {tab === 'artifacts' &&
              (artifacts.length === 0 ? (
                <EmptyContext
                  placement="start"
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
          </TabPanel>
        </Tabs>
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
                    size="sm"
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
          placement="start"
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

interface TaskContinuityRequirementDraft {
  key: string;
  id?: string;
  text: string;
}

interface TaskContinuityProgressDraft {
  status: NonNullable<TaskContinuityBrief['progress']>['status'];
  completedActions: string;
  nextAction: string;
  blockers: string;
  artifactVersionIds: string[];
}

interface TaskContinuityDraft {
  objective: string;
  activeRequirements: TaskContinuityRequirementDraft[];
  progress: TaskContinuityProgressDraft | null;
}

const TASK_CONTINUITY_PROGRESS_LABELS: Record<
  NonNullable<TaskContinuityBrief['progress']>['status'],
  string
> = {
  'in-progress': '进行中',
  blocked: '受阻',
  'awaiting-user': '等待用户',
  complete: '已整理完成',
};

const TASK_CONTINUITY_PROGRESS_OPTIONS = Object.entries(TASK_CONTINUITY_PROGRESS_LABELS).map(
  ([id, label]) => ({ id, label }),
);

const codePointLength = (value: string): number => Array.from(value).length;

const linesOf = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const draftOfBrief = (brief: TaskContinuityBrief): TaskContinuityDraft => ({
  objective: brief.objective.text,
  activeRequirements: brief.activeRequirements.map((requirement) => ({
    key: requirement.id,
    id: requirement.id,
    text: requirement.text,
  })),
  progress: brief.progress
    ? {
        status: brief.progress.status,
        completedActions: brief.progress.completedActions.join('\n'),
        nextAction: brief.progress.nextAction ?? '',
        blockers: brief.progress.blockers.join('\n'),
        artifactVersionIds: [...brief.progress.artifactVersionIds],
      }
    : null,
});

function taskContinuityDraftError(draft: TaskContinuityDraft): string {
  const objectiveLength = codePointLength(draft.objective.trim());
  if (objectiveLength === 0) return '任务目标不能为空。';
  if (objectiveLength > TASK_CONTINUITY_OBJECTIVE_MAX_CODE_POINTS) {
    return `任务目标不能超过 ${TASK_CONTINUITY_OBJECTIVE_MAX_CODE_POINTS} 个字符。`;
  }
  if (draft.activeRequirements.length > TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX) {
    return `活跃要求最多 ${TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX} 项。`;
  }
  const requirements = draft.activeRequirements.map((requirement) => requirement.text.trim());
  if (requirements.some((text) => text.length === 0)) {
    return '请补全活跃要求，或移除空白项。';
  }
  const requirementLength = requirements.reduce((sum, text) => sum + codePointLength(text), 0);
  if (requirementLength > TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX_CODE_POINTS) {
    return `活跃要求合计不能超过 ${TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX_CODE_POINTS} 个字符。`;
  }
  if (draft.progress) {
    const progressText = [
      ...linesOf(draft.progress.completedActions),
      draft.progress.nextAction.trim(),
      ...linesOf(draft.progress.blockers),
    ];
    const progressLength = progressText.reduce((sum, text) => sum + codePointLength(text), 0);
    if (progressLength > TASK_CONTINUITY_PROGRESS_MAX_CODE_POINTS) {
      return `进度内容合计不能超过 ${TASK_CONTINUITY_PROGRESS_MAX_CODE_POINTS} 个字符。`;
    }
  }
  return '';
}

function TaskContinuitySection({
  taskId,
  state,
  taskRuns,
  artifacts,
  onSelectRun,
  onOpenArtifactVersion,
  onError,
}: {
  taskId: string;
  state: TaskContinuityState;
  taskRuns: RunSummary[];
  artifacts: ArtifactSummary[];
  onSelectRun: (run: RunSummary) => void;
  onOpenArtifactVersion: (versionId: string) => Promise<void>;
  onError: (tone: ToastTone, message: string) => void;
}): React.JSX.Element {
  const revision = state.revision;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TaskContinuityDraft>();
  const idPrefix = useId();

  useEffect(() => {
    if (!revision) {
      setDraft(undefined);
      setEditing(false);
      return;
    }
    setDraft(draftOfBrief(revision.brief));
  }, [revision, taskId]);

  const validationError = draft ? taskContinuityDraftError(draft) : '';
  const openSourceRun = (runId: string): void => {
    const run = taskRuns.find((candidate) => candidate.id === runId);
    if (run) onSelectRun(run);
  };
  const renderPromptSource = (runId: string, promptHash: string): React.JSX.Element => {
    const run = taskRuns.find((candidate) => candidate.id === runId);
    return (
      <div key={`${runId}:${promptHash}`}>
        <StatusNote
          message={`来源请求 · prompt 指纹 ${promptHash.slice(0, 12)}${run ? ` · ${formatTime(run.createdAt)}` : ' · 来源记录不可用'}`}
        />
        {run && (
          <Button variant="link" size="sm" type="button" onClick={() => openSourceRun(runId)}>
            查看来源执行记录
          </Button>
        )}
      </div>
    );
  };
  const renderSourceRun = (runId: string): React.JSX.Element => {
    const run = taskRuns.find((candidate) => candidate.id === runId);
    return (
      <div key={runId}>
        {run ? (
          <RunSummaryRow
            run={run}
            title="来源执行记录"
            action="查看来源执行记录"
            onSelect={() => openSourceRun(runId)}
          />
        ) : (
          <StatusNote message="来源执行记录不可用" />
        )}
      </div>
    );
  };

  const updateDraft = (update: (current: TaskContinuityDraft) => TaskContinuityDraft): void => {
    setDraft((current) => (current ? update(current) : current));
  };
  const startEditing = (): void => {
    if (!revision) return;
    setDraft(draftOfBrief(revision.brief));
    state.clearError();
    setEditing(true);
  };
  const cancelEditing = (): void => {
    if (revision) setDraft(draftOfBrief(revision.brief));
    state.clearError();
    setEditing(false);
  };
  const refresh = (): void => {
    trackAction(state.refresh(), '载入最新任务简报');
  };
  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!draft || !revision || validationError || state.saving) return;
    const progress = draft.progress
      ? {
          status: draft.progress.status,
          completedActions: linesOf(draft.progress.completedActions),
          ...(draft.progress.nextAction.trim()
            ? { nextAction: draft.progress.nextAction.trim() }
            : {}),
          blockers: linesOf(draft.progress.blockers),
          artifactVersionIds: draft.progress.artifactVersionIds,
        }
      : null;
    trackAction(
      state
        .save({
          taskId,
          expectedRevision: revision.revision,
          objective: draft.objective.trim(),
          activeRequirements: draft.activeRequirements.map((requirement) => ({
            ...(requirement.id ? { id: requirement.id } : {}),
            text: requirement.text.trim(),
          })),
          progress,
        })
        .then((result) => {
          if (result?.kind === 'saved') setEditing(false);
        }),
      '保存本任务目标与进度',
    );
  };

  const header = (
    <SectionHeader
      title="本任务目标与进度"
      hint={revision ? `连续简报 · 第 ${revision.revision} 版` : '仅记录当前 Task 的工作上下文'}
      actions={
        revision && !state.loading && state.errorKind !== 'load' && !editing ? (
          <Button variant="secondary" size="sm" type="button" onClick={startEditing}>
            编辑简报
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <section className="context-section">
      {header}
      {state.loading && (
        <InlineLoading label={revision ? '正在载入最新版本…' : '正在读取本任务简报…'} />
      )}
      {state.error && (
        <InlineError
          message={state.error}
          {...(state.conflict
            ? {
                actions: (
                  <Button variant="link" size="sm" type="button" onClick={refresh}>
                    载入最新版本
                  </Button>
                ),
              }
            : state.errorKind === 'load'
              ? { onRetry: refresh }
              : { onDismiss: state.clearError })}
        />
      )}
      {revision === null && !state.loading && !state.error && (
        <EmptyNotice
          title="此 Task 尚无连续简报"
          detail="连续简报从新建 Task 开始记录；旧 Task 不会从历史对话回填。"
        />
      )}
      {revision && editing && draft && (
        <form className="context-section" onSubmit={submit}>
          <Field label="任务目标" controlId={`${idPrefix}-objective`}>
            <TextArea
              id={`${idPrefix}-objective`}
              rows={3}
              autoFocus
              disabled={state.saving || state.loading}
              value={draft.objective}
              onChange={(event) => {
                const objective = event.currentTarget.value;
                updateDraft((current) => ({ ...current, objective }));
              }}
            />
          </Field>
          <section className="context-section">
            <SectionHeader
              title="活跃要求"
              hint={`${draft.activeRequirements.length} / ${TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX} 项`}
              actions={
                <Button
                  variant="chip"
                  size="sm"
                  type="button"
                  disabled={
                    state.saving ||
                    draft.activeRequirements.length >= TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX
                  }
                  onClick={() =>
                    updateDraft((current) => ({
                      ...current,
                      activeRequirements: [
                        ...current.activeRequirements,
                        { key: crypto.randomUUID(), text: '' },
                      ],
                    }))
                  }
                >
                  添加要求
                </Button>
              }
            />
            {draft.activeRequirements.map((requirement, index) => {
              const inputId = `${idPrefix}-requirement-${requirement.key}`;
              return (
                <Field key={requirement.key} label={`要求 ${index + 1}`} controlId={inputId}>
                  <TextArea
                    id={inputId}
                    rows={2}
                    disabled={state.saving || state.loading}
                    value={requirement.text}
                    onChange={(event) => {
                      const text = event.currentTarget.value;
                      updateDraft((current) => ({
                        ...current,
                        activeRequirements: current.activeRequirements.map((item) =>
                          item.key === requirement.key ? { ...item, text } : item,
                        ),
                      }));
                    }}
                  />
                  <Button
                    variant="link"
                    size="sm"
                    tone="danger"
                    type="button"
                    disabled={state.saving || state.loading}
                    onClick={() =>
                      updateDraft((current) => ({
                        ...current,
                        activeRequirements: current.activeRequirements.filter(
                          (item) => item.key !== requirement.key,
                        ),
                      }))
                    }
                  >
                    移除要求
                  </Button>
                </Field>
              );
            })}
            {draft.activeRequirements.length === 0 && <StatusNote message="当前没有活跃要求。" />}
          </section>
          <section className="context-section">
            <SectionHeader
              title="进度整理"
              hint={
                draft.progress ? TASK_CONTINUITY_PROGRESS_LABELS[draft.progress.status] : '尚未整理'
              }
              actions={
                draft.progress ? (
                  <Button
                    variant="link"
                    size="sm"
                    tone="danger"
                    type="button"
                    disabled={state.saving || state.loading}
                    onClick={() => updateDraft((current) => ({ ...current, progress: null }))}
                  >
                    清除进度
                  </Button>
                ) : (
                  <Button
                    variant="chip"
                    size="sm"
                    type="button"
                    disabled={state.saving || state.loading}
                    onClick={() =>
                      updateDraft((current) => ({
                        ...current,
                        progress: {
                          status: 'in-progress',
                          completedActions: '',
                          nextAction: '',
                          blockers: '',
                          artifactVersionIds: [],
                        },
                      }))
                    }
                  >
                    添加进度
                  </Button>
                )
              }
            />
            {draft.progress && (
              <>
                <Field label="进度状态" controlId={`${idPrefix}-progress-status`}>
                  <FieldSelect
                    size="sm"
                    ariaLabel="进度状态"
                    value={draft.progress.status}
                    disabled={state.saving || state.loading}
                    options={TASK_CONTINUITY_PROGRESS_OPTIONS}
                    onChange={(value) =>
                      updateDraft((current) =>
                        current.progress
                          ? {
                              ...current,
                              progress: {
                                ...current.progress,
                                status: value as TaskContinuityProgressDraft['status'],
                              },
                            }
                          : current,
                      )
                    }
                  />
                </Field>
                <Field label="已完成动作" controlId={`${idPrefix}-completed-actions`}>
                  <TextArea
                    id={`${idPrefix}-completed-actions`}
                    rows={3}
                    disabled={state.saving || state.loading}
                    value={draft.progress.completedActions}
                    onChange={(event) => {
                      const completedActions = event.currentTarget.value;
                      updateDraft((current) =>
                        current.progress
                          ? {
                              ...current,
                              progress: {
                                ...current.progress,
                                completedActions,
                              },
                            }
                          : current,
                      );
                    }}
                  />
                </Field>
                <Field label="下一步" controlId={`${idPrefix}-next-action`}>
                  <TextArea
                    id={`${idPrefix}-next-action`}
                    rows={2}
                    disabled={state.saving || state.loading}
                    value={draft.progress.nextAction}
                    onChange={(event) => {
                      const nextAction = event.currentTarget.value;
                      updateDraft((current) =>
                        current.progress
                          ? {
                              ...current,
                              progress: {
                                ...current.progress,
                                nextAction,
                              },
                            }
                          : current,
                      );
                    }}
                  />
                </Field>
                <Field label="阻塞事项" controlId={`${idPrefix}-progress-blockers`}>
                  <TextArea
                    id={`${idPrefix}-progress-blockers`}
                    rows={2}
                    disabled={state.saving || state.loading}
                    value={draft.progress.blockers}
                    onChange={(event) => {
                      const blockers = event.currentTarget.value;
                      updateDraft((current) =>
                        current.progress
                          ? {
                              ...current,
                              progress: {
                                ...current.progress,
                                blockers,
                              },
                            }
                          : current,
                      );
                    }}
                  />
                </Field>
                {draft.progress.artifactVersionIds.length > 0 && (
                  <section className="context-section">
                    <SectionHeader title="精确成果版本" />
                    {draft.progress.artifactVersionIds.map((versionId) => {
                      const artifact = artifacts.find(
                        (item) => item.currentVersionId === versionId,
                      );
                      return (
                        <ListRow
                          key={versionId}
                          variant="plain"
                          multiline
                          title={artifact?.title ?? '已登记成果版本'}
                          meta={`精确版本 ${versionId.slice(0, 8)}`}
                          actions={
                            <Button
                              variant="link"
                              size="sm"
                              type="button"
                              disabled={state.saving || state.loading}
                              onClick={() =>
                                updateDraft((current) =>
                                  current.progress
                                    ? {
                                        ...current,
                                        progress: {
                                          ...current.progress,
                                          artifactVersionIds:
                                            current.progress.artifactVersionIds.filter(
                                              (candidate) => candidate !== versionId,
                                            ),
                                        },
                                      }
                                    : current,
                                )
                              }
                            >
                              移除引用
                            </Button>
                          }
                        />
                      );
                    })}
                  </section>
                )}
              </>
            )}
          </section>
          {validationError && <InlineError message={validationError} />}
          <ActionBar label="保存本任务目标与进度">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={state.saving || state.loading}
              onClick={cancelEditing}
            >
              取消
            </Button>
            <AsyncButton
              variant="primary"
              size="sm"
              label="保存简报"
              busyLabel="正在保存…"
              busy={state.saving}
              type="submit"
              disabled={Boolean(validationError) || state.loading || state.errorKind === 'load'}
            />
          </ActionBar>
        </form>
      )}
      {revision && !editing && (
        <>
          <section className="context-section">
            <SectionHeader title="任务目标" />
            <ListRow
              variant="plain"
              multiline
              title={revision.brief.objective.text}
              detail={revision.brief.objective.source === 'task-goal' ? '初始任务目标' : '用户修订'}
              actionsPlacement="below"
              actions={
                revision.brief.objective.sourceRunId ? (
                  <Button
                    variant="link"
                    size="sm"
                    type="button"
                    onClick={() => openSourceRun(revision.brief.objective.sourceRunId ?? '')}
                  >
                    查看目标来源
                  </Button>
                ) : undefined
              }
            />
          </section>
          <section className="context-section">
            <SectionHeader
              title="活跃要求"
              hint={`${revision.brief.activeRequirements.length} 项`}
            />
            {revision.brief.activeRequirements.length === 0 ? (
              <EmptyNotice title="当前没有活跃要求" />
            ) : (
              revision.brief.activeRequirements.map((requirement) => (
                <ListRow
                  key={requirement.id}
                  variant="plain"
                  multiline
                  title={requirement.text}
                  detail={requirement.authoredBy === 'user-edit' ? '用户修订' : '助手整理'}
                  actionsPlacement="below"
                  actions={requirement.sources?.map((source) =>
                    renderPromptSource(source.runId, source.promptHash),
                  )}
                />
              ))
            )}
          </section>
          <section className="context-section">
            <SectionHeader title="进度整理" />
            {!revision.brief.progress ? (
              <EmptyNotice
                title="尚无进度记录"
                detail="完成的执行记录与登记成果会形成保守的进度事实。"
              />
            ) : (
              <>
                <StatusNote
                  tone={
                    revision.brief.progress.status === 'blocked'
                      ? 'warning'
                      : revision.brief.progress.status === 'complete'
                        ? 'success'
                        : 'neutral'
                  }
                  message={`进度状态：${TASK_CONTINUITY_PROGRESS_LABELS[revision.brief.progress.status]} · ${revision.brief.progress.authoredBy === 'user-edit' ? '用户修订' : '助手整理'}`}
                />
                {revision.brief.progress.completedActions.map((action, index) => (
                  <ListRow key={`${index}:${action}`} variant="plain" multiline title={action} />
                ))}
                {revision.brief.progress.nextAction && (
                  <StatusNote message={`下一步：${revision.brief.progress.nextAction}`} />
                )}
                {revision.brief.progress.blockers.map((blocker, index) => (
                  <StatusNote
                    key={`${index}:${blocker}`}
                    tone="warning"
                    message={`阻塞：${blocker}`}
                  />
                ))}
                {revision.brief.progress.sourceRunId &&
                  renderSourceRun(revision.brief.progress.sourceRunId)}
                {revision.brief.progress.artifactVersionIds.map((versionId) => {
                  const artifact = artifacts.find((item) => item.currentVersionId === versionId);
                  return (
                    <ListRow
                      key={versionId}
                      variant="plain"
                      multiline
                      title={artifact?.title ?? '已登记成果版本'}
                      meta={`精确版本 ${versionId.slice(0, 8)}`}
                      actions={
                        <Button
                          variant="link"
                          size="sm"
                          type="button"
                          onClick={() =>
                            reportAction(
                              onOpenArtifactVersion(versionId),
                              (message) => onError('error', message),
                              '无法打开该成果版本。',
                            )
                          }
                        >
                          查看该版本
                        </Button>
                      }
                    />
                  );
                })}
              </>
            )}
          </section>
        </>
      )}
    </section>
  );
}
