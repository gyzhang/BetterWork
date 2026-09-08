import type { JobResult, JobSpec } from '@betterwork/agent-protocol';

export interface SupervisorCleanup {
  cleanupCompleted: boolean;
}

/**
 * 一次执行的控制句柄。平台实现（A08/A09）各自保证：
 * 结果只 settle 一次，取消幂等，控制通道与 stdout 分离。
 */
export interface SupervisorHandle {
  readonly executionId: string;
  readonly result: Promise<JobResult>;
  cancel(): Promise<SupervisorCleanup>;
}

/**
 * 单次执行的进程 supervisor 契约。实现只管理自己 executionId 对应的实例，
 * 不按进程名全局匹配；父控制通道断开时必须清理目标进程组。
 */
export interface ProcessSupervisor {
  launch(spec: JobSpec): Promise<SupervisorHandle>;
}
