import { describeError } from '@betterwork/agent-core';
import {
  type MemoryError,
  type MemoryErrorCode,
  memoryErrorSchema,
  type Result,
  type WorkspaceBrief,
  type WorkspaceMemoryBriefRequest,
  workspaceMemoryBriefRequestSchema,
} from '@betterwork/agent-protocol';
import { ZodError } from 'zod';

import type { AppStore } from '../persistence';
import { createStoreBriefReader } from './workspace-brief-reader';
import { type BriefReader, buildWorkspaceBrief } from './workspace-brief-service';

/**
 * 工作空间简报（契约 §10，通道 workspace:memory-brief）。
 *
 * 只读视图：不写库、不调用模型、不缓存正文——每次查询都在一个事务快照里从既有事实重算，
 * 因此删掉重算结果不变，任何缓存都只是可丢弃的加速层。
 * 领域失败一律走 `Result`：空间不存在是 NOT_FOUND，读取异常按可重试的 STORAGE_ERROR 回答，
 * 绝不返回上一次的简报冒充当前状态。输入不符合协议时仍由 IPC 注册 helper 拒绝（§9.3），
 * 所以只有「输出违反自身契约」这种内部故障会留在结果里，映射为 INTERNAL_ERROR。
 */

interface DomainFailure {
  ok: false;
  error: MemoryError;
}

const okResult = <TData>(data: TData): Result<TData> => ({ ok: true, data, warnings: [] });

/** 简报是查询：警告恒为空，截断信息由各区自带的 total/truncated 承载（§10）。 */
const failResult = (code: MemoryErrorCode, message: string, retryable = false): DomainFailure => ({
  ok: false,
  error: memoryErrorSchema.parse({ code, message, retryable }),
});

export class WorkspaceBriefService {
  private readonly reader: BriefReader;
  private readonly clock: () => number;

  constructor(
    private readonly deps: { store: AppStore; reader?: BriefReader; now?: () => number },
  ) {
    this.reader = deps.reader ?? createStoreBriefReader(deps.store);
    this.clock = deps.now ?? (() => Date.now());
  }

  async get(input: WorkspaceMemoryBriefRequest): Promise<Result<WorkspaceBrief>> {
    const request = workspaceMemoryBriefRequestSchema.parse(input);
    if (!this.deps.store.workspaces.get(request.workspaceId)) {
      return failResult('NOT_FOUND', '工作空间不存在或已被移除，请重新选择后重试。');
    }
    const at = this.clock();
    try {
      // 事务包裹读取：确认区、开放节点、参考区必须来自同一次提交状态，
      // 否则同一份简报里会混进两个时间点的事实。
      const brief = this.deps.store.transaction(() =>
        buildWorkspaceBrief(request.workspaceId, this.reader, {
          now: at,
          ...(request.expertId === undefined ? {} : { expertId: request.expertId }),
        }),
      );
      return okResult(brief);
    } catch (error) {
      if (error instanceof ZodError) {
        return failResult('INTERNAL_ERROR', '简报内容与契约不符，请在记忆页重建投影后重试。');
      }
      console.error('[workspace-brief] 简报查询失败', describeError(error));
      return failResult('STORAGE_ERROR', '简报查询失败，请稍后重试。', true);
    }
  }
}
