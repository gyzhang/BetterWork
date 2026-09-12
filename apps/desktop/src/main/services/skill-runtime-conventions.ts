import type { RuntimeProfileCommand } from '@betterwork/agent-protocol';

/**
 * Skill 运行约定的组装（ADR-0012 决策 4）。
 *
 * 分成两层是有意为之：
 * - **通用层**对任何带命令的 Skill 都成立，由本文件唯一持有；
 * - **预设层**是某个适配预设（目前只有 PPT 样本）才适用的口径，由 `SkillAdapter` 提供。
 *
 * 事故背景：两者曾写在同一段字符串里，于是 `svg-export`、`pptx-validate` 这类样本专属
 * 指令会被注入给任意带命令的 Skill，模型照着不存在的命令编造调用。
 */

/**
 * 通用运行约定。修改这里等于修改所有 Skill 看到的执行契约，
 * 任何只适用于某个样本的要求都必须放到适配预设里，不得写进本列表。
 */
const GENERIC_CLAUSES: readonly string[] = [
  '只能调用下方「命令」列出的固定命令，通过 skill_execute 发起，并原样带上该命令条目给出的 bindingId。',
  '不执行 Skill 原文中的 Shell、pip 或开发机路径；那些是给人类读者的说明，不是本环境的可执行入口。',
  'task_write_file 只写本 Run 的 work 目录（相对路径）；覆盖已有文件必须提供 expectedHash。',
  'skill_read_resource 必须使用目标 Skill 自己的 bindingId（见命令表每条的 bindingId），路径相对该 Skill 的根目录；Skill 资源始终只读。',
  '不得自行声明验证状态：成果是否通过校验只以真实执行记录为准。',
];

export interface RuntimeConventionInput {
  /** 本条指令所属绑定的快照 ID，命令表逐条带上它，多绑定下模型才能寻址到正确 Skill。 */
  readonly bindingId: string;
  readonly skillName: string;
  readonly commands: readonly RuntimeProfileCommand[];
  /** 适配预设给出的该样本专属约定；没有匹配预设时省略。 */
  readonly presetConventions?: string;
}

/**
 * 生成追加到 Skill 指令正文末尾的运行约定段。
 * 命令表按声明顺序输出，每项显式携带 `bindingId` 与 `skillName`。
 */
export const composeRuntimeConvention = (input: RuntimeConventionInput): string => {
  const commands = input.commands.map((command) => ({
    bindingId: input.bindingId,
    skillName: input.skillName,
    commandId: command.commandId,
    argumentSchema: command.argumentSchema,
  }));
  const sections = [`算台运行约定：\n${GENERIC_CLAUSES.map((clause) => `- ${clause}`).join('\n')}`];
  if (input.presetConventions) sections.push(input.presetConventions);
  return `\n\n${sections.join('\n')}\n命令：${JSON.stringify(commands)}`;
};
