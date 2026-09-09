import type { SkillCommandExecuteOutput } from '@betterwork/tool-runtime';

/**
 * 命令适配层（设计 §9）。
 *
 * 通用接口：按 Skill 内容 hash 匹配已验证的适配预设，把抽象 commandId
 * 解析为可执行的 executable / argv / env。未识别的 hash 不冒充已兼容。
 */

export interface AdapterContext {
  readonly skillScriptsRoot: string;
  readonly toolchainSnapshotRoot?: string;
  readonly pptmHome?: string;
  readonly managedPythonPath: string;
  readonly runWorkDir: string;
}

export interface ResolvedCommand {
  readonly executable: string;
  readonly argv: string[];
  readonly env: Record<string, string>;
  readonly cwd: string;
}

export interface SkillAdapter {
  readonly name: string;
  isCompatible(contentHash: string): boolean;
  resolveCommand(
    commandId: string,
    args: Record<string, unknown>,
    context: AdapterContext,
  ): ResolvedCommand | undefined;
  interpretOutput?(
    commandId: string,
    raw: AwaitedExecutionSnapshot,
  ): SkillCommandExecuteOutput | undefined;
}

export interface AwaitedExecutionSnapshot {
  readonly executionId: string;
  readonly status: string;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SkillAdapterFactory {
  create(supportedContentHashes: readonly string[]): SkillAdapter;
}

export class SkillAdapterService {
  private readonly adapters: SkillAdapter[] = [];

  register(factory: SkillAdapterFactory, contentHashes: readonly string[]): void {
    this.adapters.push(factory.create(contentHashes));
  }

  findAdapter(contentHash: string): SkillAdapter | undefined {
    return this.adapters.find((adapter) => adapter.isCompatible(contentHash));
  }
}
