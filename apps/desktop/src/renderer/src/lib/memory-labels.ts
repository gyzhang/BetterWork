import type {
  MemoryEffectiveStatus,
  MemoryFacet,
  MemoryJobStatus,
  MemoryRecallExclusionReason,
  MemoryReplayBoundaryReason,
  MemoryRunPhase,
  MemoryScope,
  MemorySelectionReason,
  MemorySourceAvailability,
  MemorySourceRef,
  MemoryViewItem,
} from '@betterwork/agent-protocol';
import { terminalMemoryStatuses } from '@betterwork/agent-protocol';

/**
 * 记忆域的中文文案映射（docs/10 §6.1.3、产品设计 §3.4/§3.5）。
 *
 * 单独成模块的原因：同一套阶段词、来源词与排除理由要同时出现在记忆页、
 * 上下文面板、任务区的经验建议与工作空间简报里，任何一处自行拼装都会
 * 让「已尝试调用模型」这类受约束的措辞在不同界面说法不一致。
 */

/** 分类：四种用户视角映射既有 kind，facet 是用户实际选择的粒度。 */
export const facetLabel: Record<MemoryFacet, string> = {
  goal: '目标',
  constraint: '约束',
  decision: '决策',
  fact: '事实',
  method: '工作方法',
  preference: '表达偏好',
  experience: '历史经验',
};

/** 有效状态由查询派生；删除的措辞是「以后不用」，不是「已消失」。 */
export const effectiveStatusLabel: Record<MemoryEffectiveStatus, string> = {
  candidate: '待确认',
  rejected: '暂不采用',
  confirmed: '已确认',
  superseded: '已被替代',
  expired: '已过期',
  deleted: '以后不用',
};

export const sourceAvailabilityLabel: Record<MemorySourceAvailability, string> = {
  available: '来源可用',
  unavailable: '来源已不可用',
  'review-required': '来源待复核',
};

/**
 * 请求阶段文案（产品设计 §3.5）：只陈述记录到的阶段，
 * 一律不得写成「模型已收到 / 已阅读」，也不得声称因果影响。
 */
export const memoryRunPhaseLabel: Record<MemoryRunPhase, string> = {
  selected: '已选入准备',
  'request-prepared': '已构造成请求上下文',
  'dispatch-attempted': '已尝试调用模型',
  legacy_unknown: '旧版记录，无法确认请求阶段',
};

export const selectionReasonLabel: Record<MemorySelectionReason, string> = {
  'task-relevant': '与本任务内容相关',
  'general-preference': '通用表达偏好',
  'conflict-pair': '共存裁决成对带入',
  'replay-inherited': '由历史轮次继承',
};

export const recallExclusionLabel: Record<MemoryRecallExclusionReason, string> = {
  inactive: '未处于可用状态',
  scope: '适用范围不符',
  'task-excluded': '本任务已排除',
  'source-unavailable': '来源已不可用',
  'source-review-required': '来源待复核',
  'dependency-unavailable': '依赖的资料或记忆不足',
  'conflict-unresolved': '存在待澄清口径',
  'not-relevant': '与本任务不相关',
  budget: '超出本次预算',
};

export const replayBoundaryLabel: Record<MemoryReplayBoundaryReason, string> = {
  'memory-revised': '相关记忆已修订',
  'memory-excluded': '相关记忆本任务不使用',
  'memory-inactive': '相关记忆已停用或过期',
  'source-unavailable': '来源已不可用',
  'material-removed-or-replaced': '材料已移除或换版本',
  'legacy-provenance-unknown': '旧版记录无法确认来源',
  'history-budget': '历史轮次超出预算',
};

export const memoryJobStatusLabel: Record<MemoryJobStatus, string> = {
  queued: '排队中',
  running: '正在提炼',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
  skipped: '已跳过',
};

/** 活动作业：只有这两态需要轮询，其余终态一律停轮询。 */
export const activeMemoryJobStatuses: readonly MemoryJobStatus[] = ['queued', 'running'];

export const isActiveMemoryJob = (status: MemoryJobStatus): boolean =>
  activeMemoryJobStatuses.includes(status);

export const isTerminalMemory = (memory: MemoryViewItem): boolean =>
  terminalMemoryStatuses.includes(memory.status);

export const memoryScopeLabel = (
  scope: MemoryScope,
  workspaceName?: string,
  expertName?: string,
): string => {
  switch (scope.kind) {
    case 'user':
      return '所有工作';
    case 'workspace':
      return `工作空间 · ${workspaceName ?? scope.workspaceId}`;
    case 'expert':
      return `专家通用 · ${expertName ?? scope.expertId}`;
    case 'expert-workspace':
      return `专家与工作空间 · ${expertName ?? scope.expertId} · ${workspaceName ?? scope.workspaceId}`;
  }
};

/** 来源说明：legacy 必须让用户看见「无法证明」，不得静默当作已核实。 */
export const memoryProvenanceLabel = (memory: MemoryViewItem): string => {
  if (memory.provenance.verification === 'legacy-unverified') {
    return '旧版来源，无法确认出处';
  }
  const authority =
    memory.provenance.authority === 'user-instruction' ? '我明确制定的要求' : '由资料或回答提炼';
  const kinds = [...new Set(memory.provenance.sources.map((source) => source.kind))];
  return `${authority} · ${kinds.map(sourceKindLabel).join('、')}`;
};

export const sourceKindLabel = (kind: MemorySourceRef['kind']): string => {
  switch (kind) {
    case 'manual':
      return '人工填写';
    case 'run-user':
      return '我的发言';
    case 'run-assistant':
      return '助手回答';
    case 'checkpoint':
      return '讨论节点';
    case 'artifact-version':
      return '成果版本';
  }
};

const twoDigits = (value: number): string => String(value).padStart(2, '0');

export const formatValidityDate = (value: number): string => {
  const date = new Date(value);
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
};

/** 有效期缺省端点无界；不要把缺省画成「永久」以外的判断。 */
export const formatValidityRange = (
  validFrom: number | undefined,
  validUntil: number | undefined,
): string => {
  if (validFrom === undefined && validUntil === undefined) return '长期有效';
  if (validUntil === undefined && validFrom !== undefined)
    return `${formatValidityDate(validFrom)} 起`;
  if (validFrom === undefined && validUntil !== undefined)
    return `${formatValidityDate(validUntil)} 前`;
  if (validFrom !== undefined && validUntil !== undefined) {
    return `${formatValidityDate(validFrom)} 至 ${formatValidityDate(validUntil)}`;
  }
  return '长期有效';
};

/** 日期输入用 `YYYY-MM-DD`；空串表示「不设置」，与 DatePatch 的 clear 对应。 */
export const toDateInputValue = (value: number | undefined): string =>
  value === undefined ? '' : formatValidityDate(value);

export const fromDateInputValue = (value: string): number | undefined => {
  if (!value.trim()) return undefined;
  const timestamp = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(timestamp) ? undefined : timestamp;
};
