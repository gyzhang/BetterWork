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
  /**
   * 本预设专属的运行约定段落，会被追加到该 Skill 的指令末尾（ADR-0012 决策 4）。
   *
   * 只允许写「这个样本的命令该怎么用」，通用约束（work 目录、expectedHash、bindingId、
   * 不自行声明验证状态）由 `skill-runtime-conventions` 统一持有，不得在此重复。
   * 参数是本次绑定里该 Skill 实际声明的命令 id：用不到的命令不得出现在文案里。
   */
  runtimeConventions?(commandIds: ReadonlySet<string>): string | undefined;
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
