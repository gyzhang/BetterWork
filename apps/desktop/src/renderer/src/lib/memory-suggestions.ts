import type {
  MemoryJobSummary,
  MemoryViewItem,
  WorkspaceMemorySettings,
} from '@betterwork/agent-protocol';
import { MEMORY_EXTRACTION_MAX_CANDIDATES } from '@betterwork/agent-protocol';

import { memoryJobStatusLabel } from './memory-labels';

/**
 * 自动建议（经验建议）的纯派生逻辑（产品设计 §3.3、WM11）。
 *
 * 只放无状态派生：同意文案、作业结果措辞、候选归属哪个任务。
 * 带状态与 IPC 的部分都在 `hooks/use-memory-suggestions.ts`。
 * 阶段词、状态词等共享词汇一律取自 `memory-labels.ts`，这里不另立一套。
 */

/** §3.3：协议未导出「当前同意版本」常量，界面侧与文案同处定义，避免散落两处。 */
export const MEMORY_CONSENT_VERSION = 1;

export const memoryConsentVersionLabel = `同意版本 v${MEMORY_CONSENT_VERSION}`;

/** 开启前必须原样展示的代价与隐私说明。 */
export const memoryConsentNotice =
  '开启后，算台会在「一次运行成功结束」或「你提交带反馈的讨论节点」时，把该次工作的最小必要片段发给当前已选模型提炼，可能产生费用；远程模型会接收这些片段。不会扫描历史任务、不会读取未选资料，也不会自动确认任何记忆。';

export const memoryConsentOffNotice =
  '关闭后只停止此后的自动提炼，并取消本空间未完成的作业；已确认的记忆与历史候选都不受影响。';

/** 同意对话框正文：代价、隐私与同意版本一次说清（§3.3）。 */
export const memoryConsentDialogNotice = (enabled: boolean): string =>
  enabled
    ? `${memoryConsentNotice} 记录同意版本 ${memoryConsentVersionLabel}。`
    : memoryConsentOffNotice;

/** 开关下方常驻的一行状态说明；长文案只在对话框里出现一次。 */
export const consentStateNotice = (settings: WorkspaceMemorySettings | undefined): string =>
  settings?.autoSuggestEnabled === true
    ? `已开启：只处理此后完成的工作，不回填旧任务；每次运行最多 ${MEMORY_CANDIDATE_PER_JOB_LIMIT} 条，全部需要你确认。${memoryConsentVersionLabel}。`
    : '未开启：不会向模型发送任何提炼请求。开启前会再次说明代价与同意版本。';

/**
 * 「0 条」是成功结果，与失败必须分开说：把「没有建议」显示成失败，
 * 用户就会以为开关或模型坏了（§3.3、WM11）。
 */
export const jobOutcomeLabel = (job: MemoryJobSummary): string => {
  switch (job.status) {
    case 'succeeded':
      return job.candidateCount === 0
        ? '已完成，这次没有值得长期保留的经验'
        : `已完成，新增 ${job.candidateCount} 条建议`;
    case 'queued':
      return '排队等待提炼';
    case 'running':
      return '正在提炼';
    case 'failed':
      return `提炼失败：${job.diagnostic ?? job.errorCode ?? memoryJobStatusLabel.failed}`;
    case 'cancelled':
      return '已取消，未产生建议';
    case 'interrupted':
      return '上次退出时中断，未自动重发';
    case 'skipped':
      return '已跳过，未产生建议';
  }
};

/** 只有失败与中断提供「重新提炼」；取消与成功不重试（§3.3 单次授权）。 */
export const canRetryJob = (job: MemoryJobSummary): boolean =>
  job.status === 'failed' || job.status === 'interrupted';

/** 一次提炼作业的候选上限（契约 §8.4）。 */
export const MEMORY_CANDIDATE_PER_JOB_LIMIT = MEMORY_EXTRACTION_MAX_CANDIDATES;

/** 批次结论：取最近更新的作业；一次作业都没有时说明开启后会发生什么。 */
export const latestJobLabel = (jobs: MemoryJobSummary[]): string => {
  const latest = [...jobs].sort((left, right) => right.updatedAt - left.updatedAt)[0];
  return latest === undefined
    ? `还没有提炼作业。开启后每次运行最多产生 ${MEMORY_CANDIDATE_PER_JOB_LIMIT} 条建议。`
    : jobOutcomeLabel(latest);
};

/**
 * 候选属于哪个任务：候选 DTO 不带 taskId，只能经作业的来源键回推
 * （`run` → runId、`checkpoint` → checkpointId）。推不出来时不归入任何任务，
 * 只在记忆页集中展示——不凭内容相似度猜，也不跨空间借用。
 */
export function candidatesOfTask(
  candidates: MemoryViewItem[],
  jobs: MemoryJobSummary[],
  taskId: string,
): MemoryViewItem[] {
  const runIds = new Set<string>();
  const checkpointIds = new Set<string>();
  for (const job of jobs) {
    if (job.taskId !== taskId) continue;
    if (job.source.kind === 'run') runIds.add(job.source.runId);
    else checkpointIds.add(job.source.checkpointId);
  }
  if (runIds.size === 0 && checkpointIds.size === 0) return [];
  return candidates.filter((candidate) => {
    if (candidate.provenance.verification !== 'verified') return false;
    return candidate.provenance.sources.some((source) => {
      if (source.kind === 'run-user' || source.kind === 'run-assistant') {
        return runIds.has(source.runId);
      }
      if (source.kind === 'checkpoint') return checkpointIds.has(source.checkpointId);
      return false;
    });
  });
}
