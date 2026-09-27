/**
 * 布尔设置的唯一开关：一个 `role="switch"` 按钮，文字与滑块同属一个控件。
 *
 * 全站 13 处 `type="checkbox"` 里只有 4 处真的是「开／关」，其余是**多选与全选**——
 * 那种语义必须留在原生勾选框里，不能为了观感统一塞进开关（审计 §6 Switch 行的结论）。
 * 这 4 处此前的写法各不相同：知识页用原生 checkbox（类名却已经叫 `.knowledge-admin-switch`）、
 * 记忆建议行用「按钮文案翻转」充当开关（开启自动建议／关闭自动建议）、
 * 设置与技能页各用一个文本按钮。文案翻转的问题是**读屏听到的名称随状态变化**，
 * 用户无法用同一个名称找到同一个开关。
 *
 * 这里把「轨道＋滑块＋文字」收成一个按钮：名称恒定，状态走 `aria-checked`，
 * 键盘行为是按钮自带的（Space／Enter 切换），不需要额外监听。
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** 开关的名称：不随状态变化，状态由 `aria-checked` 表达。 */
  label: string;
  disabled?: boolean | undefined;
  /** 开关下方那句「为什么现在不能开」之类的说明；给了就走 `aria-describedby`。 */
  hint?: { id: string } | undefined;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      {...(hint ? { 'aria-describedby': hint.id } : {})}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{label}</span>
    </button>
  );
}
