import { describe, expect, it } from 'vitest';

import { colorSchemes } from '../../apps/desktop/src/renderer/src/appearance';
import {
  classesOf,
  cssPaths,
  declarationsOf,
  locate,
  parsePixels,
  productionPathsUnder,
  read,
} from '../coding-standard-support';
import {
  fixedMaxWidthSelectors,
  inlineStyleIssues,
  type InlineStyleOutlet,
  pageCompositionIssues,
  type PageShapeException,
  surfaceShellSelectors,
  themeTokenIssues,
} from '../ui-governance';

/** docs/10 §10.1：内嵌设置分区沿用宿主骨架，不另造普通管理页。 */
const PAGE_SHAPE_EXCEPTIONS: readonly PageShapeException[] = [
  {
    file: 'apps/desktop/src/renderer/src/views/McpSettings.tsx',
    component: 'McpSettings',
    required: ['apps/desktop/src/renderer/src/components/SectionHeader.tsx#SectionHeader'],
    reason: 'MCP 是既有设置宿主内嵌分区，拆出文件承载多传输与登录表单，不另造页面骨架',
  },
  {
    file: 'apps/desktop/src/renderer/src/views/schedules/ScheduleSourcePicker.tsx',
    component: 'ScheduleSourcePicker',
    required: [],
    reason:
      '定时配置页私有的来源 Modal 组合，由 ScheduleEditor 的来源 Field 承载，不是独立页面入口',
  },
  {
    file: 'apps/desktop/src/renderer/src/views/SettingsView.tsx',
    component: 'SettingsPage',
    required: [
      'apps/desktop/src/renderer/src/components/NavList.tsx#NavList',
      'apps/desktop/src/renderer/src/components/SectionHeader.tsx#SectionHeader',
    ],
    reason: '设置已有独立二级导航与分区标题，滚动归设置宿主/内嵌列表',
  },
  {
    file: 'apps/desktop/src/renderer/src/views/SettingsView.tsx',
    component: 'SearchSettings',
    required: ['apps/desktop/src/renderer/src/components/SectionHeader.tsx#SectionHeader'],
    reason: '搜索配置是设置宿主内嵌分区',
  },
  {
    file: 'apps/desktop/src/renderer/src/views/SettingsView.tsx',
    component: 'RuntimeComponentsSettings',
    required: ['apps/desktop/src/renderer/src/components/SectionHeader.tsx#SectionHeader'],
    reason: '运行组件是设置宿主内嵌分区',
  },
  {
    file: 'apps/desktop/src/renderer/src/views/MemoryView.tsx',
    component: 'MemoryPage',
    required: ['apps/desktop/src/renderer/src/components/SectionHeader.tsx#SectionHeader'],
    alternatives: [
      [
        'apps/desktop/src/renderer/src/components/layout/ScrollRegion.tsx#ScrollRegion',
        'apps/desktop/src/renderer/src/components/EmptyState.tsx#EmptyNotice',
      ],
    ],
    reason: '记忆位于设置宿主内；分区标题固定，内容为列表滚动或首读/空集合的 EmptyNotice',
  },
];

/** 只登记精确的运行时样式出口；同文件的另一元素或多一个属性均不自动放行。 */
const INLINE_STYLE_OUTLETS: readonly InlineStyleOutlet[] = [
  {
    file: 'apps/desktop/src/renderer/src/components/NavList.tsx',
    tag: 'span',
    className: 'nav-item-icon',
    attribute: 'spread',
    expression: 'iconColor ? { style: { color: iconColor } } : {}',
    reason: 'NavItem 的工作空间语义身份色通过条件属性展开',
  },
  {
    file: 'apps/desktop/src/renderer/src/notifications.tsx',
    tag: 'section',
    className: 'notification-panel',
    attribute: 'style',
    expression: '{ left: position.left, bottom: position.bottom, maxHeight: position.maxHeight, }',
    reason: '消息中心依据触发器与窗口实时定位/限高',
  },
  {
    file: 'apps/desktop/src/renderer/src/components/PopoverMenu.tsx',
    tag: 'div',
    attribute: 'style',
    expression:
      'position ? { ...position, ...(anchorFontSize ? { fontSize: anchorFontSize } : {}) } : undefined',
    reason: '菜单的动态定位与锚点计算字号，动态域布局类不放宽样式出口，行为契约已有测试',
  },
  {
    file: 'apps/desktop/src/renderer/src/components/Tooltip.tsx',
    tag: 'div',
    className: 'tooltip',
    attribute: 'style',
    expression: 'position',
    reason: '提示浮层依据真实锚点尺寸实时定位',
  },
  {
    file: 'apps/desktop/src/renderer/src/components/WorkspaceIdentityDialog.tsx',
    tag: 'span',
    className: 'workspace-accent-swatch',
    attribute: 'style',
    expression: '{ background: workspaceAccentVar(accent.id) }',
    reason: '工作空间语义色预览',
  },
  {
    file: 'apps/desktop/src/renderer/src/components/WorkspaceIdentityDialog.tsx',
    tag: 'span',
    attribute: 'style',
    expression: '{ color: accent }',
    reason: '工作空间身份草稿的语义色',
  },
  {
    file: 'apps/desktop/src/renderer/src/components/WorkspaceGroupList.tsx',
    tag: 'span',
    attribute: 'style',
    expression: '{ color: workspaceAccentVar(group.workspace.accentId) }',
    reason: '工作空间树的语义身份色',
  },
  {
    file: 'apps/desktop/src/renderer/src/components/WorkspaceSelector.tsx',
    tag: 'span',
    attribute: 'style',
    expression: '{ color: workspaceAccentVar(workspace.accentId) }',
    reason: '工作空间选择器的语义身份色',
  },
  {
    file: 'apps/desktop/src/renderer/src/markdown-preview.tsx',
    tag: 'SyntaxHighlighter',
    attribute: 'style',
    expression: 'getTheme()',
    reason: '成果代码排版的高亮主题',
  },
  {
    file: 'apps/desktop/src/renderer/src/markdown-preview.tsx',
    tag: 'SyntaxHighlighter',
    attribute: 'customStyle',
    expression: "{ background: 'transparent', padding: 0, margin: 0 }",
    reason: '成果代码块交还宿主背景与内距',
  },
  {
    file: 'apps/desktop/src/renderer/src/markdown-preview.tsx',
    tag: 'SyntaxHighlighter',
    attribute: 'codeTagProps',
    expression: "{ style: { font: 'inherit' } }",
    reason: '成果代码文字继承宿主排版',
  },
];

/** 已有表面 Token 登记复用 SURFACE_PADDING；这里仅补控件与独特领域表面。 */
const SURFACE_SHELL_OWNERS: readonly { selector: string; reason: string }[] = [
  { selector: '.activity-summary', reason: 'RunSummaryRow 的整体活动摘要' },
  { selector: '.artifact-thumbnail-item', reason: '成果缩略图的原生按钮' },
  { selector: '.badge', reason: 'Badge 基座' },
  { selector: '.binding-chip', reason: 'BindingChip 可移除绑定基座' },
  { selector: '.binding-chip-remove', reason: 'BindingChip 的移除命中区' },
  { selector: '.composer', reason: 'Composer 基座' },
  { selector: '.composer-footer kbd', reason: '键盘快捷键图形标识' },
  { selector: '.dependency-operation', reason: '技能依赖执行记录，非普通卡片' },
  { selector: '.evidence-preview', reason: '上下文来源正文预览' },
  { selector: '.field-select-trigger', reason: 'FieldSelect 基座' },
  { selector: '.icon-button', reason: 'IconButton 基座' },
  { selector: '.knowledge-admin-toggle', reason: '知识管理分区触发按钮' },
  { selector: '.markdown-preview', reason: '成果 Markdown 文档排版' },
  {
    selector: ".markdown-preview[data-variant='guide']",
    reason: 'MarkdownPreview 的指南变体移除文档卡片外壳，版心仍由 page-body 管理（docs/10 §6.1）',
  },
  { selector: '.markdown-preview pre', reason: '成果代码排版' },
  { selector: '.memory-conflict-bodies > div', reason: '冲突两侧内容并排预览，非目录卡片' },
  { selector: '.memory-policy-pinned', reason: '记忆政策的固定状态容器' },
  { selector: '.message.assistant .markdown-preview', reason: 'MessageBlock 内文档去外壳排版' },
  { selector: '.nav-item', reason: 'NavItem 基座' },
  { selector: '.notification-badge', reason: '未读数图形标识' },
  { selector: '.popover-menu', reason: 'PopoverMenu 基座' },
  { selector: '.single-select-picker-option', reason: 'SingleSelectPicker 选项基座' },
  { selector: '.slide-viewer-image', reason: '成果幻灯片图像的中性衬底' },
  { selector: '.switch-track', reason: 'Switch 基座' },
  { selector: ".tabs [role='tab']", reason: 'Tab 基座' },
  { selector: '.text-area', reason: 'TextArea 基座' },
  { selector: '.text-field', reason: 'TextField 基座' },
  { selector: '.tool-activity-toggle', reason: 'ToolActivity 基座触发按钮' },
  { selector: '.tool-field pre', reason: '工具结构化结果的代码排版' },
  { selector: '.tool-pill', reason: '工具调用原生按钮，非只读徽标' },
  { selector: '.tooltip', reason: 'Tooltip 基座' },
  { selector: '.work-count', reason: '上下文成果数量图形标识' },
  { selector: '.workspace-selector-action', reason: 'WorkspaceSelector 内原生动作按钮' },
  { selector: '.workspace-selector-trigger', reason: 'WorkspaceSelector 原生触发按钮' },
  { selector: '::-webkit-scrollbar-thumb', reason: '平台滚动条绘制' },
];

/** 限宽可以属于提示/浮层/文档，不能成为新页面的第二版心。 */
const FIXED_MAX_WIDTH_OWNERS: readonly { selector: string; reason: string }[] = [
  { selector: '.binding-chip', reason: '绑定片宽度上限' },
  { selector: '.binding-chip-label', reason: '绑定名称截断' },
  { selector: '.empty-page', reason: '居中空态文本行长' },
  { selector: '.error-page p', reason: '错误说明行长' },
  { selector: '.knowledge-admin-profile .field-select-trigger', reason: '索引管理中的模型选择器' },
  { selector: '.mcp-editor', reason: '设置内 MCP 编辑表单' },
  { selector: '.page-intro', reason: '页面引导文案的行长' },
  { selector: '.popover-menu', reason: '锚定菜单碰撞约束' },
  { selector: '.search-settings .search-form', reason: '设置内搜索配置表单' },
  {
    selector: ".section-header[data-variant='block'] .section-header-hint",
    reason: '设置分区帮助文案的行长',
  },
  { selector: '.tooltip', reason: '提示浮层行长' },
  { selector: '.welcome', reason: '欢迎页独立展示块，非管理页版心' },
  { selector: '.workspace-selector-name', reason: '工作空间名称截断' },
];

/** docs/10 §9.3：固定语义集合，不能从当前 CSS 推导而把所有变体同时漏项读成成功。 */
const THEME_COLOR_TOKENS = [
  '--canvas',
  '--surface',
  '--surface-raised',
  '--surface-hover',
  '--overlay',
  '--sidebar',
  '--composer',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--on-danger',
  '--border',
  '--border-subtle',
  '--input-border',
  '--focus-ring',
  '--brand',
  '--brand-hover',
  '--brand-soft',
  '--on-brand',
  '--selection',
  '--success',
  '--success-soft',
  '--danger',
  '--danger-hover',
  '--danger-soft',
  '--scrollbar',
  '--warning',
  '--warning-soft',
  '--info',
  '--info-soft',
] as const;

/**
 * 排版、图标与表面档位（docs/10 §9.13、ADR-0033）。
 *
 * 2026-10-01 家底核查：`styles.css` 的 171 条 `font-size` 有 14 种取值、65 条 `line-height`
 * 有 10 种，22–56px 的方块边长有 10 种，图标字形有 9 种。这几条轴当时**根本没有档位表**，
 * 于是每个表面各挑一个数——本轮把档位、Token 与这五条护栏一起立起来。
 *
 * 例外清单只降不升：每一条都要说清它凭什么不吃档位（图形化标识、控件自己的几何、
 * 成果文档自己的排版），而不是「这处就是差一点」。
 */

/** 字号与行高的例外（docs/10 §9.13 规矩 2、3）。 */
const TYPE_LADDER_EXEMPTIONS: {
  readonly selector: string;
  readonly property: string;
  readonly value: string;
  readonly reason: string;
}[] = [
  { selector: '.brand strong', property: 'font-size', value: '16px', reason: '品牌字标' },
  {
    selector: '.brand small',
    property: 'font-size',
    value: '10px',
    reason: '品牌字标的副标：图形化标识（docs/10 §9.7 豁免清单）',
  },
  {
    selector: '.knowledge-format',
    property: 'font-size',
    value: '10px',
    reason: '格式徽标 MD／PDF／DOC／TXT：图形化标识',
  },
  {
    selector: '.completed-work-icon.markdown',
    property: 'font-size',
    value: '9px',
    reason: '成果列表的格式徽标：图形化标识',
  },
  {
    selector: '.completed-work-icon.file',
    property: 'font-size',
    value: '9px',
    reason: '成果列表的文件徽标：图形化标识',
  },
  {
    selector: '.notification-badge',
    property: 'font-size',
    value: '10px',
    reason: '未读数徽标：图形化标识，不是承载产品信息的文字',
  },
  {
    selector: '.notification-badge',
    property: 'line-height',
    value: '1',
    reason: '绝对定位角标，行高只为自身居中，不参与排版',
  },
  {
    selector: '.memory-editor-counted > small',
    property: 'line-height',
    value: '1',
    reason: '绝对定位的字数角标，同上',
  },
  {
    selector: '.markdown-preview h2',
    property: 'font-size',
    value: '22px',
    reason: '成果文档自己的排版：应用主题不重排 Artifact（docs/10 §9.6、§9.13 规矩 3）',
  },
  {
    selector: '.message.assistant .markdown-preview h1',
    property: 'font-size',
    value: '24px',
    reason: '对话内预览的文档标题，同属成果文档排版',
  },
];

/** 带内方块但不吃 `--mark-*` 的几何（docs/10 §9.13）：它们各有自己的轴。 */
const NON_MARK_GEOMETRY: {
  readonly selector: string;
  readonly property: string;
  readonly value: string;
  readonly reason: string;
}[] = [
  { selector: '.brand-mark', property: 'width', value: '32px', reason: '品牌标志容器' },
  { selector: '.brand-mark', property: 'height', value: '32px', reason: '品牌标志容器' },
  {
    selector: '.switch-track',
    property: 'width',
    value: '32px',
    reason: '开关轨道：控件几何，归 docs/10 §9.10 与 Switch 基座',
  },
  {
    selector: '.mode-preview',
    property: 'height',
    value: '54px',
    reason: '外观页的模式预览条：色板表面，不是标记底座',
  },
  {
    selector: '.scheme-preview',
    property: 'height',
    value: '38px',
    reason: '外观页的色系预览条：同上',
  },
  {
    selector: '.sidebar-top-drag',
    property: 'height',
    value: '40px',
    reason: '窗口拖拽带：可拖动区域的高度',
  },
  {
    selector: '.window-drag-strip',
    property: 'height',
    value: '24px',
    reason: '窗口拖拽带：同上',
  },
];

/** 走过内距档位的独立表面（docs/10 §9.13 规矩 8）。新增一块表面先选档再登记在这里。 */
const SURFACE_PADDING: {
  readonly selector: string;
  readonly token: string;
  readonly reason: string;
}[] = [
  { selector: '.page-body', token: '--surface-padding-page', reason: '页面正文版心' },
  {
    selector: ".card, .option-card, .list-row[data-variant='card']",
    token: '--card-padding',
    reason: '卡片外壳基座（docs/10 §10.1）',
  },
  { selector: '.message p', token: '--card-padding', reason: '气泡正文表面' },
  { selector: '.toast', token: '--card-padding', reason: '全局结果提示条' },
  { selector: '.memory-conflict', token: '--card-padding', reason: '记忆冲突条' },
  { selector: '.memory-capture', token: '--card-padding', reason: '记忆捕捉块' },
  { selector: '.memory-editor-diff', token: '--card-padding', reason: '记忆编辑器差异块' },
  { selector: '.suggestion-consent', token: '--card-padding', reason: '建议同意条' },
  { selector: '.discussion-checkpoints', token: '--card-padding', reason: '讨论节点小节' },
  { selector: '.knowledge-jobs', token: '--card-padding', reason: '知识库任务块' },
  {
    selector: '.skill-state-grid div, .skill-trust-box',
    token: '--card-padding',
    reason: '技能状态格与信任说明块',
  },
  {
    selector: '.expert-editor-body fieldset',
    token: '--card-padding',
    reason: '专家编辑器的分组框',
  },
  { selector: '.workspace-folder-drop', token: '--card-padding', reason: '工作空间目录投放区' },
  { selector: '.artifact-file-info', token: '--card-padding', reason: '成果文件信息块' },
  {
    selector: '.artifact-version-list',
    token: '--card-padding',
    reason:
      '成果详情 176px 左列的列壳：原先 `padding: 10px` 是脱档裸值，2026-10-01 并到卡片档（水平格 16px 归 §9.8 列壳轴）',
  },
  { selector: '.artifact-thumbnail-gallery', token: '--card-padding', reason: '成果缩略图画廊' },
  { selector: '.artifact-source-select', token: '--card-padding', reason: '成果输入选择区' },
  { selector: '.tool-activity-body', token: '--card-padding', reason: '工作过程展开体' },
  {
    selector: '.dependency-panel',
    token: '--surface-padding-panel',
    reason: '面板级：技能依赖面板',
  },
  {
    selector: '.memory-editor-host',
    token: '--surface-padding-panel',
    reason: '面板级：记忆编辑器宿主',
  },
  { selector: '.knowledge-admin', token: '--surface-padding-panel', reason: '面板级：知识库管理' },
  {
    selector: '.knowledge-detail-members',
    token: '--surface-padding-panel',
    reason: '面板级：资料成员列表',
  },
  { selector: '.mcp-editor', token: '--surface-padding-panel', reason: '面板级：MCP 服务编辑器' },
  {
    selector: ".modal-panel[data-variant='viewer']",
    token: '--surface-padding-panel',
    reason: '放映／查看器抽屉正文按面板档',
  },
  {
    selector: '.modal-panel, .notification-panel',
    token: '--surface-padding-modal',
    reason: '模态与消息中心面板',
  },
  {
    selector: ".modal-panel[data-variant='sheet']",
    token: '--surface-padding-modal',
    reason: '模态的 sheet 抽屉（原先写 25px，与模态档只差 1px）',
  },
  { selector: '.empty-page', token: '--surface-padding-modal', reason: '整页空态' },
  {
    selector: '.loading-page, .error-page',
    token: '--surface-padding-modal',
    reason: '整页首屏态',
  },
];

const FONT_SIZE_TOKENS = [
  '--font-size-body',
  '--font-size-caption',
  '--font-size-emphasis',
  '--font-size-heading',
  '--font-size-hero',
  '--font-size-page',
];

const LINE_HEIGHT_TOKENS = [
  '--line-height-body',
  '--line-height-loose',
  '--line-height-normal',
  '--line-height-tight',
];

const MARK_TOKENS = ['--mark-card', '--mark-hero', '--mark-row'];

const SURFACE_PADDING_TOKENS = [
  '--card-padding',
  '--surface-padding-modal',
  '--surface-padding-page',
  '--surface-padding-panel',
];

/** 不走图标档位的展示件：品牌标志有自己的边长，且 §9.7 把它列在豁免里。 */
const BRAND_ICON_SIZES: {
  readonly file: string;
  readonly tag: string;
  readonly value: number;
  readonly reason: string;
}[] = [
  {
    file: 'apps/desktop/src/renderer/src/brand-logo.tsx',
    tag: 'BrandLogo',
    value: 28,
    reason:
      '品牌标志（docs/10 §9.7）：24 网格上的展示件，边长不套界面图标档位，组件因此自持 size?: number',
  },
];

describe('排版与图标档位纪律', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');

  /** `:root` 里以某前缀定义的档位 Token。档位表必须封闭：多一个名字就是第二把尺。 */
  function rootTokens(prefixes: string[]): Map<string, string> {
    const tokens = new Map<string, string>();
    for (const declaration of declarations) {
      if (declaration.selector !== ':root') continue;
      if (prefixes.some((prefix) => declaration.property.startsWith(prefix))) {
        tokens.set(declaration.property, declaration.value);
      }
    }
    return tokens;
  }

  function exemptionCount(property: string): number {
    return TYPE_LADDER_EXEMPTIONS.filter((entry) => entry.property === property).length;
  }

  it('字号只取六档，例外按图形化标识登记', () => {
    const ladder = rootTokens(['--font-size-']);
    expect(
      [...ladder.keys()].sort(),
      '字号档位表必须正好是 docs/10 §9.13 的六档；加一档先改文档',
    ).toEqual(FONT_SIZE_TOKENS);

    const offenders: string[] = [];
    let exemptions = 0;
    for (const declaration of declarations) {
      if (declaration.property !== 'font-size') continue;
      const token = /^var\((--font-size-[a-z-]+)\)$/u.exec(declaration.value)?.[1];
      if (token) {
        if (!ladder.has(token)) offenders.push(locate(declaration, styles ?? ''));
        continue;
      }
      const registered = TYPE_LADDER_EXEMPTIONS.find(
        (entry) =>
          entry.property === 'font-size' &&
          entry.selector === declaration.selector &&
          entry.value === declaration.value,
      );
      if (registered) {
        exemptions += 1;
        continue;
      }
      offenders.push(locate(declaration, styles ?? ''));
    }
    expect(
      offenders,
      '字号必须取 var(--font-size-*) 档位；例外只有图形化标识与成果文档排版，按 selector＋值登记进 TYPE_LADDER_EXEMPTIONS（docs/10 §9.13）',
    ).toEqual([]);
    expect(
      exemptions,
      `字号例外存量 ${exemptions} 条与清单 ${exemptionCount('font-size')} 条不符——清单里不许留着已经改掉的，也不许顺手多出一条`,
    ).toBe(exemptionCount('font-size'));

    // 内联样式是档位的第二个出口：`.markdown-preview` 之外的表面一旦写死 `fontSize`，
    // 调 :root 那一行就漏掉了它。
    const inlineOffenders: string[] = [];
    for (const relative of productionPathsUnder('apps/desktop/src/renderer/')) {
      for (const match of read(relative).matchAll(
        /\bfontSize:\s*(?:'(\d+(?:\.\d+)?)px'|(\d+))/gu,
      )) {
        const pixels = Number(match[1] ?? match[2]);
        if (!Number.isNaN(pixels)) inlineOffenders.push(`${relative} → fontSize: ${pixels}px`);
      }
    }
    expect(
      inlineOffenders,
      '生产代码不在内联样式里写字面字号；`PopoverMenu` 镜像的是触发控件的计算值，不是新档（docs/10 §9.13）',
    ).toEqual([]);
  });

  it('行高只取四档', () => {
    const ladder = rootTokens(['--line-height-']);
    expect(
      [...ladder.keys()].sort(),
      '行高档位表必须正好是 docs/10 §9.13 的四档；1.35／1.45／1.55／1.65 这类「差不多」不许回来',
    ).toEqual(LINE_HEIGHT_TOKENS);

    const offenders: string[] = [];
    let exemptions = 0;
    for (const declaration of declarations) {
      if (declaration.property !== 'line-height') continue;
      const token = /^var\((--line-height-[a-z-]+)\)$/u.exec(declaration.value)?.[1];
      if (token) {
        if (!ladder.has(token)) offenders.push(locate(declaration, styles ?? ''));
        continue;
      }
      const registered = TYPE_LADDER_EXEMPTIONS.find(
        (entry) =>
          entry.property === 'line-height' &&
          entry.selector === declaration.selector &&
          entry.value === declaration.value,
      );
      if (registered) {
        exemptions += 1;
        continue;
      }
      offenders.push(locate(declaration, styles ?? ''));
    }
    expect(
      offenders,
      '行高必须取 var(--line-height-*) 档位；绝对定位角标的 line-height: 1 按 selector＋值登记（docs/10 §9.13）',
    ).toEqual([]);
    expect(exemptions, `行高例外存量与清单 ${exemptionCount('line-height')} 条不符`).toBe(
      exemptionCount('line-height'),
    );
  });

  it('图标字形由 IconSize 类型定档', () => {
    // 14px 曾有 8 个调用点、另有 15／17／10 各一处，靠「记得选对数」收不干净（ADR-0033 决策 6）。
    const iconsPath = 'apps/desktop/src/renderer/src/icons.tsx';
    const icons = read(iconsPath);
    const ladderStart = icons.indexOf('export const ICON_SIZES');
    expect(
      ladderStart,
      `找不到 ${iconsPath} 的 ICON_SIZES，图标档位已退回各写一遍数字`,
    ).toBeGreaterThan(-1);
    const ladderBody = icons.slice(ladderStart, icons.indexOf('} as const', ladderStart));
    const steps = [...ladderBody.matchAll(/^\s+(\w+): (\d+),$/gmu)].map((match) => ({
      name: match[1] ?? '',
      value: Number(match[2]),
    }));
    expect(
      steps.map((step) => `${step.name}:${step.value}`),
      '图标档位必须正好是 docs/10 §9.13 的五档（inline 12／control 13／standalone 16／emphasis 18／nav 20）',
    ).toEqual(['inline:12', 'control:13', 'standalone:16', 'emphasis:18', 'nav:20']);
    expect(
      icons,
      'IconProps 的 size 必须是 IconSize——类型就是档位表，写 size={14} 要编译不过（docs/10 §9.13）',
    ).toMatch(/size\?: IconSize/u);
    expect(icons, '省略 size 时的缺省必须是 standalone').toMatch(/size = ICON_SIZES\.standalone/u);

    const ladderValues = new Set(steps.map((step) => step.value));
    const offenders: string[] = [];
    for (const relative of productionPathsUnder('apps/desktop/src/renderer/')) {
      const text = read(relative);
      for (const match of text.matchAll(/<([A-Z][\w]*)\s+size=\{(\d+)\}/gu)) {
        const tag = match[1] ?? '';
        const value = Number(match[2]);
        if (ladderValues.has(value)) continue;
        if (BRAND_ICON_SIZES.some((entry) => entry.tag === tag && entry.value === value)) continue;
        offenders.push(`${relative} → <${tag} size={${value}} />`);
      }
      for (const match of text.matchAll(/size=\{ICON_SIZES\.(\w+)\}/gu)) {
        const name = match[1] ?? '';
        if (!steps.some((step) => step.name === name)) {
          offenders.push(`${relative} → ICON_SIZES.${name}（档位表里没有这一档）`);
        }
      }
      if (relative === iconsPath) continue;
      if (
        /size\?:\s*number/u.test(text) &&
        !BRAND_ICON_SIZES.some((entry) => entry.file === relative)
      ) {
        offenders.push(`${relative} → size?: number（图标尺寸的类型必须是 IconSize）`);
      }
    }
    expect(
      offenders,
      '图标尺寸只走 IconSize 的五档；品牌标志按 BRAND_ICON_SIZES 登记，`ComponentType<{ size?: number }>` 不得复活（docs/10 §9.13、ADR-0033）',
    ).toEqual([]);

    // IconButton 的字形表引用档位，不留第二份数字。
    const iconButton = read('apps/desktop/src/renderer/src/components/IconButton.tsx');
    const glyphStart = iconButton.indexOf('const GLYPH_SIZE');
    expect(glyphStart, '找不到 IconButton 的 GLYPH_SIZE，本条护栏已空跑').toBeGreaterThan(-1);
    const glyphBody = iconButton.slice(glyphStart, iconButton.indexOf('};', glyphStart));
    expect(
      [...glyphBody.matchAll(/^\s+(\w+): ICON_SIZES\.(\w+),$/gmu)]
        .map((match) => `${match[1] ?? ''}:${match[2] ?? ''}`)
        .sort(),
      'IconButton 的三档字形必须逐项引用 ICON_SIZES（sm 12／md 13／row 20），不写裸数字（docs/10 §9.13）',
    ).toEqual(['md:control', 'row:nav', 'sm:inline']);
  });

  it('标记方块只取三档', () => {
    const ladder = rootTokens(['--mark-']);
    expect(
      [...ladder.keys()].sort(),
      '标记方块档位表必须正好是 row／card／hero 三档（docs/10 §9.13）',
    ).toEqual(MARK_TOKENS);

    const offenders: string[] = [];
    let nonMarks = 0;
    for (const declaration of declarations) {
      if (declaration.property !== 'width' && declaration.property !== 'height') continue;
      const pixels = parsePixels(declaration.value);
      if (pixels === undefined) {
        const token = /^var\((--[a-z-]+)\)$/u.exec(declaration.value)?.[1];
        if (token?.startsWith('--mark-') && !ladder.has(token)) {
          offenders.push(locate(declaration, styles ?? ''));
        }
        continue;
      }
      if (pixels < 22 || pixels > 56) continue;
      const registered = NON_MARK_GEOMETRY.find(
        (entry) =>
          entry.selector === declaration.selector &&
          entry.property === declaration.property &&
          entry.value === declaration.value,
      );
      if (registered) {
        nonMarks += 1;
        continue;
      }
      offenders.push(locate(declaration, styles ?? ''));
    }
    expect(
      offenders,
      '22–56px 的方块边长必须取 var(--mark-*)；控件几何、外观预览、窗口拖拽带与品牌标志各有各的轴，按 selector＋属性＋值登记（docs/10 §9.13）',
    ).toEqual([]);
    expect(
      nonMarks,
      `带内裸方块存量 ${nonMarks} 处，比清单 ${NON_MARK_GEOMETRY.length} 多——例外不是新增口（docs/10 §9.13）`,
    ).toBeLessThanOrEqual(NON_MARK_GEOMETRY.length);
  });

  it('表面内距四档与登记清单两侧一致', () => {
    // 双向比对：清单里留着已改掉的表面、或新表面用了档位却没登记，都读成一次漂移。
    const ladder = rootTokens(['--card-padding', '--surface-padding-']);
    expect(
      [...ladder.keys()].sort(),
      '表面内距只有这四档；给同一份几何起第二个名字正是这张表要消的东西（docs/10 §9.13 规矩 8）',
    ).toEqual(SURFACE_PADDING_TOKENS);

    const inCode = new Map<string, string>();
    for (const declaration of declarations) {
      if (!declaration.property.startsWith('padding')) continue;
      const token = /^var\(--([a-z-]+)\)$/u.exec(declaration.value)?.[1];
      if (!token) continue;
      if (!SURFACE_PADDING_TOKENS.includes(`--${token}`)) continue;
      inCode.set(declaration.selector, `--${token}`);
    }
    const offenders: string[] = [];
    for (const entry of SURFACE_PADDING) {
      if (!SURFACE_PADDING_TOKENS.includes(entry.token)) {
        offenders.push(`${entry.selector} → ${entry.token}（不在四档里）`);
        continue;
      }
      if (inCode.get(entry.selector) !== entry.token) {
        offenders.push(
          `${entry.selector} 期望 ${entry.token}，实际 ${inCode.get(entry.selector) ?? '没有这条登记'}`,
        );
      }
    }
    for (const [selector, token] of inCode) {
      if (!SURFACE_PADDING.some((entry) => entry.selector === selector)) {
        offenders.push(`${selector} → ${token}（用了档位却没登记进 SURFACE_PADDING）`);
      }
    }
    expect(
      offenders,
      '每块独立表面的内距要取四档之一并登记进 SURFACE_PADDING；行内节奏与控件内距各归 §9.8、§9.10，不要串轴（docs/10 §9.13）',
    ).toEqual([]);
  });

  it('font 简写不得把字号与行高藏在里面', () => {
    // `font:` 会连带设置 font-size 与 line-height，而上面两条护栏只认这两个属性名——
    // 2026-10-01 核查时欢迎页口号与三处等宽块就是这么写的（1.35／1.55 与裸字号），
    // 档位表改了它们不动；prettier 还把简写的值折行，单行 grep 也看不见。
    // `font: inherit` 是元素复位，不带任何档位，是唯一留下的写法。
    const shorthands = declarations.filter((declaration) => declaration.property === 'font');
    expect(
      shorthands.filter((declaration) => declaration.value.trim() === 'inherit').length,
      '`font: inherit` 的复位声明不见了——本条护栏已空跑',
    ).toBeGreaterThan(0);
    const offenders = shorthands
      .filter((declaration) => declaration.value.trim() !== 'inherit')
      .map((declaration) => locate(declaration, styles ?? ''));
    expect(
      offenders,
      '字号与行高请用长写法（font-size／line-height）声明，档位护栏才看得见（docs/10 §9.13）',
    ).toEqual([]);
  });
});

describe('设置页纵向间距由容器 gap 拥有', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');

  it('.settings-section 必须自带 flex 纵向 gap，不得靠子元素 margin 凑间距', () => {
    const sectionDeclarations = declarations.filter(
      (declaration) =>
        classesOf(declaration.selector).includes('.settings-section') &&
        declaration.selector.trim() === '.settings-section',
    );
    expect(
      sectionDeclarations.length,
      '.settings-section 基座规则不见了——护栏已空跑',
    ).toBeGreaterThanOrEqual(1);
    const hasGap = sectionDeclarations.some((declaration) => declaration.property === 'gap');
    const hasFlex = sectionDeclarations.some(
      (declaration) => declaration.property === 'display' && declaration.value.includes('flex'),
    );
    expect(hasFlex, '.settings-section 必须是 flex 容器（docs/10 §9.8）').toBe(true);
    expect(hasGap, '.settings-section 必须自带 gap（docs/10 §9.8）').toBe(true);
  });

  it('.settings-section 的直接子元素不得用 margin-top/margin-bottom 凑纵向间距', () => {
    const childMarginRules = declarations.filter(
      (declaration) =>
        (declaration.property === 'margin' ||
          declaration.property === 'margin-top' ||
          declaration.property === 'margin-bottom') &&
        /\.settings-section\s*>/.test(declaration.selector),
    );
    expect(
      childMarginRules,
      '.settings-section > 子元素的纵向 margin 会跟容器 gap 叠加——间距由 gap 统一给（docs/10 §9.8）',
    ).toEqual([]);
  });
});

// 2026-10-01 评估中的绕过形态：补正向使用与新名字检查，而不是再堆一批退役类。
describe('新增 UI 的实际基座归属', () => {
  const rendererSources = productionPathsUnder('apps/desktop/src/renderer/src/')
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => ({ file, text: read(file) }));
  const declarations = cssPaths().flatMap(declarationsOf);

  it('每个视图入口的可见返回分支实际使用页面骨架', () => {
    expect(pageCompositionIssues(rendererSources, PAGE_SHAPE_EXCEPTIONS)).toEqual([]);
    for (const exception of PAGE_SHAPE_EXCEPTIONS) {
      expect(read(exception.file)).toContain(`export function ${exception.component}`);
      expect(exception.reason.length).toBeGreaterThan(0);
    }
  });

  it('内联样式只有登记过的精确动态出口', () => {
    expect(
      rendererSources.flatMap((source) => inlineStyleIssues(source, INLINE_STYLE_OUTLETS)),
    ).toEqual([]);
    for (const outlet of INLINE_STYLE_OUTLETS) {
      const text = read(outlet.file).replace(/\s+/gu, '');
      expect(text, `已不存在的出口 ${outlet.file} ${outlet.reason}`).toContain(
        outlet.expression.replace(/\s+/gu, ''),
      );
    }
  });

  it('新命名表面不能自造卡片或徽标外壳', () => {
    const actual = surfaceShellSelectors(declarations);
    const shared = SURFACE_PADDING.flatMap((entry) =>
      entry.selector.split(',').map((selector) => selector.trim()),
    );
    const owners = SURFACE_SHELL_OWNERS.map((entry) => entry.selector);
    expect(
      actual.filter((selector) => !shared.includes(selector) && !owners.includes(selector)),
    ).toEqual([]);
    expect(
      owners.filter((selector) => !actual.includes(selector)),
      '表面所有者清单不能留已退役项',
    ).toEqual([]);
  });

  it('新的裸 max-width 不能成为第二套页面版心', () => {
    expect(fixedMaxWidthSelectors(declarations)).toEqual(
      FIXED_MAX_WIDTH_OWNERS.map((entry) => entry.selector).sort(),
    );
  });

  it('每个正式主题变体独立实现完整颜色 Token 契约', () => {
    expect(
      themeTokenIssues(
        declarations,
        colorSchemes.map((scheme) => scheme.id),
        THEME_COLOR_TOKENS,
      ),
    ).toEqual([]);
  });
});
