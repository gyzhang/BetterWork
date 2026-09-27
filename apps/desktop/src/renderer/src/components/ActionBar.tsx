import type { ReactNode } from 'react';

export interface ActionBarProps {
  /** 这排在提交什么：读屏进到动作条时先听到名称，再逐个听按钮。 */
  label: string;
  /** 左侧说明——后果、计数、「保存后会创建 v3」这类话归这里，不另起一行。 */
  hint?: ReactNode | undefined;
  /** 按视觉顺序给出：次要动作在左，主行动固定在最右。 */
  children: ReactNode;
  /** 表单与抽屉的底部用 `footer`（默认）；页面里就地的动作条用 `div`。 */
  as?: 'footer' | 'div' | undefined;
  /** 承载位置自己的钩子（如抽屉底部那道 `padding-top`），不承载排布。 */
  className?: string | undefined;
}

/**
 * 底部动作条的唯一结构：说明在左、按钮在右，主行动永远在最右。
 *
 * 同一排「主按钮＋取消」此前 8 处各写一遍：`gap` 有 8 与 12 两档、`justify-content`
 * 有 flex-end 与 space-between 两种、容器在 `<footer>` 与 `<div>` 之间摇摆，
 * 更要紧的是**取消键一处在最前、一处在最后**——同一产品在两个页面上给出相反的
 * 按钮顺序（docs/reviews/2026-09-27-ui-reuse-audit.md §3.1 P2）。
 * 全仓生产代码里 `role="group"`＋`aria-label` 一处都没有，键盘与读屏用户听到的是
 * 一串没有归属的按钮。这两件事都由这里收口。
 */
export function ActionBar({
  label,
  hint,
  children,
  as = 'footer',
  className,
}: ActionBarProps): React.JSX.Element {
  const classes = `action-bar${className ? ` ${className}` : ''}`;
  const content = (
    <>
      {hint ? <span className="action-bar-hint">{hint}</span> : undefined}
      {children}
    </>
  );
  if (as === 'div')
    return (
      <div className={classes} role="group" aria-label={label}>
        {content}
      </div>
    );
  return (
    <footer className={classes} role="group" aria-label={label}>
      {content}
    </footer>
  );
}
