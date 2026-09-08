import type { JobResult, JobSpec } from '@betterwork/agent-protocol';

export interface SupervisorCleanup {
  cleanupCompleted: boolean;
}

/**
 * 本次执行捕获到的输出快照。
 *
 * 总量不超过 `JobSpec.maxOutputBytes`：这是可以交给模型的长度上限；超出部分只进
 * 执行日志（上限 `maxLogBytes`），日志再超出就被丢弃并计数。`truncated` 为 true
 * 表示这两个上限中至少有一个被触达，调用方不能把快照当作完整输出使用。
 */
export interface SupervisorCapture {
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly receivedBytes: number;
  readonly droppedBytes: number;
}

/**
 * 一次执行的控制句柄。平台实现（A08 macOS、A09 Windows）各自保证：
 * 结果只 settle 一次，取消幂等，控制通道与 stdout 分离。
 */
export interface SupervisorHandle {
  readonly executionId: string;
  readonly result: Promise<JobResult>;
  /** 输出快照；在 `result` settle 之后即为完整值。 */
  capture(): SupervisorCapture;
  cancel(): Promise<SupervisorCleanup>;
}

/**
 * 单次执行的进程 supervisor 契约。实现只管理自己 executionId 对应的实例，
 * 不按进程名全局匹配；父控制通道断开时必须清理目标进程组。
 */
export interface ProcessSupervisor {
  launch(spec: JobSpec): Promise<SupervisorHandle>;
}
