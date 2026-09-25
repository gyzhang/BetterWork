import type {
  MemoryJobSummary,
  MemorySourceRef,
  MemoryViewItem,
  WorkspaceMemorySettings,
} from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import {
  candidatesOfTask,
  canRetryJob,
  consentStateNotice,
  jobOutcomeLabel,
  latestJobLabel,
  MEMORY_CONSENT_VERSION,
  memoryConsentDialogNotice,
} from './memory-suggestions';

/**
 * 自动建议的纯派生（WM11）。
 *
 * 这里守住三条容易被写歪的口径：「0 条建议」是成功结果不是失败；
 * 只有失败/中断才给重试入口；候选归到哪个任务只按来源键回推，不猜相似度。
 */

const HASH = 'a'.repeat(64);

const job = (overrides: Partial<MemoryJobSummary>): MemoryJobSummary => ({
  id: 'job-1',
  workspaceId: 'workspace-1',
  taskId: 'task-1',
  source: { kind: 'run', runId: 'run-1' },
  status: 'succeeded',
  revision: 1,
  attempt: 1,
  trigger: 'automatic',
  candidateCount: 1,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const candidate = (sources: MemorySourceRef[]): MemoryViewItem => ({
  id: 'memory-1',
  revisionId: 'memory-1-r1',
  revision: 1,
  recallPolicy: 'relevant',
  scope: { kind: 'workspace', workspaceId: 'workspace-1' },
  kind: 'procedural',
  content: '经营分析先核对回款金额口径。',
  sourceType: 'conversation',
  confidence: 0.8,
  status: 'candidate',
  contentHash: HASH,
  createdAt: 1,
  updatedAt: 1,
  facet: 'method',
  normalizedHash: HASH,
  provenance: {
    schemaVersion: 1,
    verification: 'verified',
    authority: 'derived',
    capturedAt: 1,
    sources,
    materialDependencies: [],
    memoryDependencies: [],
  },
  candidateDisposition: 'pending',
  effectiveStatus: 'candidate',
  sourceAvailability: 'available',
  requiresMaterialSelection: false,
  conflicts: [],
});

const runSource = (runId: string) => ({
  kind: 'run-assistant' as const,
  runId,
  eventId: `event-${runId}`,
  contentHash: HASH,
  start: 0,
  end: 9,
  excerpt: '先核对回款金额口径。',
  excerptHash: HASH,
});

describe('jobOutcomeLabel', () => {
  it('把「这次没有建议」说成成功结果，不写成失败', () => {
    expect(jobOutcomeLabel(job({ candidateCount: 0 }))).toBe('已完成，这次没有值得长期保留的经验');
    expect(jobOutcomeLabel(job({ candidateCount: 2 }))).toBe('已完成，新增 2 条建议');
  });

  it('失败优先展示摘要，缺摘要才退回错误码', () => {
    expect(jobOutcomeLabel(job({ status: 'failed', diagnostic: '输入超出预算' }))).toBe(
      '提炼失败：输入超出预算',
    );
    expect(
      jobOutcomeLabel(job({ status: 'failed', diagnostic: undefined, errorCode: 'TIMEOUT' })),
    ).toBe('提炼失败：TIMEOUT');
  });
});

describe('canRetryJob', () => {
  it('只在失败与中断上给重新提炼入口', () => {
    expect(canRetryJob(job({ status: 'failed' }))).toBe(true);
    expect(canRetryJob(job({ status: 'interrupted' }))).toBe(true);
    expect(canRetryJob(job({ status: 'queued' }))).toBe(false);
    expect(canRetryJob(job({ status: 'running' }))).toBe(false);
    expect(canRetryJob(job({ status: 'cancelled' }))).toBe(false);
    expect(canRetryJob(job({ status: 'succeeded' }))).toBe(false);
  });
});

describe('latestJobLabel', () => {
  it('没有作业时说明开启后会发生什么，而不是空字符串', () => {
    expect(latestJobLabel([])).toContain('还没有提炼作业');
  });

  it('按最近更新的作业给结论', () => {
    expect(
      latestJobLabel([
        job({ id: 'job-old', updatedAt: 1, candidateCount: 0 }),
        job({ id: 'job-new', updatedAt: 9, candidateCount: 3 }),
      ]),
    ).toBe('已完成，新增 3 条建议');
  });
});

describe('consentStateNotice', () => {
  const settings = (enabled: boolean): WorkspaceMemorySettings => ({
    workspaceId: 'workspace-1',
    revision: 1,
    autoSuggestEnabled: enabled,
    updatedAt: 1,
  });

  it('未开启时明确说明不会向模型发送任何提炼请求', () => {
    expect(consentStateNotice(settings(false))).toContain('不会向模型发送任何提炼请求');
    expect(consentStateNotice(undefined)).toContain('不会向模型发送任何提炼请求');
  });

  it('开启时说明不回填旧任务、每次上限与同意版本', () => {
    expect(consentStateNotice(settings(true))).toContain('不回填旧任务');
    expect(consentStateNotice(settings(true))).toContain(`同意版本 v${MEMORY_CONSENT_VERSION}`);
  });
});

describe('memoryConsentDialogNotice', () => {
  it('开启前一次说清代价、远程模型与同意版本', () => {
    const notice = memoryConsentDialogNotice(true);
    expect(notice).toContain('可能产生费用');
    expect(notice).toContain('远程模型会接收这些片段');
    expect(notice).toContain(`确认即记录为同意版本 v${MEMORY_CONSENT_VERSION}`);
    expect(notice).not.toContain('同意版本 同意版本');
  });

  it('关闭时只说明保留已确认记忆，不重复开启文案', () => {
    const notice = memoryConsentDialogNotice(false);
    expect(notice).toContain('已确认的记忆与历史候选都不受影响');
    expect(notice).not.toContain('可能产生费用');
  });
});

describe('candidatesOfTask', () => {
  it('按作业来源键回推归属，不跨任务借用', () => {
    const jobs = [job({ taskId: 'task-1', source: { kind: 'run', runId: 'run-1' } })];
    expect(candidatesOfTask([candidate([runSource('run-1')])], jobs, 'task-1')).toHaveLength(1);
    expect(candidatesOfTask([candidate([runSource('run-2')])], jobs, 'task-1')).toHaveLength(0);
  });

  it('讨论节点的候选只归到产生它的那个任务', () => {
    const jobs = [job({ taskId: 'task-2', source: { kind: 'checkpoint', checkpointId: 'cp-1' } })];
    const withCheckpoint = candidate([
      {
        kind: 'checkpoint',
        checkpointId: 'cp-1',
        field: 'feedback',
        contentHash: HASH,
        start: 0,
        end: 9,
        excerpt: '先核对回款金额口径。',
        excerptHash: HASH,
      },
    ]);
    expect(candidatesOfTask([withCheckpoint], jobs, 'task-2')).toHaveLength(1);
    expect(candidatesOfTask([withCheckpoint], jobs, 'task-1')).toHaveLength(0);
  });

  it('这个任务没有任何作业时不归入候选，避免凭内容猜', () => {
    expect(candidatesOfTask([candidate([runSource('run-1')])], [], 'task-1')).toEqual([]);
  });
});
