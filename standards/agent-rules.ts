/** Qoder IDE 实际保存的 frontmatter：trigger 标量，glob 是完整模式的逗号分隔字符串。 */
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
  const globLine = (/^glob:[ \t]*([^\n]+)$/mu.exec(header)?.[1] ?? '').trim();
  const globs = globLine.length === 0 ? [] : globLine.split(',').map((glob) => glob.trim());
  const issues: string[] = [];
  if (!['always_on', 'model_decision', 'glob'].includes(trigger))
    issues.push(`无法识别 trigger：${trigger}`);
  if (trigger === 'model_decision' && description.length < 10)
    issues.push('model_decision 缺少可选路的 description');
  if (trigger === 'glob' && globs.length === 0)
    issues.push('glob 触发必须有 IDE 可识别的 glob 字符串，不能使用 YAML 列表');
  if (globs.some((glob) => glob.length === 0 || !/[.*/]/u.test(glob)))
    issues.push('逗号分隔的每项必须是完整文件模式，不能为空或只写扩展名后缀');
  return { trigger, globs, issues };
}
