import type {
  RunDiagnosticIssueMarkCategory,
  RunDiagnosticNode,
  RunDiagnosticsHistoryEntry,
  RunDiagnosticsHistoryFilter,
  RunDiagnosticsHistoryStats,
  RunDiagnosticSourceReference,
  RunDiagnosticsScopeRequest,
  RunDiagnosticsSources,
  RunDiagnosticsSummary,
} from '@betterwork/agent-protocol';
import { useEffect, useRef, useState } from 'react';

import { useRunDiagnosticIssueMark } from '../../hooks/use-run-diagnostic-issue-mark';
import { useRunDiagnosticNodeDetail } from '../../hooks/use-run-diagnostic-node-detail';
import { useRunDiagnostics } from '../../hooks/use-run-diagnostics';
import { useRunDiagnosticsHistory } from '../../hooks/use-run-diagnostics-history';
import { runStatusName, toolStageLabel } from '../../lib/labels';
import {
  buildRunDiagnosticTree,
  mergeRunDiagnosticNodes,
  type RunDiagnosticTreeNode,
} from '../../lib/run-diagnostics';
import { ActionBar } from '../ActionBar';
import { AsyncButton, InlineLoading } from '../AsyncButton';
import { Badge, type BadgeTone } from '../Badge';
import { Button } from '../Button';
import { Disclosure } from '../Disclosure';
import { EmptyNotice } from '../EmptyState';
import { Field } from '../Field';
import { FieldSelect } from '../FieldSelect';
import { InlineError } from '../InlineError';
import { ListRow } from '../ListRow';
import { Modal } from '../Modal';
import { SectionHeader } from '../SectionHeader';
import { StatusNote } from '../StatusNote';
import { Tab, TabList, TabPanel, Tabs } from '../Tabs';
import { TextField } from '../TextField';
import { TransientToast } from '../TransientToast';

type DetailsTab = 'chain' | 'timeline' | 'usage' | 'sources' | 'history';
type HistoryTaskScope = 'task' | 'workspace';

interface HistoryFilterDraft {
  taskScope: HistoryTaskScope;
  fromDate: string;
  throughDate: string;
  expertRevisionId: string;
  skillRevisionId: string;
  modelFingerprint: string;
}

const historyFilterDraft = (taskId?: string): HistoryFilterDraft => ({
  taskScope: taskId ? 'task' : 'workspace',
  fromDate: '',
  throughDate: '',
  expertRevisionId: '',
  skillRevisionId: '',
  modelFingerprint: '',
});

const localDateBoundary = (date: string, endOfDay: boolean): number | undefined => {
  if (!date) return undefined;
  const timestamp = new Date(`${date}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
};

const aggregateMetricValue = (
  metric: RunDiagnosticsHistoryStats['usage']['promptTokens'],
): string =>
  `已知小计 ${metric.knownSubtotal} token；已知调用 ${metric.knownCallCount} 次，未知调用 ${metric.missingCallCount} 次`;

const durationValue = (duration: number | undefined): string =>
  duration === undefined ? '未记录' : `${duration} ms`;

const nodeStatusName: Record<RunDiagnosticNode['status'], string> = {
  pending: '待开始',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  rejected: '已拒绝',
  cancelled: '已停止',
  interrupted: '已中断',
  unknown: '未知',
};

const nodeStatusTone: Record<RunDiagnosticNode['status'], BadgeTone> = {
  pending: 'neutral',
  running: 'brand',
  completed: 'success',
  failed: 'danger',
  rejected: 'warning',
  cancelled: 'warning',
  interrupted: 'warning',
  unknown: 'neutral',
};

const runStatusTone: Record<RunDiagnosticsSummary['status'], BadgeTone> = {
  running: 'brand',
  completed: 'success',
  failed: 'danger',
  cancelled: 'warning',
};

const hostPhaseName: Record<NonNullable<RunDiagnosticNode['hostPhase']>, string> = {
  prepare: '准备',
  audit: '审计',
  'skill-cleanup': 'Skill 清理',
  'mcp-cleanup': 'MCP 清理',
  'artifact-commit': '成果提交',
  dispatch: '派发',
  execute: '执行',
  validate: '校验',
  publish: '登记成果',
  cleanup: '收尾',
};

const nodeTitle = (node: RunDiagnosticNode, modelCallIndex: number): string => {
  if (node.kind === 'round') {
    return node.round === undefined ? '轮次未记录' : `第 ${node.round + 1} 轮`;
  }
  if (node.kind === 'model') return `模型调用 ${modelCallIndex}`;
  if (node.kind === 'tool') return toolStageLabel(node.toolName);
  const owner = node.hostKind === 'skill-host' ? 'Skill' : 'Run';
  const phase = node.hostPhase ? hostPhaseName[node.hostPhase] : '阶段未记录';
  return `${owner} · ${phase}`;
};

const flattenTree = (roots: readonly RunDiagnosticTreeNode[]): RunDiagnosticNode[] =>
  roots.flatMap((entry) => [entry.node, ...flattenTree(entry.children)]);

const runTone = (status: RunDiagnosticsSummary['status']): BadgeTone => runStatusTone[status];

const metricValue = (metric: RunDiagnosticsSummary['usage']['promptTokens']): string => {
  if (metric.knownCallCount === 0) return metric.missingCallCount > 0 ? '未知' : '—';
  const subtotal = `${metric.knownSubtotal} token`;
  return metric.missingCallCount > 0
    ? `${subtotal}；另有 ${metric.missingCallCount} 次未知`
    : subtotal;
};

const executionStateLabel = (node: RunDiagnosticNode): string => {
  if (node.kind !== 'tool') return '';
  if (node.executionState === 'started') return '已执行';
  if (node.executionState === 'not-started') return '未执行';
  return '执行情况未记录';
};

const sourceStateName: Record<RunDiagnosticsSources['integrity'], string> = {
  complete: '记录完整',
  partial: '部分缺失',
  unavailable: '不可用',
};

const sourceReferenceName = (reference: RunDiagnosticSourceReference): string => {
  switch (reference.kind) {
    case 'knowledge-revision':
      return `${reference.title ?? '知识材料'} · 修订 ${reference.revisionId}`;
    case 'artifact-version':
      return `成果版本 ${reference.versionNumber ?? reference.versionId}`;
    case 'workspace-input-snapshot':
      return `工作区输入 · ${reference.format} · ${reference.snapshotId}`;
    case 'evidence':
      return `Evidence ${reference.evidenceId}`;
  }
};

const phaseName = (phase: RunDiagnosticsSources['memory']['phase']): string => {
  switch (phase) {
    case 'selected':
      return '已完成选择';
    case 'request-prepared':
      return '模型请求已准备';
    case 'dispatch-attempted':
      return '已记录派发尝试（不代表服务端已收到）';
    case 'legacy_unknown':
      return '历史阶段未记录';
    default:
      return '未记录';
  }
};

const materialOperationName: Record<
  RunDiagnosticsSources['materials']['reads'][number]['operation'],
  string
> = {
  preview: '预览',
  search: '检索',
  read: '读取正文',
  parse: '解析',
};

const memoryReasonName: Record<
  RunDiagnosticsSources['memory']['selectedItems'][number]['reason'],
  string
> = {
  'task-relevant': '与当前任务相关',
  'general-preference': '通用偏好',
  'conflict-pair': '冲突口径配对',
  'replay-inherited': '来自历史轮次',
  'pinned-rule': '固定规则',
};

export function RunExecutionDetails({
  scope,
  onClose,
}: {
  scope: RunDiagnosticsScopeRequest;
  onClose: () => void;
}): React.JSX.Element {
  const originalScopeKey = `${scope.workspaceId}\u0000${scope.taskId}\u0000${scope.runId}`;
  const [inspectedRun, setInspectedRun] = useState<{
    originScopeKey: string;
    scope: RunDiagnosticsScopeRequest;
  }>();
  const activeScope =
    inspectedRun?.originScopeKey === originalScopeKey ? inspectedRun.scope : scope;
  const isInspectingHistoryRun = activeScope.runId !== scope.runId;
  const diagnostics = useRunDiagnostics(activeScope);
  const [tab, setTab] = useState<DetailsTab>('chain');
  const [requestedTool, setRequestedTool] = useState<{ runId: string; nodeId: string }>();
  const detailNodeId =
    requestedTool?.runId === activeScope.runId ? requestedTool.nodeId : undefined;
  const detail = useRunDiagnosticNodeDetail(activeScope, detailNodeId);
  const tree = buildRunDiagnosticTree(diagnostics.nodes);
  const treeNodes = flattenTree(tree);
  const timelineNodes = mergeRunDiagnosticNodes([], diagnostics.nodes);
  const modelCallOrdinals = new Map<string, number>();
  let nextModelCallOrdinal = 1;
  for (const node of treeNodes) {
    if (node.kind === 'model') {
      modelCallOrdinals.set(node.id, nextModelCallOrdinal);
      nextModelCallOrdinal += 1;
    }
  }
  const hasNoCalls =
    diagnostics.summary?.modelCallCount === 0 &&
    diagnostics.summary.toolCallCount === 0 &&
    diagnostics.nodes.length === 0;

  return (
    <Modal variant="sheet" label="执行详情" onClose={onClose} className="run-execution-details">
      <SectionHeader
        variant="block"
        title="执行详情"
        hint={
          diagnostics.summary
            ? `Run 状态：${runStatusName[diagnostics.summary.status]}`
            : '当前或历史 Run 的模型与工具过程'
        }
        actions={
          <>
            {diagnostics.summary && (
              <Badge tone={runTone(diagnostics.summary.status)}>
                {runStatusName[diagnostics.summary.status]}
              </Badge>
            )}
            <Button variant="quiet" size="sm" type="button" onClick={onClose}>
              关闭
            </Button>
            {isInspectingHistoryRun && (
              <Button
                variant="quiet"
                size="sm"
                type="button"
                onClick={() => setInspectedRun(undefined)}
              >
                返回打开时的 Run
              </Button>
            )}
          </>
        }
      />
      <Tabs value={tab} onChange={setTab}>
        <TabList label="执行详情类别" size="sm">
          <Tab value="chain">执行链</Tab>
          <Tab value="timeline">时间轴</Tab>
          <Tab value="sources">工作依据</Tab>
          <Tab value="usage">用量与状态</Tab>
          <Tab value="history">记录与统计</Tab>
        </TabList>
        <div className="run-execution-details-panels">
          <TabPanel value="chain" className="run-execution-details-panel">
            {diagnostics.error && (
              <InlineError message={diagnostics.error} onRetry={diagnostics.refresh} />
            )}
            {diagnostics.loading && <InlineLoading label="正在读取执行详情…" />}
            {diagnostics.summary?.integrity === 'unavailable' && (
              <StatusNote
                tone="warning"
                message="该 Run 创建时没有执行诊断记录，无法从历史补全。"
              />
            )}
            {diagnostics.summary?.integrity === 'partial' && (
              <StatusNote tone="warning" message="部分过程记录缺失，当前内容可能不完整。" />
            )}
            {!diagnostics.loading && !diagnostics.error && !diagnostics.summary && (
              <EmptyNotice
                title="没有可读取的执行诊断"
                detail="该 Run 没有可回看的模型与工具执行记录。"
              />
            )}
            {diagnostics.summary && hasNoCalls && diagnostics.summary.integrity === 'complete' && (
              <EmptyNotice title="暂无模型或工具调用" />
            )}
            {diagnostics.summary && !hasNoCalls && (
              <ul className="run-execution-node-list">
                {tree.map((entry) => (
                  <DiagnosticTreeEntry
                    key={entry.node.id}
                    entry={entry}
                    modelCallOrdinals={modelCallOrdinals}
                    detailNodeId={detailNodeId}
                    detail={detail}
                    onLoadTool={(nodeId) => setRequestedTool({ runId: activeScope.runId, nodeId })}
                  />
                ))}
              </ul>
            )}
            <RunDiagnosticIssueMarkPanel
              key={activeScope.runId}
              scope={activeScope}
              nodes={diagnostics.nodes}
            />
          </TabPanel>
          <TabPanel value="timeline" className="run-execution-details-panel">
            {diagnostics.error && (
              <InlineError message={diagnostics.error} onRetry={diagnostics.refresh} />
            )}
            {diagnostics.loading && <InlineLoading label="正在读取执行时间轴…" />}
            {diagnostics.summary && (
              <Timeline nodes={timelineNodes} modelCallOrdinals={modelCallOrdinals} />
            )}
          </TabPanel>
          <TabPanel value="usage" className="run-execution-details-panel">
            {diagnostics.error && (
              <InlineError message={diagnostics.error} onRetry={diagnostics.refresh} />
            )}
            {diagnostics.loading && <InlineLoading label="正在读取执行详情…" />}
            {diagnostics.summary && (
              <>
                <SectionHeader variant="panel" title="执行概况" />
                <dl className="run-execution-facts">
                  <div>
                    <dt>模型调用</dt>
                    <dd>{diagnostics.summary.modelCallCount}</dd>
                  </div>
                  <div>
                    <dt>工具调用</dt>
                    <dd>{diagnostics.summary.toolCallCount}</dd>
                  </div>
                  <div>
                    <dt>工具实际执行</dt>
                    <dd>{diagnostics.summary.toolExecutionCount}</dd>
                  </div>
                  <div>
                    <dt>工具执行失败</dt>
                    <dd>{diagnostics.summary.failedToolExecutionCount}</dd>
                  </div>
                  <div>
                    <dt>参数拒绝</dt>
                    <dd>{diagnostics.summary.rejectedToolCallCount}</dd>
                  </div>
                </dl>
                <SectionHeader variant="panel" title="模型用量" />
                <dl className="run-execution-facts">
                  <div>
                    <dt>输入 token</dt>
                    <dd>{metricValue(diagnostics.summary.usage.promptTokens)}</dd>
                  </div>
                  <div>
                    <dt>输出 token</dt>
                    <dd>{metricValue(diagnostics.summary.usage.completionTokens)}</dd>
                  </div>
                  <div>
                    <dt>总 token</dt>
                    <dd>{metricValue(diagnostics.summary.usage.totalTokens)}</dd>
                  </div>
                </dl>
                {diagnostics.summary.integrity !== 'complete' && (
                  <StatusNote
                    tone="warning"
                    message={
                      diagnostics.summary.integrity === 'partial'
                        ? '部分过程记录缺失，统计可能不完整。'
                        : '该 Run 创建时没有执行诊断记录，无法从历史补全。'
                    }
                  />
                )}
              </>
            )}
          </TabPanel>
          <TabPanel value="sources" className="run-execution-details-panel">
            {diagnostics.error && (
              <InlineError message={diagnostics.error} onRetry={diagnostics.refresh} />
            )}
            {diagnostics.loading && <InlineLoading label="正在读取工作依据…" />}
            {!diagnostics.loading && !diagnostics.error && !diagnostics.sources && (
              <EmptyNotice title="没有可读取的工作依据" detail="该 Run 没有可回看的来源快照。" />
            )}
            {diagnostics.sources && <SourceFacts sources={diagnostics.sources} />}
          </TabPanel>
          <TabPanel value="history" className="run-execution-details-panel">
            <RunDiagnosticsHistoryPanel
              workspaceId={scope.workspaceId}
              taskId={scope.taskId}
              active={tab === 'history'}
              originalRunId={scope.runId}
              onSelectRun={(entry) => {
                setInspectedRun({
                  originScopeKey: originalScopeKey,
                  scope: {
                    workspaceId: scope.workspaceId,
                    taskId: entry.summary.taskId,
                    runId: entry.summary.runId,
                  },
                });
                setRequestedTool(undefined);
                setTab('chain');
              }}
            />
          </TabPanel>
        </div>
      </Tabs>
    </Modal>
  );
}

const issueCategoryOptions: { id: RunDiagnosticIssueMarkCategory; label: string }[] = [
  { id: 'model', label: '模型' },
  { id: 'tool', label: '工具' },
  { id: 'material', label: '材料' },
  { id: 'artifact', label: '成果' },
  { id: 'lifecycle', label: '运行生命周期' },
  { id: 'other', label: '其他' },
];

const isIssueCategory = (value: string): value is RunDiagnosticIssueMarkCategory =>
  issueCategoryOptions.some((option) => option.id === value);

function RunDiagnosticIssueMarkPanel({
  scope,
  nodes,
}: {
  scope: RunDiagnosticsScopeRequest;
  nodes: readonly RunDiagnosticNode[];
}): React.JSX.Element {
  const issueMark = useRunDiagnosticIssueMark(scope, true);
  const [category, setCategory] = useState<RunDiagnosticIssueMarkCategory>('other');
  const [diagnosticNodeId, setDiagnosticNodeId] = useState('');
  const initializedDraft = useRef(false);

  useEffect(() => {
    if (!issueMark.loaded || initializedDraft.current) return;
    initializedDraft.current = true;
    if (issueMark.mark) {
      setCategory(issueMark.mark.category);
      setDiagnosticNodeId(issueMark.mark.diagnosticNodeId ?? '');
    }
  }, [issueMark.loaded, issueMark.mark]);

  const nodeOptions = nodes.reduce<{
    modelCallCount: number;
    options: { id: string; label: string }[];
  }>(
    (result, node) => {
      const modelCallCount =
        node.kind === 'model' ? result.modelCallCount + 1 : result.modelCallCount;
      return {
        modelCallCount,
        options: [
          ...result.options,
          {
            id: node.id,
            label: `${nodeTitle(node, node.kind === 'model' ? modelCallCount : 0)} · ${node.id}`,
          },
        ],
      };
    },
    { modelCallCount: 0, options: [] },
  ).options;
  const selectedNodeUnavailable =
    diagnosticNodeId !== '' && !nodeOptions.some((option) => option.id === diagnosticNodeId);

  return (
    <section className="run-diagnostic-issue-mark">
      <SectionHeader variant="panel" title="问题标记" />
      <p className="run-diagnostic-issue-mark-description">
        记录这次 Run 的问题类别，可选关联同一 Run 的过程节点。
      </p>
      {issueMark.loading && <InlineLoading label="正在读取问题标记…" />}
      {issueMark.error && <InlineError message={issueMark.error} onRetry={issueMark.refresh} />}
      <div className="run-diagnostic-issue-mark-fields">
        <Field label="问题类别" controlId="run-diagnostic-issue-category">
          <FieldSelect
            id="run-diagnostic-issue-category"
            size="sm"
            value={category}
            options={issueCategoryOptions}
            disabled={!issueMark.loaded || issueMark.loading || issueMark.saving}
            onChange={(value) => {
              if (isIssueCategory(value)) setCategory(value);
            }}
          />
        </Field>
        <Field label="关联过程节点（可选）" controlId="run-diagnostic-issue-node">
          <FieldSelect
            id="run-diagnostic-issue-node"
            size="sm"
            value={diagnosticNodeId}
            options={[
              { id: '', label: '不关联节点' },
              ...(selectedNodeUnavailable
                ? [
                    {
                      id: diagnosticNodeId,
                      label: `已关联节点未载入 · ${diagnosticNodeId}`,
                      disabled: true,
                    },
                  ]
                : []),
              ...nodeOptions,
            ]}
            disabled={!issueMark.loaded || issueMark.loading || issueMark.saving}
            onChange={setDiagnosticNodeId}
          />
        </Field>
      </div>
      <ActionBar as="div" label="保存问题标记">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={!issueMark.mark || !issueMark.loaded || issueMark.saving}
          onClick={issueMark.clear}
        >
          清除标记
        </Button>
        <Button
          variant="primary"
          size="sm"
          type="button"
          disabled={!issueMark.loaded || issueMark.loading || issueMark.saving}
          onClick={() => issueMark.save(category, diagnosticNodeId || undefined)}
        >
          {issueMark.saving ? '正在保存…' : '保存标记'}
        </Button>
      </ActionBar>
      {issueMark.toast && (
        <TransientToast {...issueMark.toast} onDismiss={issueMark.dismissToast} />
      )}
    </section>
  );
}

function RunDiagnosticsHistoryPanel({
  workspaceId,
  taskId,
  active,
  originalRunId,
  onSelectRun,
}: {
  workspaceId: string;
  taskId?: string;
  active: boolean;
  originalRunId: string;
  onSelectRun: (entry: RunDiagnosticsHistoryEntry) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<HistoryFilterDraft>(() => historyFilterDraft(taskId));
  const [filter, setFilter] = useState<RunDiagnosticsHistoryFilter>(() =>
    taskId ? { taskId } : {},
  );
  const [rangeError, setRangeError] = useState('');
  const history = useRunDiagnosticsHistory(workspaceId, filter, active);

  const updateDraft = <Key extends keyof HistoryFilterDraft>(
    key: Key,
    value: HistoryFilterDraft[Key],
  ): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const applyFilters = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const fromCreatedAt = localDateBoundary(draft.fromDate, false);
    const throughCreatedAt = localDateBoundary(draft.throughDate, true);
    if (
      (draft.fromDate && fromCreatedAt === undefined) ||
      (draft.throughDate && throughCreatedAt === undefined)
    ) {
      setRangeError('日期无效，请重新选择。');
      return;
    }
    if (
      fromCreatedAt !== undefined &&
      throughCreatedAt !== undefined &&
      fromCreatedAt > throughCreatedAt
    ) {
      setRangeError('开始日期不能晚于截止日期。');
      return;
    }

    setRangeError('');
    setFilter({
      ...(draft.taskScope === 'task' && taskId ? { taskId } : {}),
      ...(fromCreatedAt !== undefined ? { fromCreatedAt } : {}),
      ...(throughCreatedAt !== undefined ? { throughCreatedAt } : {}),
      ...(draft.expertRevisionId.trim() ? { expertRevisionId: draft.expertRevisionId.trim() } : {}),
      ...(draft.skillRevisionId.trim() ? { skillRevisionId: draft.skillRevisionId.trim() } : {}),
      ...(draft.modelFingerprint.trim() ? { modelFingerprint: draft.modelFingerprint.trim() } : {}),
    });
  };

  const clearFilters = (): void => {
    setDraft(historyFilterDraft());
    setFilter({});
    setRangeError('');
  };

  const page = history.page;
  const stats = page?.stats;
  const hasFilters = Object.keys(filter).length > 0;

  return (
    <div className="run-diagnostics-history">
      <SectionHeader variant="panel" title="执行记录与统计" />
      <form className="run-diagnostics-history-filters" onSubmit={applyFilters}>
        <Field label="任务范围" controlId="run-history-task-scope">
          <FieldSelect
            id="run-history-task-scope"
            size="sm"
            ariaLabel="任务范围"
            value={draft.taskScope}
            options={[
              ...(taskId ? [{ id: 'task', label: '当前任务' }] : []),
              { id: 'workspace', label: '整个工作空间' },
            ]}
            onChange={(value) => updateDraft('taskScope', value === 'task' ? 'task' : 'workspace')}
          />
        </Field>
        <Field label="创建开始日期" controlId="run-history-from-date">
          <TextField
            id="run-history-from-date"
            size="sm"
            type="date"
            value={draft.fromDate}
            onChange={(event) => updateDraft('fromDate', event.currentTarget.value)}
          />
        </Field>
        <Field label="创建截止日期" controlId="run-history-through-date">
          <TextField
            id="run-history-through-date"
            size="sm"
            type="date"
            value={draft.throughDate}
            onChange={(event) => updateDraft('throughDate', event.currentTarget.value)}
          />
        </Field>
        <Field label="专家修订 ID" controlId="run-history-expert-revision">
          <TextField
            id="run-history-expert-revision"
            size="sm"
            value={draft.expertRevisionId}
            onChange={(event) => updateDraft('expertRevisionId', event.currentTarget.value)}
          />
        </Field>
        <Field label="技能修订 ID" controlId="run-history-skill-revision">
          <TextField
            id="run-history-skill-revision"
            size="sm"
            value={draft.skillRevisionId}
            onChange={(event) => updateDraft('skillRevisionId', event.currentTarget.value)}
          />
        </Field>
        <Field label="模型指纹" controlId="run-history-model-fingerprint">
          <TextField
            id="run-history-model-fingerprint"
            size="sm"
            value={draft.modelFingerprint}
            onChange={(event) => updateDraft('modelFingerprint', event.currentTarget.value)}
          />
        </Field>
        <div className="run-diagnostics-history-filter-actions">
          <Button variant="primary" size="sm" type="submit">
            应用筛选
          </Button>
          <Button variant="quiet" size="sm" type="button" onClick={clearFilters}>
            清除条件
          </Button>
        </div>
        {rangeError && <InlineError message={rangeError} />}
      </form>
      <p className="run-execution-node-fact">
        日期范围按 Run 创建时间筛选，使用本机时区并包含首尾日期。修订与模型指纹匹配 Run
        创建时固定值；历史未记录时不会代入当前配置。
      </p>
      {history.error && <InlineError message={history.error} onRetry={history.refresh} />}
      {history.loading && <InlineLoading label="正在读取执行记录与统计…" />}
      {stats && <HistoryStatistics stats={stats} />}
      {!history.loading && !history.error && page && page.runs.length === 0 && (
        <EmptyNotice
          title={hasFilters ? '没有符合条件的执行记录' : '暂无执行记录'}
          detail={
            hasFilters ? '清除部分条件或扩大日期范围后重试。' : '此工作空间还没有可回看的 Run。'
          }
        />
      )}
      {page && page.runs.length > 0 && (
        <>
          <SectionHeader variant="panel" title={`执行记录 · ${page.stats.runCount} 个匹配 Run`} />
          <ul className="run-execution-node-list">
            {page.runs.map((entry) => (
              <li key={entry.summary.runId}>
                <ListRow
                  variant="divider"
                  multiline={true}
                  title={`Run ${entry.summary.runId}`}
                  detail={`${runStatusName[entry.summary.status]} · 模型调用 ${entry.summary.modelCallCount} 次 · 工具调用 ${entry.summary.toolCallCount} 次`}
                  meta={`${new Date(entry.createdAt).toLocaleString()} · 模型版本 ${entry.modelFingerprint ?? '未记录'}`}
                  onClick={() => onSelectRun(entry)}
                  label={`查看 Run ${entry.summary.runId} 的执行详情`}
                  selected={entry.summary.runId === originalRunId}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      {page?.nextCursor && (
        <Button
          variant="quiet"
          size="sm"
          type="button"
          disabled={history.loadingMore}
          onClick={history.loadMore}
        >
          {history.loadingMore ? '正在读取…' : '加载更多'}
        </Button>
      )}
    </div>
  );
}

function HistoryStatistics({ stats }: { stats: RunDiagnosticsHistoryStats }): React.JSX.Element {
  const failureRate =
    stats.runFailure.rate === null
      ? '未知（没有已完成或失败 Run）'
      : `${stats.runFailure.failedRunCount}/${stats.runFailure.denominatorRunCount}（${(stats.runFailure.rate * 100).toFixed(1)}%）`;
  const duration = stats.modelCallDurationMs;
  return (
    <section className="run-diagnostics-history-stats" aria-label="筛选范围统计">
      <SectionHeader variant="panel" title={`${stats.runCount} 个匹配 Run 的统计`} />
      <dl className="run-execution-facts">
        <div>
          <dt>Run 状态</dt>
          <dd>
            已完成 {stats.statusCounts.completed} · 失败 {stats.statusCounts.failed} · 已停止{' '}
            {stats.statusCounts.cancelled} · 进行中 {stats.statusCounts.running}
          </dd>
        </div>
        <div>
          <dt>Run 失败率</dt>
          <dd>
            {failureRate}；分母 {stats.runFailure.denominatorRunCount}，排除已停止{' '}
            {stats.runFailure.excludedCancelledRunCount}、进行中{' '}
            {stats.runFailure.excludedRunningRunCount}
          </dd>
        </div>
        <div>
          <dt>模型与工具调用</dt>
          <dd>
            模型 {stats.modelCallCount} · 工具 {stats.toolCallCount} · 实际执行{' '}
            {stats.toolExecutionCount} · 执行失败 {stats.failedToolExecutionCount} · 参数拒绝{' '}
            {stats.rejectedToolCallCount}
          </dd>
        </div>
        <div>
          <dt>记录完整性</dt>
          <dd>
            完整 {stats.integrityCounts.complete} · 部分缺失 {stats.integrityCounts.partial} ·
            不可用 {stats.integrityCounts.unavailable}
          </dd>
        </div>
        <div>
          <dt>输入 token</dt>
          <dd>{aggregateMetricValue(stats.usage.promptTokens)}</dd>
        </div>
        <div>
          <dt>输出 token</dt>
          <dd>{aggregateMetricValue(stats.usage.completionTokens)}</dd>
        </div>
        <div>
          <dt>总 token</dt>
          <dd>{aggregateMetricValue(stats.usage.totalTokens)}</dd>
        </div>
        <div>
          <dt>模型调用耗时</dt>
          <dd>
            p50 {durationValue(duration.p50)} · p95 {durationValue(duration.p95)} · 测量样本{' '}
            {duration.sampleCount}；排除待开始 {duration.excludedCounts.pending}、进行中{' '}
            {duration.excludedCounts.running}、中断 {duration.excludedCounts.interrupted}、未知{' '}
            {duration.excludedCounts.unknown}、缺少测量 {duration.excludedCounts.missingMeasurement}
          </dd>
        </div>
      </dl>
      <p className="run-execution-node-fact">
        统计覆盖全部匹配
        Run，不受当前分页影响。耗时只使用已记录的模型调用单调时长；工具和宿主阶段不计入。
      </p>
    </section>
  );
}

function SourceFacts({ sources }: { sources: RunDiagnosticsSources }): React.JSX.Element {
  const materialState = (state: string): string =>
    state === 'recorded' ? '可回溯' : state === 'unavailable' ? '记录缺失或不匹配' : '未记录';

  return (
    <div className="run-diagnostics-sources">
      <StatusNote
        tone={sources.integrity === 'complete' ? 'success' : 'warning'}
        message={`工作依据：${sourceStateName[sources.integrity]}`}
      />
      <SectionHeader variant="panel" title="固定上下文" />
      {sources.fixedContext.taskContextRevisionId && (
        <p className="run-execution-node-fact">
          任务上下文修订：{sources.fixedContext.taskContextRevisionId}
        </p>
      )}
      <ul className="run-execution-node-list">
        {sources.fixedContext.expert && (
          <li>
            <ListRow
              variant="divider"
              multiline={true}
              title={`专家：${sources.fixedContext.expert.name ?? sources.fixedContext.expert.expertId}`}
              detail={`修订 ${sources.fixedContext.expert.revisionId}`}
              meta={materialState(sources.fixedContext.expert.state)}
            />
          </li>
        )}
        {sources.fixedContext.model && (
          <li>
            <ListRow
              variant="divider"
              multiline={true}
              title={`模型：${sources.fixedContext.model.snapshot?.displayName ?? (sources.fixedContext.model.reference?.mode === 'profile' ? sources.fixedContext.model.reference.modelProfileId : '应用默认模型')}`}
              detail={[
                sources.fixedContext.model.reference?.mode === 'profile'
                  ? `模型配置 ${sources.fixedContext.model.reference.modelProfileId}`
                  : undefined,
                sources.fixedContext.model.snapshot?.fingerprint
                  ? `指纹 ${sources.fixedContext.model.snapshot.fingerprint}`
                  : undefined,
              ]
                .filter((value) => value !== undefined)
                .join(' · ')}
              meta={phaseName(sources.fixedContext.model.memoryPhase)}
            />
          </li>
        )}
        {sources.fixedContext.skills.map((skill) => (
          <li key={skill.bindingId}>
            <ListRow
              variant="divider"
              multiline={true}
              title={`技能：${skill.name ?? skill.skillId ?? skill.skillRevisionId}`}
              detail={[
                `技能修订 ${skill.skillRevisionId}`,
                `配置修订 ${skill.profileRevisionId}`,
                skill.environment
                  ? `环境 ${skill.environment.id} · ${skill.environment.status ?? materialState(skill.environment.state)}`
                  : undefined,
                skill.environment?.lockHash ? `依赖锁 ${skill.environment.lockHash}` : undefined,
                skill.environment?.platform
                  ? `${skill.environment.platform.os}/${skill.environment.platform.arch}/${skill.environment.platform.abi}`
                  : undefined,
                ...skill.dependencySnapshots.map(
                  (dependency) =>
                    `工具链 ${dependency.id}${dependency.manifestHash ? ` · ${dependency.manifestHash}` : ` · ${materialState(dependency.state)}`}`,
                ),
              ]
                .filter((value) => value !== undefined)
                .join(' · ')}
              meta={materialState(skill.state)}
            />
          </li>
        ))}
        {sources.fixedContext.state !== 'recorded' && (
          <li>
            <StatusNote
              tone="warning"
              message={`固定上下文：${materialState(sources.fixedContext.state)}`}
            />
          </li>
        )}
      </ul>

      <SectionHeader variant="panel" title="材料与读取足迹" />
      {sources.materials.selected.length === 0 && sources.materials.reads.length === 0 ? (
        <p className="run-execution-node-fact">没有材料选择或读取记录。</p>
      ) : (
        <ul className="run-execution-node-list">
          {sources.materials.selected.map((selection, index) => (
            <li key={`${selection.reference.kind}:${index}`}>
              <ListRow
                variant="divider"
                multiline={true}
                title={sourceReferenceName(selection.reference)}
                detail={`用途：${selection.purpose}`}
                meta={selection.wasRead ? '已读取正文' : '已选择，未读取正文'}
                trailing={
                  <Badge tone={selection.reference.state === 'recorded' ? 'success' : 'warning'}>
                    {materialState(selection.reference.state)}
                  </Badge>
                }
              />
            </li>
          ))}
          {sources.materials.reads.map((read) => (
            <li key={read.id}>
              <ListRow
                variant="divider"
                multiline={true}
                title={`${sourceReferenceName(read.reference)} · ${materialOperationName[read.operation]}`}
                detail={`读取记录 ${read.id}`}
                meta={new Date(read.capturedAt).toLocaleString()}
                trailing={
                  <Badge tone={read.reference.state === 'recorded' ? 'success' : 'warning'}>
                    {materialState(read.reference.state)}
                  </Badge>
                }
              />
            </li>
          ))}
        </ul>
      )}

      <SectionHeader variant="panel" title="记忆与连续上下文" />
      <p className="run-execution-node-fact">
        记忆：选择 {sources.memory.selectedItems.length} 条，读取足迹 {sources.memory.reads.length}{' '}
        条；{phaseName(sources.memory.phase)}。
      </p>
      {(sources.memory.selectedItems.length > 0 || sources.memory.reads.length > 0) && (
        <ul className="run-execution-node-list">
          {sources.memory.selectedItems.map((memory) => (
            <li key={`selected:${memory.revisionId}`}>
              <ListRow
                variant="divider"
                multiline={true}
                title={`已选记忆修订 ${memory.revisionId}`}
                detail={`记忆 ${memory.memoryId} · ${memoryReasonName[memory.reason]} · ${memory.contentHash}`}
                meta={`注入顺序 ${memory.order}`}
              />
            </li>
          ))}
          {sources.memory.reads.map((read) => (
            <li key={`read:${read.id}`}>
              <ListRow
                variant="divider"
                multiline={true}
                title={`记忆读取 ${read.memoryRevisionId}`}
                detail={`记忆 ${read.memoryId} · ${read.contentHash}`}
                meta={`${read.selectedForInjection ? '选中注入' : '读取但未注入'} · ${read.provenanceState === 'known' ? '来源已核验' : '历史来源未核验'}`}
              />
            </li>
          ))}
        </ul>
      )}
      <p className="run-execution-node-fact">
        连续上下文修订：{sources.continuity.revisionId ?? materialState(sources.continuity.state)}
        ；引用来源 Run {sources.continuity.sourceRunIds.length} 个、成果版本{' '}
        {sources.continuity.artifactVersionIds.length} 个。
      </p>
      {(sources.continuity.sourceRunIds.length > 0 ||
        sources.continuity.artifactVersionIds.length > 0) && (
        <Disclosure
          label={`连续上下文来源身份 · ${sources.continuity.sourceRunIds.length + sources.continuity.artifactVersionIds.length} 项`}
        >
          <ul className="run-execution-node-list">
            {sources.continuity.sourceRunIds.map((sourceRunId) => (
              <li key={`run:${sourceRunId}`}>
                <ListRow variant="divider" multiline={true} title="来源 Run" detail={sourceRunId} />
              </li>
            ))}
            {sources.continuity.artifactVersionIds.map((versionId) => (
              <li key={`version:${versionId}`}>
                <ListRow
                  variant="divider"
                  multiline={true}
                  title="来源成果版本"
                  detail={versionId}
                />
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      <SectionHeader variant="panel" title="成果与输入关系" />
      {sources.artifacts.producedVersions.length === 0 &&
      sources.artifacts.inputRelations.length === 0 ? (
        <p className="run-execution-node-fact">没有登记本次 Run 的成果版本或输入关系。</p>
      ) : (
        <ul className="run-execution-node-list">
          {sources.artifacts.producedVersions.map((version) => (
            <li key={version.versionId}>
              <ListRow
                variant="divider"
                multiline={true}
                title={`成果版本 ${version.versionNumber}`}
                detail={`版本 ${version.versionId}`}
                meta={version.sourceDeclarationKind ?? version.origin}
              />
            </li>
          ))}
          {sources.artifacts.inputRelations.map((relation, index) => (
            <li key={`${relation.outputVersionId}:${index}`}>
              <ListRow
                variant="divider"
                multiline={true}
                title={`输入：${sourceReferenceName(relation.input)}`}
                detail={`关联类型：${relation.relation}`}
                meta={`成果版本 ${relation.outputVersionId}`}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DiagnosticTreeEntry({
  entry,
  modelCallOrdinals,
  detailNodeId,
  detail,
  onLoadTool,
}: {
  entry: RunDiagnosticTreeNode;
  modelCallOrdinals: ReadonlyMap<string, number>;
  detailNodeId: string | undefined;
  detail: ReturnType<typeof useRunDiagnosticNodeDetail>;
  onLoadTool: (nodeId: string) => void;
}): React.JSX.Element {
  const { node, children, unresolvedParent } = entry;
  return (
    <li
      className="run-execution-tree-entry"
      tabIndex={0}
      aria-label={`${nodeTitle(node, modelCallOrdinals.get(node.id) ?? 0)} · ${nodeStatusName[node.status]}`}
    >
      {unresolvedParent && (
        <p className="run-execution-node-fact">父节点未记录或无法关联，本节点仍按独立记录显示。</p>
      )}
      <DiagnosticNodeRow
        node={node}
        modelCallIndex={modelCallOrdinals.get(node.id) ?? 0}
        detailNodeId={detailNodeId}
        detail={detail}
        onLoadDetail={() => onLoadTool(node.id)}
      />
      {children.length > 0 && (
        <ul className="run-execution-node-list run-execution-node-list--nested">
          {children.map((child) => (
            <DiagnosticTreeEntry
              key={child.node.id}
              entry={child}
              modelCallOrdinals={modelCallOrdinals}
              detailNodeId={detailNodeId}
              detail={detail}
              onLoadTool={onLoadTool}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

const formatTimelineTime = (value: number): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `时间值异常（${String(value)}）`;
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

function Timeline({
  nodes,
  modelCallOrdinals,
}: {
  nodes: readonly RunDiagnosticNode[];
  modelCallOrdinals: ReadonlyMap<string, number>;
}): React.JSX.Element {
  const knownTimes = nodes.flatMap((node) =>
    [node.occurredAt, node.endedAt].filter((value): value is number => value !== undefined),
  );
  const minimum = knownTimes.length > 0 ? Math.min(...knownTimes) : undefined;
  const maximum = knownTimes.length > 0 ? Math.max(...knownTimes) : undefined;
  const span = minimum === undefined || maximum === undefined ? 1 : Math.max(1, maximum - minimum);

  return (
    <div className="run-diagnostic-timeline">
      <p className="run-execution-node-fact">
        时间轴按已记录的本机时间展示；单调时钟测得的阶段耗时单独标注，不汇总子节点耗时。
      </p>
      {nodes.length === 0 ? (
        <EmptyNotice title="暂无可显示的执行节点" />
      ) : (
        <ol className="run-diagnostic-timeline-list">
          {nodes.map((node) => {
            const anchor = node.startedAt ?? node.occurredAt;
            const end = node.endedAt;
            const hasTime = anchor !== undefined;
            const invalidInterval =
              node.startedAt !== undefined && end !== undefined && end < node.startedAt;
            const left =
              hasTime && minimum !== undefined
                ? Math.max(0, Math.min(100, ((anchor - minimum) / span) * 100))
                : 0;
            const width =
              hasTime && end !== undefined && !invalidInterval
                ? Math.max(0.7, Math.min(100 - left, ((end - anchor) / span) * 100))
                : 0.7;
            const positionText = !hasTime
              ? '时间未记录'
              : node.startedAt === undefined
                ? `首次记录 ${formatTimelineTime(anchor)}`
                : `开始 ${formatTimelineTime(node.startedAt)}`;
            const endText = end === undefined ? undefined : `结束 ${formatTimelineTime(end)}`;
            const intervalText = invalidInterval
              ? '时间区间异常：结束早于开始'
              : node.status === 'running' && end === undefined
                ? '运行中占位；结束时间未记录'
                : undefined;
            const monotonicText =
              node.durationMs === undefined ? undefined : `单调耗时 ${node.durationMs} ms`;
            const processText =
              node.kind === 'host' && node.hostKind === 'skill-host' && node.hostPhase === 'execute'
                ? '子进程内部阶段未记录'
                : undefined;
            const accessibleText = [
              nodeTitle(node, modelCallOrdinals.get(node.id) ?? 0),
              nodeStatusName[node.status],
              positionText,
              endText,
              monotonicText,
              intervalText,
              processText,
            ]
              .filter((value) => value !== undefined)
              .join('；');

            return (
              <li
                key={node.id}
                className="run-diagnostic-timeline-item"
                tabIndex={0}
                aria-label={accessibleText}
              >
                <ListRow
                  variant="card"
                  multiline={true}
                  title={nodeTitle(node, modelCallOrdinals.get(node.id) ?? 0)}
                  detail={accessibleText}
                  trailing={
                    <Badge tone={nodeStatusTone[node.status]}>{nodeStatusName[node.status]}</Badge>
                  }
                >
                  <div className="run-diagnostic-timeline-track" aria-hidden="true">
                    {hasTime && !invalidInterval && (
                      <span
                        className={`run-diagnostic-timeline-bar run-diagnostic-timeline-bar--${node.status}`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      />
                    )}
                  </div>
                </ListRow>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function DiagnosticNodeRow({
  node,
  modelCallIndex,
  detailNodeId,
  detail,
  onLoadDetail,
}: {
  node: RunDiagnosticNode;
  modelCallIndex: number;
  detailNodeId: string | undefined;
  detail: ReturnType<typeof useRunDiagnosticNodeDetail>;
  onLoadDetail: () => void;
}): React.JSX.Element {
  const isTool = node.kind === 'tool';
  const title = nodeTitle(node, modelCallIndex);
  const detailLabel = isTool ? executionStateLabel(node) : undefined;
  const meta = [
    nodeStatusName[node.status],
    node.durationMs !== undefined ? `单调耗时 ${node.durationMs} ms` : undefined,
  ]
    .filter((value) => value !== undefined)
    .join(' · ');

  return (
    <ListRow
      variant="divider"
      multiline={true}
      title={title}
      detail={
        node.kind === 'round'
          ? node.round === undefined
            ? '轮次标识未记录'
            : `模型与工具调用的轮次 ${node.round + 1}`
          : isTool
            ? `${detailLabel ?? '执行情况未记录'}${node.toolName ? ` · ${node.toolName}` : ''}`
            : node.kind === 'host'
              ? [node.operationId, node.toolCallId, node.executionId]
                  .filter((value) => value !== undefined)
                  .join(' · ')
              : node.finishReason
                ? `结束原因：${node.finishReason}`
                : undefined
      }
      meta={meta}
      trailing={<Badge tone={nodeStatusTone[node.status]}>{nodeStatusName[node.status]}</Badge>}
    >
      {node.kind === 'model' && node.timeToFirstTextMs !== undefined && (
        <p className="run-execution-node-fact">首个可见文本耗时：{node.timeToFirstTextMs} ms</p>
      )}
      {isTool && (
        <Disclosure label="工具载荷与结果">
          <div className="run-execution-tool-detail">
            {detailNodeId === node.id && detail.loading && (
              <InlineLoading label="正在读取工具载荷…" />
            )}
            {detailNodeId === node.id && detail.error && (
              <InlineError message={detail.error} onRetry={detail.retry} />
            )}
            {detailNodeId === node.id && detail.detail === null && !detail.loading && (
              <EmptyNotice title="没有可读取的工具载荷" />
            )}
            {detailNodeId === node.id && detail.detail && !detail.loading && (
              <>
                {detail.detail.truncated && (
                  <StatusNote tone="warning" message="载荷已截断，以下为可读取的原始片段。" />
                )}
                <pre>{detail.detail.payloadJson}</pre>
              </>
            )}
            <AsyncButton
              size="sm"
              variant="secondary"
              label={detailNodeId === node.id ? '重新加载工具载荷' : '查看工具载荷'}
              busyLabel="正在读取…"
              busy={detailNodeId === node.id && detail.loading}
              onClick={detailNodeId === node.id ? detail.retry : onLoadDetail}
            />
          </div>
        </Disclosure>
      )}
    </ListRow>
  );
}
