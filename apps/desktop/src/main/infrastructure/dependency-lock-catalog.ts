import path from 'node:path';

import { type DependencyLock, dependencyLockSchema } from '@betterwork/agent-protocol';

import type { DependencyFileSystem } from './dependency-adapters';

/**
 * 随包依赖锁目录（设计 §4.2、任务 A11）。
 *
 * 锁文件是**描述**（精确版本 + 每个 wheel 的 sha256 + 已批准来源 + 许可），不是制品本身：
 * wheel 不进入仓库，随包分发由 A20 处理。锁一律过 Zod 校验后才交给准备作业，
 * 因此手工改坏的锁在加载时就被拒绝，不会带着错误 hash 去装包。
 */

/** 首个样本在 macOS arm64 / CPython 3.12 上的实测闭包。 */
export const pptGenerationLockId = 'ppt-generation-expert-darwin-arm64-cp312';

const lockIdPattern = /^[a-z0-9][a-z0-9-]{0,120}$/u;

export class DependencyLockError extends Error {
  constructor(
    readonly code: 'invalid-lock-id' | 'lock-missing' | 'lock-invalid',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DependencyLockError';
  }
}

const assertLockId = (lockId: string): void => {
  // 锁 ID 会拼进文件路径，因此只接受受控字符集，杜绝 `../` 借道读取。
  if (!lockIdPattern.test(lockId)) {
    throw new DependencyLockError('invalid-lock-id', `非法的依赖锁标识 ${lockId}`);
  }
};

export const listDependencyLocks = async (
  locksRoot: string,
  filesystem: DependencyFileSystem,
): Promise<string[]> => {
  const entries = await filesystem.readdir(locksRoot).catch(() => [] as string[]);
  return entries
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .filter((lockId) => lockIdPattern.test(lockId))
    .sort();
};

export const loadDependencyLock = async (
  locksRoot: string,
  lockId: string,
  filesystem: DependencyFileSystem,
): Promise<DependencyLock> => {
  assertLockId(lockId);
  const file = path.join(locksRoot, `${lockId}.json`);
  const bytes = await filesystem.readFile(file).catch((error: unknown) => {
    throw new DependencyLockError('lock-missing', `找不到依赖锁 ${lockId}`, { cause: error });
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    throw new DependencyLockError('lock-invalid', `依赖锁 ${lockId} 不是合法 JSON`, {
      cause: error,
    });
  }
  const result = dependencyLockSchema.safeParse(parsed);
  if (!result.success) {
    throw new DependencyLockError(
      'lock-invalid',
      `依赖锁 ${lockId} 不符合协议：${result.error.issues.map((issue) => issue.message).join('；')}`,
    );
  }
  return result.data;
};
