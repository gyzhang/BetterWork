import type { ComponentProps } from 'react';

import type { ControlSize } from './Button';

/**
 * 单行输入框的唯一出口（docs/10 §9.10、§9.13 规矩 11、ADR-0034）。
 *
 * 收编前 `styles.css` 有 30 条规则在基座之外替原生输入控件写几何与外观，收口后只剩 6 条：
 * 一条全局 `:focus-visible` 复位、`Composer` 输入区两条、只钉 `min-height` 的布局钩子三条。
 * 那 30 条里底色曾有 `--surface`／`--surface-raised`／`--canvas`／`transparent` 四种，字号曾跨
 * 三档，聚焦环曾有档位环／`outline: 0`／`outline: none` 三种处置——最后一种是把焦点指示器关掉。
 * 同一种控件在一屏里被记了这么多遍，就不存在「统一」这件事——所以档位回到 §9.10 那张与按钮
 * 共用的成对表上。
 */
export interface TextFieldProps extends Omit<ComponentProps<'input'>, 'size'> {
  /**
   * **必填**，与 `Button`／`FieldSelect` 同一张档位表。输入框会与按钮排在同一行里
   * （新建集合、检索、模型表单），隐式高度正是混档的来源，判据见 docs/10 §9.10。
   */
  size: ControlSize;
}

/**
 * 多行编辑区。没有 `size`：档高管的是单行控件的命中区，多行的高度由 `rows`
 * 与内容决定，只有内距需要与控件档位对齐——一律取最大那一档（docs/10 §9.10）。
 */
export interface TextAreaProps extends ComponentProps<'textarea'> {
  /** 等宽档：Markdown 正文、JSON 与代码编辑区用，字体栈只有一份 `--font-mono`。 */
  mono?: boolean;
}

export function TextField({ size, ...rest }: TextFieldProps): React.JSX.Element {
  const { className, ...inputProps } = rest;
  return (
    <input
      {...inputProps}
      className={`text-field${className ? ` ${className}` : ''}`}
      data-size={size}
    />
  );
}

export function TextArea({ mono, ...rest }: TextAreaProps): React.JSX.Element {
  const { className, ...areaProps } = rest;
  return (
    <textarea
      {...areaProps}
      className={`text-area${className ? ` ${className}` : ''}`}
      {...(mono ? { 'data-mono': 'true' } : {})}
    />
  );
}
