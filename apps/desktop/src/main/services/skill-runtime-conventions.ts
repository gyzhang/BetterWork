import type { RuntimeProfileCommand } from '@betterwork/agent-protocol';

/**
 * Skill 运行约定的组装（ADR-0012 决策 4）。
 *
 * 通用运行边界由本文件持有；命令用法、产物类型和验证结果则来自 Skill 包自己的声明。
 */

/**
 * 修改这里等于修改所有 Skill 看到的执行契约；命令特有说明不得写进本列表。
 */
const GENERIC_CLAUSES: readonly string[] = [
  '只能调用下方「命令」列出的固定命令，通过 skill_execute 发起，并原样带上该命令条目给出的 bindingId。',
  '不执行 Skill 原文中的 Shell、pip 或开发机路径；那些是给人类读者的说明，不是本环境的可执行入口。',
  'task_write_file 只写本 Run 的 work 目录（相对路径）；覆盖已有文件必须提供 expectedHash。',
  'read_text_file 可读取本 Run 已选的输入材料，也可读取本 Run work 目录内的工作文件；其他工作空间文件必须先选为输入材料。',
  'skill_read_resource 必须使用目标 Skill 自己的 bindingId（见命令表每条的 bindingId），路径相对该 Skill 的根目录；Skill 资源始终只读。',
  '命令表 outputs 中的 pathKey 是包内路径标识；工具返回的 outputIds 才是成果登记句柄。跨命令读取生成文件时，按 source 声明和本次返回的 executionId 在本 Run work 下定位。',
  '只能按命令输出契约报告已声明的验证状态；命令未成功结束时不得发布输出，未声明或未执行的检查不得标为通过。',
];

export interface RuntimeConventionInput {
  /** 本条指令所属绑定的快照 ID，命令表逐条带上它，多绑定下模型才能寻址到正确 Skill。 */
  readonly bindingId: string;
  readonly skillName: string;
  readonly commands: readonly RuntimeProfileCommand[];
}

/**
 * 生成单独优先注入的运行约定段；不能追加到可能被截断的 Skill 正文之后。
 * 命令表按声明顺序输出，每项显式携带 `bindingId` 与 `skillName`。
 */
export const composeRuntimeConvention = (input: RuntimeConventionInput): string => {
  const commands = input.commands.map((command) => ({
    bindingId: input.bindingId,
    skillName: input.skillName,
    commandId: command.commandId,
    argumentSchema: command.argumentSchema,
    ...(command.execution?.outputs.length
      ? {
          outputs: command.execution.outputs.map((output) => ({
            pathKey: output.outputId,
            source: output.source,
            extension: output.extension,
            mimeType: output.mimeType,
            validation: output.validation,
          })),
        }
      : {}),
    ...(command.runtimeInstruction ? { runtimeInstruction: command.runtimeInstruction } : {}),
  }));
  const sections = [`算台运行约定：\n${GENERIC_CLAUSES.map((clause) => `- ${clause}`).join('\n')}`];
  return `\n\n${sections.join('\n')}\n命令：${JSON.stringify(commands)}`;
};
