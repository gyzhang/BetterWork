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
import { useCallback, useState } from 'react';

import type { ActivityGroup } from '../activity';
import type { MemorySuggestionsState } from '../hooks/use-memory-suggestions';
import type { RunMemoriesState, TaskMemoryExclusionState } from '../hooks/use-run-memories';
import type { WorkspaceBriefState } from '../hooks/use-workspace-brief';
import {
  ArtifactIcon,
  CapabilityIcon,
  ChevronRightIcon,
  GlobeIcon,
  KnowledgeIcon,
  WarningIcon,
} from '../icons';
import { reportAction } from '../lib/async-action';
import { formatTime } from '../lib/format';
import { runStatusName } from '../lib/labels';
import { canToggleMcpTool, hasMcpToolBinding, setMcpToolBinding } from '../lib/mcp-selection';
import {
  memoryRunPhaseLabel,
  memoryScopeLabel,
  recallExclusionLabel,
  replayBoundaryLabel,
  selectionReasonLabel,
} from '../lib/memory-labels';
import { handleTitlebarDoubleClick } from '../lib/titlebar';
import type { ContextTab } from '../lib/view-types';
import { EmptyContext } from './EmptyState';
import { MemorySuggestionList } from './MemorySuggestionList';
import { ToolActivity } from './ToolActivity';
import { type ToastTone, TransientToast } from './TransientToast';
import { WorkspaceBrief } from './WorkspaceBrief';

const MIME_LABEL_MAP: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/pdf': 'PDF',
  'text/plain': 'TXT',
};

const artifactTypeLabel = (artifact: ArtifactSummary): string => {
  if (artifact.type === 'presentation' && artifact.mimeType) {
    return (
      MIME_LABEL_MAP[artifact.mimeType] ??
      artifact.mimeType.split('/').pop()?.toUpperCase() ??
      'FILE'
    );
  }
  return 'Markdown';
};

const materialKey = (selection: TaskMaterialSelection): string => {
  const reference = selection.reference;
  if (reference.kind === 'knowledge-revision') return `knowledge:${reference.knowledgeRevisionId}`;
  if (reference.kind === 'artifact-version') return `artifact:${reference.artifactVersionId}`;
  return `snapshot:${reference.snapshotId}`;
};

const candidateKey = (candidate: MaterialCandidate): string => {
  const reference = candidate.reference;
  if (reference.kind === 'knowledge-revision') return `knowledge:${reference.knowledgeRevisionId}`;
  if (reference.kind === 'artifact-version') return `artifact:${reference.artifactVersionId}`;
  return `snapshot:${reference.snapshotId}`;
};

const purposeLabel: Record<TaskMaterialSelection['purpose'], string> = {
  rule: '规则口径',
  'current-input': '本期输入',
  'historical-comparison': '历史对比',
  'structure-reference': '结构参考',
  template: '模板',
  background: '背景参考',
  other: '其他',
};

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
          <button aria-label="收起上下文面板" onClick={() => setOpen(false)}>
            <ChevronRightIcon size={14} />
          </button>
        </div>
        <div className="context-tabs" role="tablist" aria-label="任务上下文">
          {(
            [
              ['process', '过程'],
              ['sources', '资料'],
              ['memory', '记忆'],
              ['brief', '简报'],
              ['artifacts', '成果'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'active' : ''}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
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
                  <details className="task-run-history">
                    <summary>执行记录 · {taskRuns.length} 次</summary>
                    {taskRuns.map((run) => (
                      <button
                        key={run.id}
                        className={run.id === activeRun?.id ? 'active' : ''}
                        onClick={() => onSelectRun(run)}
                      >
                        <span>{runStatusName[run.status]}</span>
                        <strong>{run.prompt}</strong>
                        <small>{formatTime(run.createdAt)}</small>
                      </button>
                    ))}
                  </details>
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
              {memoriesError && <p className="inline-message error">{memoriesError}</p>}
              {memoriesWarning && <p className="context-note">{memoriesWarning}</p>}
              <NextRunScopeSection
                runMemories={runMemories}
                memories={memories}
                excludedMemoryIds={excludedMemoryIds}
                onToggleMemory={onToggleMemory}
                exclusion={exclusion}
                workspaceName={workspaceName}
                expertName={expertName}
              />
              <ThisRunMemorySection runMemories={runMemories} memories={memories} />
              <HistoryAdjustmentSection runMemories={runMemories} />
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
              <section className="selected-materials-panel">
                <div className="selected-materials-heading">
                  <div>
                    <strong>本次材料</strong>
                    <small>
                      {materials.length > 0 ? `${materials.length} 项已选择` : '尚未选择'}
                    </small>
                  </div>
                  <div className="selected-materials-actions">
                    <button type="button" onClick={() => onRequestMaterials('file')}>
                      文件
                    </button>
                    <button type="button" onClick={() => onRequestMaterials('knowledge')}>
                      知识
                    </button>
                    <button type="button" onClick={() => onRequestMaterials('artifact')}>
                      成果
                    </button>
                  </div>
                </div>
                {materials.length > 0 && (
                  <div className="selected-materials-list">
                    {materials.map((selection) => {
                      const candidate = materialCandidates.find(
                        (item) => candidateKey(item) === materialKey(selection),
                      );
                      return (
                        <div className="selected-material-row" key={materialKey(selection)}>
                          <strong>{candidate?.title ?? '已选材料'}</strong>
                          <small>
                            {candidate?.sourceLabel ?? selection.reference.kind} ·{' '}
                            {purposeLabel[selection.purpose]}
                            {candidate?.status === 'unavailable' ? ' · 不可读取' : ''}
                          </small>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
              <section className="selected-mcp-panel">
                <div className="selected-materials-heading">
                  <div>
                    <strong>本次 MCP 工具</strong>
                    <small>
                      {mcpToolBindings.length > 0
                        ? `${mcpToolBindings.length} 项已选择`
                        : '未选择，专家预设也不会自动加入'}
                    </small>
                  </div>
                </div>
                {mcpConnections.length === 0 ? (
                  <p className="muted-text">请先在设置 → MCP 中配置连接。</p>
                ) : (
                  <div className="selected-mcp-list">
                    {mcpConnections.map((connection) => (
                      <div className="selected-mcp-connection" key={connection.id}>
                        <strong>{connection.name}</strong>
                        {connection.tools.length === 0 ? (
                          <small className="muted-text">尚未检测到工具</small>
                        ) : (
                          <div className="expert-option-list">
                            {connection.tools.map((tool) => {
                              const checked = hasMcpToolBinding(
                                mcpToolBindings,
                                connection.id,
                                tool.id,
                              );
                              const enabled = canToggleMcpTool(connection.status, checked);
                              return (
                                <label className="expert-option" key={tool.id}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={!enabled}
                                    onChange={(event) =>
                                      onMcpToolBindingsChange(
                                        setMcpToolBinding(
                                          mcpToolBindings,
                                          connection.id,
                                          tool.id,
                                          event.target.checked,
                                        ),
                                      )
                                    }
                                  />
                                  <span title={tool.description}>{tool.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
              {evidence.length === 0 ? (
                <EmptyContext
                  title="尚无已查阅来源"
                  detail="本次运行实际读取的本地资料、网页与 MCP 来源会显示在这里。"
                />
              ) : (
                <div className="evidence-list">
                  {evidence.map((item) => {
                    const isWeb = item.sourceType === 'web-page';
                    const isMcp = item.sourceType === 'mcp-tool';
                    const Icon = isWeb ? GlobeIcon : isMcp ? CapabilityIcon : KnowledgeIcon;
                    const sourceLabel = isWeb ? '网页来源' : isMcp ? 'MCP 工具' : '本地资料';
                    return (
                      <article className="evidence-row" key={item.id}>
                        <span aria-hidden="true">
                          <Icon size={12} />
                        </span>
                        <div>
                          <strong>{item.title}</strong>
                          <small>
                            {item.locator} · {sourceLabel}
                          </small>
                          <p>{item.excerpt}</p>
                        </div>
                        {!isWeb && !isMcp && (
                          <button
                            className="evidence-open-button"
                            onClick={() =>
                              reportAction(
                                onOpenSource(item.sourceUri).then(() =>
                                  setSourceToast({
                                    tone: 'success',
                                    message: `已打开「${item.title}」的原始资料。`,
                                  }),
                                ),
                                (errorMessage) =>
                                  setSourceToast({
                                    tone: 'error',
                                    message: errorMessage || '无法打开原始资料。',
                                  }),
                              )
                            }
                          >
                            原文
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )}
          {tab === 'artifacts' &&
            (artifacts.length === 0 ? (
              <EmptyContext
                title="尚无工作成果"
                detail="将完成的回复保存为 Markdown 后，它会出现在这里。"
              />
            ) : (
              <div className="evidence-list">
                {artifacts.map((artifact) => (
                  <button
                    key={artifact.id}
                    type="button"
                    className="evidence-row artifact-row-clickable"
                    onClick={() => onSelectArtifact?.(artifact)}
                    aria-label={`查看成果「${artifact.title}」`}
                  >
                    <span aria-hidden="true">
                      <ArtifactIcon size={12} />
                    </span>
                    <div>
                      <strong>{artifact.title}</strong>
                      <small>
                        {artifactTypeLabel(artifact)} · v{artifact.versionNumber}
                      </small>
                    </div>
                    <ChevronRightIcon size={12} className="artifact-row-chevron" />
                  </button>
                ))}
              </div>
            ))}
        </div>
      </aside>
      {sourceToast && <TransientToast {...sourceToast} onDismiss={dismissSourceToast} />}
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
      <div className="selected-materials-heading">
        <div>
          <strong>下次运行可用</strong>
          <small>范围预览：按当前任务输入试算，不是本次实际使用记录</small>
        </div>
        <button type="button" onClick={requestPreview} disabled={!previewAvailable}>
          重新试算
        </button>
      </div>
      {!previewAvailable ? (
        <p className="context-hint">
          还没有可试算的输入：任务上下文或输入变化后，这里才会给出候选范围。
        </p>
      ) : previewLoading ? (
        <p className="context-hint">正在按当前输入试算可用范围…</p>
      ) : previewError ? (
        <p className="inline-message error">
          {previewError}
          <button type="button" onClick={requestPreview}>
            重试
          </button>
        </p>
      ) : preview === undefined ? (
        <p className="context-hint">暂无预览结果。</p>
      ) : (
        <>
          {preview.selectedItems.length === 0 ? (
            <p className="context-hint">按当前输入，没有匹配到可用记忆。</p>
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
          {exclusion.error && <p className="inline-message error">{exclusion.error}</p>}
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
    <div className={`context-row${excluded ? ' excluded' : ''}`}>
      <div>
        <strong>{memory?.content ?? '该记忆的正文不在当前清单内'}</strong>
        <small>
          第 {item.order} 位 · {selectionReasonLabel[item.reason]} ·{' '}
          {memory ? memoryScopeLabel(memory.scope, workspaceName, expertName) : item.memoryId} ·{' '}
          {memory ? `v${memory.revision}` : ''}
        </small>
      </div>
      <button type="button" disabled={saving} onClick={() => onToggleMemory(item.memoryId)}>
        {saving ? '正在调整…' : excluded ? '恢复使用' : '本任务不用'}
      </button>
    </div>
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
    <details className="context-details">
      <summary>
        <WarningIcon size={12} /> 为什么这些没有进入范围
      </summary>
      {summary.conflictReviewRequired && (
        <p className="context-hint">
          存在待澄清口径：同一议题下两条已确认规则尚未裁决，本次一组都不带入。请到记忆页澄清。
        </p>
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
    </details>
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
      <div className="selected-materials-heading">
        <div>
          <strong>本次运行记忆</strong>
          <small>登记的是宿主的准备阶段，不表示模型已读到</small>
        </div>
        <button type="button" onClick={refreshRunContext}>
          刷新
        </button>
      </div>
      {contextError ? (
        <p className="inline-message error">
          {contextError}
          <button type="button" onClick={refreshRunContext}>
            重试
          </button>
        </p>
      ) : contextLoading && runContext === undefined ? (
        <p className="context-hint">正在读取本次运行的记忆登记…</p>
      ) : runContext === undefined ? (
        <p className="context-hint">还没有运行记录：任务开始后才能看到本次登记的精确修订。</p>
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
      <p className="context-phase">
        请求阶段：{memoryRunPhaseLabel[context.phase]}
        {context.phase === 'legacy_unknown' ? '' : ' · 阶段只描述宿主做到哪一步'}
      </p>
      {context.phase === 'legacy_unknown' && (
        <p className="context-hint">
          这是记忆治理改造前的旧运行，没有请求审计行，无法确认当时带到哪一步；这里只列已登记的引用，
          不回填发送时间与请求哈希。
        </p>
      )}
      {context.context === undefined && context.phase !== 'legacy_unknown' ? (
        <p className="context-hint">审计行尚未写入，只有引用记录可读。</p>
      ) : (
        selected.length === 0 && <p className="context-hint">本次运行没有登记带入的记忆。</p>
      )}
      <div className="context-list">
        {selected.map((item) => {
          const memory = byId.get(item.memoryId);
          const read = context.reads.find((entry) => entry.memoryRevisionId === item.revisionId);
          return (
            <div className="context-row" key={item.revisionId}>
              <div>
                <strong>{memory?.content ?? `记忆 ${item.memoryId}`}</strong>
                <small>
                  第 {item.order} 位 · {selectionReasonLabel[item.reason]} · 修订{' '}
                  {item.revisionId.slice(0, 8)} · 哈希 {item.contentHash.slice(0, 8)}
                  {read?.provenanceState === 'legacy_unknown' ? ' · 旧版来源' : ''}
                  {read && read.replayedViaRunIds.length > 0
                    ? ` · 经 ${read.replayedViaRunIds.length} 次历史轮次带入`
                    : ''}
                </small>
              </div>
            </div>
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
}: {
  runMemories: RunMemoriesState;
}): React.JSX.Element {
  const replay = runMemories.runContext?.context?.replay ?? [];
  const known = runMemories.runContext?.phase !== 'legacy_unknown';
  return (
    <section className="context-section memory-history-section">
      <div className="selected-materials-heading">
        <div>
          <strong>历史上下文调整</strong>
          <small>哪些旧轮次没带、为什么没带</small>
        </div>
      </div>
      {!known ? (
        <p className="context-hint">旧版运行没有历史重放审计，无法确认当时的轮次取舍。</p>
      ) : replay.length === 0 ? (
        <p className="context-hint">本次没有复用历史轮次：只按当前任务上下文工作。</p>
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
        记忆被修订、排除、失效或材料换版本时，相关旧回答不会继续当作事实使用。
      </p>
    </section>
  );
}

export function ActivityGroupRow({ group }: { group: ActivityGroup }): React.JSX.Element {
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
