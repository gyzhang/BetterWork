import type {
  EvidenceSummary,
  MaterialCandidate,
  MaterialPurpose,
  McpConnectionSummary,
  McpToolBinding,
  ScheduleOccurrenceDetail,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import { Fragment, useCallback, useState } from 'react';

import { useRunSourcePreview } from '../../hooks/use-run-source-preview';
import { CloseIcon } from '../../icons';
import { reportAction } from '../../lib/async-action';
import { materialPurposeName } from '../../lib/labels';
import { materialCandidateKey, taskMaterialKey } from '../../lib/materials';
import { scheduleSourceSnapshotStatusLabel } from '../../lib/schedule-detail';
import { ActionBar } from '../ActionBar';
import { AsyncButton, InlineLoading } from '../AsyncButton';
import { Button } from '../Button';
import { Disclosure } from '../Disclosure';
import { EmptyContext, EmptyNotice } from '../EmptyState';
import { FieldSelect } from '../FieldSelect';
import { IconButton } from '../IconButton';
import { InlineError } from '../InlineError';
import { ListRow } from '../ListRow';
import { McpToolBindingsPicker } from '../McpToolBindingsPicker';
import { SectionHeader } from '../SectionHeader';
import { SourceRow } from '../SourceRow';
import { StatusNote } from '../StatusNote';
import { type ToastTone, TransientToast } from '../TransientToast';

const MATERIAL_PURPOSE_OPTIONS = Object.entries(materialPurposeName).map(([id, label]) => ({
  id,
  label,
}));

export interface SourcesContextProps {
  evidence: EvidenceSummary[];
  activeRunId: string | undefined;
  onOpenSource: (sourcePath: string) => Promise<void>;
  materials: TaskMaterialSelection[];
  onCommitMaterials: (materials: TaskMaterialSelection[]) => void;
  materialsDisabled: boolean;
  scheduleContinuation?: {
    occurrence: ScheduleOccurrenceDetail;
    sourceSnapshotId?: string;
    scopeAttached: boolean;
    removingScope: boolean;
    scopeError: string;
    onRemoveScope: () => void;
  };
  materialCandidates: MaterialCandidate[];
  onRequestMaterials: (kind: 'file' | 'knowledge' | 'artifact') => void;
  mcpConnections: McpConnectionSummary[];
  mcpToolBindings: McpToolBinding[];
  onMcpToolBindingsChange: (bindings: McpToolBinding[]) => void;
}

export function SourcesContext({
  evidence,
  activeRunId,
  onOpenSource,
  materials,
  onCommitMaterials,
  materialsDisabled,
  scheduleContinuation,
  materialCandidates,
  onRequestMaterials,
  mcpConnections,
  mcpToolBindings,
  onMcpToolBindingsChange,
}: SourcesContextProps): React.JSX.Element {
  return (
    <>
      {scheduleContinuation && (
        <section className="context-section">
          <SectionHeader
            title="定时任务本期范围"
            hint={
              scheduleContinuation.scopeAttached ? '后续运行仍包含此快照' : '当前任务未绑定此快照'
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
                            materials.filter((item) => taskMaterialKey(item) !== materialKey),
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
        key={activeRunId ?? 'task'}
        evidence={evidence}
        activeRunId={activeRunId}
        onOpenSource={onOpenSource}
      />
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
