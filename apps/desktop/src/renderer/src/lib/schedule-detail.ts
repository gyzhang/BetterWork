import type {
  ArtifactType,
  ScheduleOccurrenceHistoryItem,
  ScheduleOccurrenceTrigger,
  ScheduleOccurrenceViewState,
  ScheduleOutputReceiptStatus,
  ScheduleSourceOrigin,
} from '@betterwork/agent-protocol';

import { occurrenceResultLabel } from './schedules';

const triggerLabels: Record<ScheduleOccurrenceTrigger, string> = {
  scheduled: '按计划执行',
  'manual-now': '人工立即执行',
  'manual-missed': '人工补做错过期',
};

const receiptLabels: Record<ScheduleOutputReceiptStatus, string> = {
  pending: '等待保存',
  saving: '正在保存',
  saved: '已保存到工作空间',
  failed: '未保存到工作空间',
};

const sourceOriginLabels: Record<ScheduleSourceOrigin, string> = {
  'workspace-directory': '工作空间目录',
  'selected-document': '指定文档',
  'selected-collection': '指定集合',
  'selected-vault': '整个资料库',
  'expert-reference': '专家固定参考',
};

const artifactTypeLabels: Record<ArtifactType, string> = {
  markdown: 'Markdown 报告',
  presentation: '演示文稿（PPTX）',
};

const snapshotStatusLabels: Record<'preparing' | 'ready' | 'failed' | 'cancelled', string> = {
  preparing: '准备中',
  ready: '已就绪',
  failed: '准备失败',
  cancelled: '已取消',
};

export const scheduleOccurrenceTriggerLabel = (trigger: ScheduleOccurrenceTrigger): string =>
  triggerLabels[trigger];

export const scheduleOutputReceiptLabel = (status: ScheduleOutputReceiptStatus): string =>
  receiptLabels[status];

export const scheduleSourceOriginLabel = (origin: ScheduleSourceOrigin): string =>
  sourceOriginLabels[origin];

export const scheduleArtifactTypeLabel = (type: ArtifactType): string => artifactTypeLabels[type];

export const scheduleSourceSnapshotStatusLabel = (
  status: 'preparing' | 'ready' | 'failed' | 'cancelled',
): string => snapshotStatusLabels[status];

export const scheduleOccurrenceHistoryLabel = (item: ScheduleOccurrenceHistoryItem): string => {
  const period = item.occurrence.period.label;
  const trigger = scheduleOccurrenceTriggerLabel(item.occurrence.trigger);
  if (item.occurrence.trigger === 'manual-missed' && item.occurrence.originalOccurrenceId) {
    return `${trigger} · ${period}`;
  }
  return `${period} · ${trigger}`;
};

export const scheduleOccurrenceNoRunMessage = (item: ScheduleOccurrenceHistoryItem): string => {
  if (item.run) return '';
  if (item.result.status === 'missed') {
    return '错过时没有创建 Task 或 Run；不会自动补跑，可选择人工补做原期间。';
  }
  if (item.result.status === 'needs-material') {
    return item.occurrence.taskId
      ? '本期已保留原 Task，但尚未启动 Run；打开 Task 补充材料后继续。'
      : '本期尚未启动 Run；请回到规则详情处理所需材料。';
  }
  if (item.result.status === 'blocked')
    return '启动前检查未通过，没有创建 Run；可检查规则与能力配置。';
  if (item.result.status === 'skipped-overlap')
    return '上一期仍占用执行窗口，本期没有创建 Task 或 Run。';
  if (item.result.status === 'cancelled') return '准备阶段已取消，没有创建 Run。';
  if (item.result.status === 'interrupted') return '应用退出时尚未创建 Run；本期不会自动重放。';
  return `${occurrenceResultLabel(item.result.status)}；本期没有首个 Run。`;
};

export const scheduleOccurrenceNextStep = (
  status: ScheduleOccurrenceViewState,
  hasTask: boolean,
  hasReceipt: boolean,
): string => {
  if (status === 'missed') return '可人工补做这次错过的期间；计划不会自动补跑。';
  if (status === 'blocked') return '检查并调整规则或能力配置后，再由用户明确启用或执行。';
  if (status === 'needs-material')
    return hasTask ? '打开原 Task 补充材料并继续协作。' : '调整知识范围或规则配置。';
  if (status === 'save-failed')
    return hasReceipt
      ? '内部成果版本仍保留；可单独重试目录保存。'
      : '先打开原 Task 查看已登记成果。';
  if (status === 'no-target-artifact')
    return hasTask ? '打开原 Task 检查回复和已生成的部分成果。' : '查看本期结果和缺项原因。';
  if (status === 'failed')
    return hasTask ? '打开原 Task 查看失败原因；已有成果仍保留。' : '查看启动失败原因并调整规则。';
  if (status === 'interrupted')
    return hasTask
      ? '打开原 Task 查看中断前的过程与成果。'
      : '本期不会自动重放；可人工检查后决定下一步。';
  if (status === 'cancelled')
    return hasTask
      ? '打开原 Task 查看已保留的过程与部分成果。'
      : '本次已停止；后续计划仍按规则进行。';
  if (status === 'generated') return '审阅本期成果；完成生成不代表业务结果已验证。';
  if (status === 'running' || status === 'preparing')
    return '本期尚在后台处理；结束后从历史记录查看结果。';
  return '查看本期历史事实；下一次仍按规则计划执行。';
};

export const mergeScheduleOccurrenceHistory = (
  current: readonly ScheduleOccurrenceHistoryItem[],
  incoming: readonly ScheduleOccurrenceHistoryItem[],
): ScheduleOccurrenceHistoryItem[] => {
  const byId = new Map(current.map((item) => [item.occurrence.id, item]));
  for (const item of incoming) byId.set(item.occurrence.id, item);
  return [...byId.values()].sort((left, right) => {
    const byDate = right.occurrence.createdAt - left.occurrence.createdAt;
    return byDate || right.occurrence.id.localeCompare(left.occurrence.id);
  });
};
