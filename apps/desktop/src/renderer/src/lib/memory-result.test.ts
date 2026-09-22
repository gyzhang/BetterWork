import type { MemoryError, Result } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import { IPC_FAILURE_CODE, settleMemoryCall, settleMemoryResult } from './memory-result';

/**
 * `Result` 的界面侧收口（契约 §9.3，WM07）。
 *
 * 分界线只有一条：领域失败带着错误码回来，界面按码分支；transport 失败没有码，
 * 一律收成可重试的 `IPC_FAILURE`，绝不去解析 Electron 的异常字符串猜业务码。
 */

const revisionConflict: MemoryError = {
  code: 'REVISION_CONFLICT',
  message: '这条记忆已经被改过了，请基于最新修订重新提交。',
  retryable: false,
  currentRevision: 4,
};

describe('记忆 Result 的界面侧收口', () => {
  it('把 transport 拒绝统一映射成 IPC_FAILURE 并标为可重试', async () => {
    const rejected = Promise.reject(
      new Error('Error invoking remote method memory:list: No handler registered'),
    );
    const outcome = await settleMemoryCall(rejected, '读取记忆失败。');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // 原始消息只作为可操作提示透出，错误码不随异常文本变化。
    expect(outcome.code).toBe(IPC_FAILURE_CODE);
    expect(outcome.retryable).toBe(true);
    expect(outcome.currentRevision).toBeUndefined();
    expect(outcome.message).toContain('memory:list');
  });

  it('拒绝里没有可用消息时回落到调用方给的文案', async () => {
    // IPC 层可能抛出没有 message 的 Error；此时只能显示调用方预置的可操作文案。
    const outcome = await settleMemoryCall(Promise.reject(new Error()), '读取记忆失败。');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe(IPC_FAILURE_CODE);
    expect(outcome.message).toBe('读取记忆失败。');
  });

  it('领域失败原样透出错误码与冲突修订，不降级成 IPC_FAILURE', async () => {
    const outcome = await settleMemoryCall(
      Promise.resolve<Result<null>>({ ok: false, error: revisionConflict }),
      '保存失败。',
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('REVISION_CONFLICT');
    expect(outcome.retryable).toBe(false);
    expect(outcome.currentRevision).toBe(4);
  });

  it('成功把 warnings 原样带回：投影失败是已提交成功＋警告', () => {
    const outcome = settleMemoryResult({
      ok: true,
      data: { id: 'memory-1' },
      warnings: [{ code: 'PROJECTION_PENDING', message: '文件投影待重建。' }],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data).toEqual({ id: 'memory-1' });
    expect(outcome.warnings).toEqual([{ code: 'PROJECTION_PENDING', message: '文件投影待重建。' }]);
  });
});
