import type {
  RunDiagnosticNode,
  RunDiagnosticSourceReference,
  RunDiagnosticsScopeRequest,
  RunDiagnosticsSources,
  RunDiagnosticsSummary,
} from '@betterwork/agent-protocol';
import { useState } from 'react';

import { useRunDiagnosticNodeDetail } from '../../hooks/use-run-diagnostic-node-detail';
import { useRunDiagnostics } from '../../hooks/use-run-diagnostics';
import { runStatusName, toolStageLabel } from '../../lib/labels';
import {
  buildRunDiagnosticTree,
  mergeRunDiagnosticNodes,
  type RunDiagnosticTreeNode,
} from '../../lib/run-diagnostics';
import { AsyncButton, InlineLoading } from '../AsyncButton';
import { Badge, type BadgeTone } from '../Badge';
import { Button } from '../Button';
import { Disclosure } from '../Disclosure';
import { EmptyNotice } from '../EmptyState';
import { InlineError } from '../InlineError';
import { ListRow } from '../ListRow';
import { Modal } from '../Modal';
import { SectionHeader } from '../SectionHeader';
import { StatusNote } from '../StatusNote';
import { Tab, TabList, TabPanel, Tabs } from '../Tabs';

type DetailsTab = 'chain' | 'timeline' | 'usage' | 'sources';

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
  const diagnostics = useRunDiagnostics(scope);
  const [tab, setTab] = useState<DetailsTab>('chain');
  const [requestedTool, setRequestedTool] = useState<{ runId: string; nodeId: string }>();
  const detailNodeId = requestedTool?.runId === scope.runId ? requestedTool.nodeId : undefined;
  const detail = useRunDiagnosticNodeDetail(scope, detailNodeId);
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
          </>
        }
      />
      <Tabs value={tab} onChange={setTab}>
        <TabList label="执行详情类别" size="sm">
          <Tab value="chain">执行链</Tab>
          <Tab value="timeline">时间轴</Tab>
          <Tab value="sources">工作依据</Tab>
          <Tab value="usage">用量与状态</Tab>
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
                    onLoadTool={(nodeId) => setRequestedTool({ runId: scope.runId, nodeId })}
                  />
                ))}
              </ul>
            )}
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
        </div>
      </Tabs>
    </Modal>
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
