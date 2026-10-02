/** Qoder 官方 frontmatter 的仓内写法：trigger 标量，glob 使用带引号的 YAML 列表。 */
export interface QoderRuleMetadata {
  trigger: string;
  globs: string[];
  issues: string[];
}

export function readQoderRuleMetadata(source: string): QoderRuleMetadata {
  const header = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(source)?.[1];
  if (header === undefined) return { trigger: '', globs: [], issues: ['缺少 frontmatter'] };
  const trigger = (/^trigger:[ \t]*(.*)$/mu.exec(header)?.[1] ?? '').trim();
  const description = (/^description:[ \t]*(.*)$/mu.exec(header)?.[1] ?? '').trim();
  const globBlock = /^glob:\n((?: {2}- '[^'\n]+'(?:\n|$))+)/mu.exec(`${header}\n`)?.[1] ?? '';
  const globs = [...globBlock.matchAll(/^ {2}- '([^'\n]+)'$/gmu)].map((match) => match[1] ?? '');
  const issues: string[] = [];
  if (!['always_on', 'model_decision', 'glob'].includes(trigger))
    issues.push(`无法识别 trigger：${trigger}`);
  if (trigger === 'model_decision' && description.length < 10)
    issues.push('model_decision 缺少可选路的 description');
  if (trigger === 'glob' && globs.length === 0) issues.push('glob 触发必须有独立的 glob 列表');
  if (globs.some((glob) => glob.includes(',')))
    issues.push('多个扩展名必须分别登记为 glob，不能拼成逗号后缀');
  return { trigger, globs, issues };
}
