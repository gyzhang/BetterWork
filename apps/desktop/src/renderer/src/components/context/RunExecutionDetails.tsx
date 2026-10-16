import type {
  RunDiagnosticNode,
  RunDiagnosticsScopeRequest,
  RunDiagnosticsSummary,
} from '@betterwork/agent-protocol';
import { useState } from 'react';

import { useRunDiagnosticNodeDetail } from '../../hooks/use-run-diagnostic-node-detail';
import { useRunDiagnostics } from '../../hooks/use-run-diagnostics';
import { runStatusName, toolStageLabel } from '../../lib/labels';
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

type DetailsTab = 'chain' | 'usage';

interface RoundGroup {
  id: string;
  round?: number;
  sequence: number;
  nodes: RunDiagnosticNode[];
}

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

const groupNodesByRound = (nodes: readonly RunDiagnosticNode[]): RoundGroup[] => {
  const roundNumbers = new Map<string, number>();
  for (const node of nodes) {
    if (node.kind === 'round' && node.round !== undefined) roundNumbers.set(node.id, node.round);
  }

  const groups = new Map<string, RoundGroup>();
  for (const node of nodes) {
    const groupId =
      node.kind === 'round' ? node.id : (node.parentId ?? `round:${node.round ?? 'unknown'}`);
    const round =
      node.kind === 'round'
        ? node.round
        : node.parentId
          ? roundNumbers.get(node.parentId)
          : node.round;
    const current = groups.get(groupId);
    if (current) {
      if (node.kind !== 'round') current.nodes.push(node);
      current.sequence = Math.min(
        current.sequence,
        node.sourceSequenceStart ?? Number.MAX_SAFE_INTEGER,
      );
      continue;
    }
    groups.set(groupId, {
      id: groupId,
      ...(round !== undefined ? { round } : {}),
      sequence: node.sourceSequenceStart ?? Number.MAX_SAFE_INTEGER,
      nodes: node.kind === 'round' ? [] : [node],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      nodes: [...group.nodes].sort(
        (left, right) =>
          (left.sourceSequenceStart ?? Number.MAX_SAFE_INTEGER) -
            (right.sourceSequenceStart ?? Number.MAX_SAFE_INTEGER) ||
          left.id.localeCompare(right.id),
      ),
    }))
    .sort((left, right) => {
      if (left.round !== undefined && right.round !== undefined) return left.round - right.round;
      if (left.round !== undefined) return -1;
      if (right.round !== undefined) return 1;
      return left.sequence - right.sequence || left.id.localeCompare(right.id);
    });
};

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
  const groups = groupNodesByRound(diagnostics.nodes);
  const modelCallOrdinals = new Map<string, number>();
  let nextModelCallOrdinal = 1;
  for (const group of groups) {
    for (const node of group.nodes) {
      if (node.kind === 'model') {
        modelCallOrdinals.set(node.id, nextModelCallOrdinal);
        nextModelCallOrdinal += 1;
      }
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
            {diagnostics.summary &&
              !hasNoCalls &&
              groups.map((group) => (
                <section className="run-execution-round" key={group.id}>
                  <SectionHeader
                    variant="panel"
                    title={group.round === undefined ? '轮次未记录' : `第 ${group.round + 1} 轮`}
                    hint={`模型 ${group.nodes.filter((node) => node.kind === 'model').length} 次 · 工具 ${group.nodes.filter((node) => node.kind === 'tool').length} 次`}
                  />
                  <ul className="run-execution-node-list">
                    {group.nodes.map((node) => (
                      <li key={node.id}>
                        <DiagnosticNodeRow
                          node={node}
                          modelCallIndex={modelCallOrdinals.get(node.id) ?? 0}
                          detailNodeId={detailNodeId}
                          detail={detail}
                          onLoadDetail={() => {
                            setRequestedTool({ runId: scope.runId, nodeId: node.id });
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
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
        </div>
      </Tabs>
    </Modal>
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
  const title = isTool ? toolStageLabel(node.toolName) : `模型调用 ${modelCallIndex}`;
  const detailLabel = isTool ? executionStateLabel(node) : undefined;
  const meta = [
    nodeStatusName[node.status],
    node.durationMs !== undefined ? `总耗时 ${node.durationMs} ms` : undefined,
  ]
    .filter((value) => value !== undefined)
    .join(' · ');

  return (
    <ListRow
      variant="divider"
      multiline={true}
      title={title}
      detail={
        isTool
          ? `${detailLabel ?? '执行情况未记录'}${node.toolName ? ` · ${node.toolName}` : ''}`
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
