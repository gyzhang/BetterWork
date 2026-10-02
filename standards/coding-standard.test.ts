import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { colorSchemes } from '../apps/desktop/src/renderer/src/appearance';
import {
  componentCatalogIssues,
  type CssDeclaration,
  fixedMaxWidthSelectors,
  inlineStyleIssues,
  type InlineStyleOutlet,
  pageCompositionIssues,
  type PageShapeException,
  parseCssDeclarations,
  surfaceShellSelectors,
  themeTokenIssues,
} from './ui-governance';

/** docs/10 §10.1：内嵌设置分区沿用宿主骨架，不另造普通管理页。 */
const PAGE_SHAPE_EXCEPTIONS: readonly PageShapeException[] = [
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
    expression: '{ left: position.left, top: position.top, maxHeight: position.maxHeight, }',
    reason: '消息中心依据触发器与窗口实时定位/限高',
  },
  {
    file: 'apps/desktop/src/renderer/src/components/PopoverMenu.tsx',
    tag: 'div',
    className: 'popover-menu',
    attribute: 'style',
    expression:
      'position ? { ...position, ...(anchorFontSize ? { fontSize: anchorFontSize } : {}) } : undefined',
    reason: '菜单的动态定位与锚点计算字号，行为契约已有测试',
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
  { selector: '.tabs button', reason: 'Tabs 基座' },
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
  { selector: '.binding-chip .field-select-trigger', reason: '绑定片内的选择器' },
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
  { selector: '.welcome > p:last-of-type', reason: '欢迎页说明行长' },
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
 * 规范护栏。
 *
 * `eslint.config.mjs` 与 `.prettierrc.json` 管住了「一个文件内部的写法」，但管不住
 * 跨文件的结构性约定：规范配置本身会不会被复制成第二份、豁免注释会不会悄悄出现、
 * 分层边界会不会被绕过、主题 Token 会不会被硬编码色值架空。这些约定写在
 * `docs/12-engineering-standards.md` 里，本文件是它们的可执行形式。
 *
 * 例外一律写成下面的显式白名单并注明理由（docs/12 §10），不允许在源码里就地豁免。
 *
 * 注释里裸写的 `§3.x`／`§4.x` 与 `P` 编号指 `docs/reviews/2026-09-26-ui-consistency.md`
 * （§3.1–3.6 缺陷清单，`P` 只到 P3）与 `docs/reviews/2026-09-27-ui-reuse-audit.md`
 * （§3.1–3.4 重复账、§4.1–4.6 基座逃逸，`P` 到 P12）；两份都有 §3.x，P4 及以上一定在
 * 后者。新增引用请点名文件，别再留裸编号。
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const PRUNED_DIRECTORIES = new Set(['.git', 'coverage', 'dist', 'node_modules', 'out', 'release']);

/** 生产源码的扫描根。本护栏自身在 `standards/`，因此不会与被扫描的字符串互相污染。 */
const SOURCE_ROOTS = ['apps/', 'packages/', 'scripts/'] as const;

function collectFiles(directory: string): string[] {
  const collected: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (PRUNED_DIRECTORIES.has(entry.name)) continue;
    // CodeArts 本地索引缓存（docs/12 §10）；仅仓库根豁免，另查 Git 防止误提交。
    if (directory === REPO_ROOT && entry.name === '.codeartsdoer') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collected.push(...collectFiles(absolute));
    } else if (entry.isFile()) {
      collected.push(absolute);
    }
  }
  return collected;
}

const REPO_FILES: string[] = collectFiles(REPO_ROOT)
  .map((absolute) => path.relative(REPO_ROOT, absolute).split(path.sep).join('/'))
  .sort();

function pathsUnder(...roots: string[]): string[] {
  return REPO_FILES.filter((relative) => roots.some((root) => relative.startsWith(root)));
}

function sourcePathsUnder(...roots: string[]): string[] {
  return pathsUnder(...roots).filter((relative) => /\.(ts|tsx|mts|cts)$/.test(relative));
}

function productionPathsUnder(...roots: string[]): string[] {
  return sourcePathsUnder(...roots).filter((relative) => !/\.test\.tsx?$/.test(relative));
}

function read(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s*'([^']+)'/g), ...source.matchAll(/^\s*import\s*'([^']+)'/gm)]
    .map((match) => match[1] ?? '')
    .filter((specifier) => specifier.length > 0);
}

const declarationCache = new Map<string, CssDeclaration[]>();

function declarationsOf(relativePath: string): CssDeclaration[] {
  const cached = declarationCache.get(relativePath);
  if (cached) return cached;
  const parsed = parseCssDeclarations(read(relativePath));
  declarationCache.set(relativePath, parsed);
  return parsed;
}

function cssPaths(): string[] {
  return pathsUnder('apps/', 'packages/').filter((relative) => relative.endsWith('.css'));
}

function locate(declaration: CssDeclaration, relativePath: string): string {
  return `${relativePath}:${declaration.line} ${declaration.selector} { ${declaration.property}: ${declaration.value} }`;
}

/**
 * 从 `<` 处读出一个 JSX 开标签：属性文本只保留花括号深度 0 的部分。
 *
 * 动作排与输入控件两条护栏都要它：属性里的箭头函数带 `>`，用正则截到第一个 `>`
 * 会把标签读断；花括号深度只在 0 时才算标签自己的收尾。
 */
function jsxOpenTag(
  text: string,
  start: number,
): { name: string; attrs: string; end: number; selfClosing: boolean } | undefined {
  const head = /^<([A-Za-z][\w.]*)/.exec(text.slice(start, start + 60));
  const name = head?.[1];
  if (!name) return undefined;
  let cursor = start + name.length + 1;
  let braceDepth = 0;
  let quote: string | undefined;
  let attrs = '';
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === undefined) break;
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      if (braceDepth === 0) attrs += char;
      cursor += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      if (braceDepth === 0) attrs += char;
      cursor += 1;
      continue;
    }
    if (char === '{') braceDepth += 1;
    else if (char === '}') braceDepth -= 1;
    if (braceDepth === 0) attrs += char;
    if (char === '>' && braceDepth === 0) break;
    if (char === '/' && text[cursor + 1] === '>' && braceDepth === 0) break;
    cursor += 1;
  }
  return { name, attrs, end: cursor, selfClosing: attrs.trimEnd().endsWith('/') };
}

/** 文本里每一处 `<tag>` 开标签（含属性文本与行号），供逐处判定用。 */
function jsxOpenTags(
  text: string,
  tagPattern: RegExp,
): { name: string; attrs: string; line: number }[] {
  const found: { name: string; attrs: string; line: number }[] = [];
  for (let cursor = 0; cursor < text.length; cursor += 1) {
    if (text[cursor] !== '<') continue;
    if (!tagPattern.test(text.slice(cursor, cursor + 12))) continue;
    const tag = jsxOpenTag(text, cursor);
    if (!tag) continue;
    found.push({
      name: tag.name,
      attrs: tag.attrs,
      line: text.slice(0, cursor).split('\n').length,
    });
    cursor = tag.end;
  }
  return found;
}

/** 只接受 px 与 rem，其余单位无法判定是否低于 12px 下限。 */
describe('唯一规范源', () => {
  it('ESLint 与 Prettier 各只有一份根级配置', () => {
    const lintConfigs = REPO_FILES.filter((relative) =>
      /(^|\/)(eslint\.config\.[cm]?js|\.eslintrc(\..*)?)$/.test(relative),
    );
    expect(lintConfigs, 'ESLint 配置被复制成了多份').toEqual(['eslint.config.mjs']);

    const formatConfigs = REPO_FILES.filter((relative) =>
      /(^|\/)(\.prettierrc(\..*)?|prettier\.config\.[cm]?js)$/.test(relative),
    );
    expect(formatConfigs, 'Prettier 配置被复制成了多份').toEqual(['.prettierrc.json']);
  });

  it('任何 package.json 都不内嵌 lint/format 配置', () => {
    const offenders = REPO_FILES.filter((relative) => relative.endsWith('package.json')).filter(
      (relative) => {
        const manifest = JSON.parse(read(relative)) as Record<string, unknown>;
        return ['eslintConfig', 'eslintIgnore', 'prettier'].some((key) => key in manifest);
      },
    );
    expect(offenders, '这些 package.json 内嵌了会覆盖根配置的第二套标准').toEqual([]);
  });

  it('tsconfig 只有一份且四项严格开关全开', () => {
    const tsconfigs = REPO_FILES.filter((relative) => /(^|\/)tsconfig.*\.json$/.test(relative));
    expect(tsconfigs, '出现了会各自放宽严格度的第二份 tsconfig').toEqual(['tsconfig.json']);

    const { compilerOptions } = JSON.parse(read('tsconfig.json')) as {
      compilerOptions?: Record<string, unknown>;
    };
    for (const flag of [
      'strict',
      'noUncheckedIndexedAccess',
      'exactOptionalPropertyTypes',
      'useUnknownInCatchVariables',
    ]) {
      expect(compilerOptions?.[flag], `${flag} 必须开启（docs/12 §4）`).toBe(true);
    }
  });

  it('源码里没有任何规则豁免注释', () => {
    const suppressions = [
      'eslint-disable',
      'eslint-enable',
      '@ts-ignore',
      '@ts-expect-error',
      '@ts-nocheck',
      'prettier-ignore',
    ];
    const offenders: string[] = [];
    for (const relative of pathsUnder(...SOURCE_ROOTS)) {
      if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|css)$/.test(relative)) continue;
      const text = read(relative);
      for (const needle of suppressions) {
        if (text.includes(needle)) offenders.push(`${relative} 含有 ${needle}`);
      }
    }
    expect(
      offenders,
      '例外必须写进 eslint.config.mjs 并注明理由，不允许散落在源码里（docs/12 §10）',
    ).toEqual([]);
  });
});

describe('架构边界', () => {
  it('packages 不依赖 apps，Agent Core 不依赖宿主运行时', () => {
    const forbiddenInAgentCore = new Set(['electron', 'react', 'react-dom', 'better-sqlite3']);
    const offenders: string[] = [];
    for (const relative of productionPathsUnder('packages/')) {
      for (const specifier of importSpecifiers(read(relative))) {
        if (specifier.includes('apps/') || specifier === '@betterwork/desktop') {
          offenders.push(`${relative} -> ${specifier}`);
        }
        if (relative.startsWith('packages/agent-core/') && forbiddenInAgentCore.has(specifier)) {
          offenders.push(`${relative} -> ${specifier}`);
        }
      }
    }
    expect(offenders, '依赖方向被反转（AGENTS.md §3）').toEqual([]);
  });

  it('Renderer 不直接触达 Node、Electron 或数据库', () => {
    const forbiddenInRenderer = new Set(['electron', 'better-sqlite3']);
    const offenders: string[] = [];
    for (const relative of sourcePathsUnder('apps/desktop/src/renderer/')) {
      for (const specifier of importSpecifiers(read(relative))) {
        if (specifier.startsWith('node:') || forbiddenInRenderer.has(specifier)) {
          offenders.push(`${relative} -> ${specifier}`);
        }
      }
    }
    expect(offenders, 'Renderer 只能经 preload 的类型化 API 访问主进程能力').toEqual([]);
  });

  it('协议内联的图片数据在 Renderer CSP 里被放行', () => {
    const protocol = read('packages/agent-protocol/src/index.ts');
    const html = read('apps/desktop/src/renderer/index.html');
    // CSP 没声明 img-src 时按 default-src 'self' 处理，data: URL 会被静默拦下：
    // 图片只剩 alt 文本，lint/typecheck/单测全绿，只有真机打开界面才看得见（ADR-0013 决策 3）。
    expect(
      protocol.includes("startsWith('data:image/')"),
      '协议已不再输出 data URL，请同步收紧 CSP 的 img-src 并更新 ADR-0013',
    ).toBe(true);
    const imgSrc = /img-src\s+([^";]+)/.exec(html)?.[1];
    expect(
      imgSrc,
      'CSP 必须显式声明 img-src：default-src 不含 data:，内联预览图会打不开',
    ).toBeDefined();
    expect(imgSrc ?? '', '幻灯片预览走 data URL，img-src 必须包含 data:').toContain('data:');
  });

  it('协议导出的阈值常量都有真实消费者', () => {
    const protocolPath = 'packages/agent-protocol/src/index.ts';
    const protocol = read(protocolPath);
    const declared = [...protocol.matchAll(/^export const ([A-Z][A-Z0-9_]*)\s*=/gm)].map(
      (match) => match[1] ?? '',
    );
    expect(declared.length).toBeGreaterThan(0);
    const consumerText = productionPathsUnder('apps/', 'packages/')
      .filter((relative) => relative !== protocolPath)
      .map((relative) => read(relative))
      .join('\n');
    const orphans = declared.filter((name) => {
      const reference = new RegExp(`\\b${name}\\b`, 'gu');
      // 同文件里被 Schema 或别的常量引用就算消费；只剩导出行是自己，等于常量与实现各说一套。
      if ([...protocol.matchAll(reference)].length > 1) return false;
      return [...consumerText.matchAll(reference)].length === 0;
    });
    expect(
      orphans,
      '无人消费的协议常量：改常量不会改行为，真相源变成了消费处那个字面量（docs/12 §7）',
    ).toEqual([]);
  });

  it('视图与组件不直接调用 IPC', () => {
    const offenders = pathsUnder(
      'apps/desktop/src/renderer/src/views/',
      'apps/desktop/src/renderer/src/components/',
    ).filter(
      (relative) => /\.(tsx|ts)$/.test(relative) && read(relative).includes('window.betterwork'),
    );
    expect(offenders, 'IPC 调用必须收在 hooks/ 里，视图只拿包装好的动作（docs/12 §8）').toEqual([]);
  });

  it('ipcMain.handle 只在 ipc/register-ipc.ts 出现', () => {
    const allowed = new Set([
      'apps/desktop/src/main/ipc/register-ipc.ts',
      'apps/desktop/src/main/ipc/register-ipc.test.ts',
    ]);
    const offenders = sourcePathsUnder(...SOURCE_ROOTS).filter(
      (relative) => !allowed.has(relative) && read(relative).includes('ipcMain.handle'),
    );
    expect(offenders, 'channel 注册必须全部经过三个注册 helper 的边界校验（docs/12 §7）').toEqual(
      [],
    );
  });

  it('取消词汇只在 agent-core/errors.ts 定义', () => {
    const allowed = 'packages/agent-core/src/errors.ts';
    const offenders = sourcePathsUnder(...SOURCE_ROOTS).filter(
      (relative) => relative !== allowed && read(relative).includes("'AbortError'"),
    );
    expect(
      offenders,
      '写错取消错误的名字会让取消被当成失败上报，只允许 abortError()/isAbortError()（docs/12 §5）',
    ).toEqual([]);
  });

  it('仓库工作区内没有密钥文件与数据库文件', () => {
    expect(
      execFileSync('git', ['ls-files', '--', '.codeartsdoer'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim(),
      'CodeArts 本地缓存不得被 Git 跟踪',
    ).toBe('');
    const offenders = REPO_FILES.filter((relative) => {
      if (relative.endsWith('.env.example')) return false;
      return /(^|\/)\.env(\.[^/]*)?$/.test(relative) || /\.(db|sqlite|sqlite3)$/.test(relative);
    });
    expect(offenders, '这些文件属于本机运行产物或凭据，不得进入仓库（AGENTS.md §7）').toEqual([]);
  });

  it('明文凭据列只允许由所属仓储的 save 与迁移清空写入', () => {
    const allowed = new Set([
      'apps/desktop/src/main/persistence/model-repository.ts',
      'apps/desktop/src/main/persistence/search-engine-repository.ts',
    ]);
    const offenders = productionPathsUnder(...SOURCE_ROOTS).filter(
      (relative) => !allowed.has(relative) && /api_key *(?==)/.test(read(relative)),
    );
    expect(
      offenders,
      'api_key 只能由所属仓储的 save 写入或由迁移清空；多一个写入方就是多一个泄露口（CF11 发现一）',
    ).toEqual([]);
  });

  it('任何 SQL 都不得用 excluded 覆写凭据列', () => {
    const offenders = sourcePathsUnder(...SOURCE_ROOTS).filter((relative) =>
      /excluded\.api_key/.test(read(relative)),
    );
    expect(
      offenders,
      'UPSERT 的 DO UPDATE 覆写 api_key，会把从 credentials 解出的密钥写回明文列，一律禁止',
    ).toEqual([]);
  });

  it('Renderer 里空体的 catch 必须写明降级理由', () => {
    // 「收口」的不变量是**失败必须到达一个真实存在的呈现出口**，不是「必须字面调用某个
    // helper」（docs/12 §5 的 Renderer 小节）。ESLint 的 no-floating-promises＋ignoreVoid:false
    // 挡得住 `void someIpcCall()`，但挡不住 `.catch(() => undefined)`——它「处理」了 promise，
    // 只是把失败扔了。空体 catch 因此只有一种合法形态：**降级，并把理由写在 catch 体里**。
    // 只扫 Renderer：主进程那一批 `.catch(() => undefined)` 挂在 close()/cancel()/rm() 上，
    // 讲的是「尽力释放资源」，与「失败要不要让用户看见」不是同一条不变量。
    const offenders: string[] = [];
    for (const relative of productionPathsUnder('apps/desktop/src/renderer/src/')) {
      // 先抹掉块注释再扫，否则「文档里举例说明哪种写法违规」会被当成违规本身——
      // `lib/async-action.ts` 的 JSDoc 正好写了 `catch {}` 与 `.catch(() => undefined)` 两个反例。
      // 抹的时候保留换行，行号才对得上；`//` 注释留着，降级理由正是靠它认。
      const source = read(relative).replace(/\/\*[\s\S]*?\*\//gu, (block) =>
        block.replace(/[^\n]/gu, ' '),
      );
      const lineOf = (index: number): number => source.slice(0, index).split('\n').length;

      // 形态一：`} catch {` ／ `} catch (error) {`，体内只有注释或什么都没有。
      // 收尾用 `\s*` 而不是 `[ \t]*`：`catch {\n}` 这种跨行空体同样算空，
      // 写成 `[ \t]*` 会漏掉它——这一处是变异验证时发现的（删掉理由注释后护栏仍然绿）。
      for (const match of source.matchAll(
        /catch(?:\s*\([^)]*\))?\s*\{((?:[ \t]*\/\/[^\n]*\n)*)\s*\}/gu,
      )) {
        if ((match[1] ?? '').trim() === '')
          offenders.push(`${relative}:${lineOf(match.index)} 空 catch 体`);
      }

      // 形态二：`.catch(() => undefined)` ／ `.catch(() => {})`，理由写在本行或上一行。
      const lines = source.split('\n');
      for (const match of source.matchAll(/\.catch\(\(\)\s*=>\s*(?:undefined|\{\s*\})\s*\)/gu)) {
        const line = lineOf(match.index);
        const hasReason =
          (lines[line - 1] ?? '').includes('//') || (lines[line - 2] ?? '').includes('//');
        if (!hasReason) offenders.push(`${relative}:${line} .catch(() => …) 没有降级理由`);
      }
    }
    expect(
      offenders,
      '失败被扔掉而不说明为什么可以扔，等于把「不处理」伪装成「已处理」（docs/12 §5 的 Renderer 小节）',
    ).toEqual([]);
  });

  it('hooks 里先置 true 的 busy 标志必须在失败路径也能清除', () => {
    // 「只记录」那一类处置成立的前提，是这句话在调用链上已有别的承载，或者用户根本不需要
    // 知道它失败了。两者都不满足时，最常见的破口不是丢一句错误，而是**界面停在转圈上**：
    // `setLoading(true)` 之后只在 `.then` 里 `setLoading(false)`，一次 IPC 失败就让
    // 「正在加载…」永远转下去，没有内容、没有报错、没有重试。
    // 2026-09-30 实测这同一条缺陷在 5 处（use-skills ×2、use-experts、use-mcp-connections、
    // use-skill-dependencies 各 1），本轮修完后把它钉成护栏。
    //
    // 只管 `trackAction`：`reportAction` 的 `onError` 是调用方写的回调，静态判不出它有没有清
    // busy——那一半由 hook 的行为测试守（见 use-skills.test.ts 等）。
    const offenders: string[] = [];
    for (const relative of productionPathsUnder('apps/desktop/src/renderer/src/hooks/')) {
      const source = read(relative).replace(/\/\*[\s\S]*?\*\//gu, (block) =>
        block.replace(/[^\n]/gu, ' '),
      );
      const lines = source.split('\n');
      lines.forEach((line, index) => {
        if (!line.includes('trackAction(')) return;
        // 调用前三行内把某个 busy 标志置 true —— 这是「这次调用要让界面进入等待态」的信号。
        const before = lines.slice(Math.max(0, index - 3), index).join('\n');
        if (!/set\w*(Loading|Busy|Preparing|Saving)\(true\)/u.test(before)) return;
        // 取 trackAction( 到配对的 ) 之间的整段参数链。
        let depth = 0;
        let chain = '';
        for (let k = index; k < Math.min(index + 45, lines.length); k += 1) {
          chain += `${lines[k] ?? ''}\n`;
          for (const char of lines[k] ?? '') {
            if (char === '(') depth += 1;
            else if (char === ')') depth -= 1;
          }
          if (depth <= 0 && k > index) break;
        }
        // 失败路径能清除的四种写法：链上 .catch／.finally，或经 settle*Call 把拒绝转成结果对象。
        if (!/\.catch\(|\.finally\(|settle\w*Call\(/u.test(chain)) {
          offenders.push(`${relative}:${index + 1} busy 只在成功路径清除`);
        }
      });
    }
    expect(
      offenders,
      '失败时 loading/busy 必须停下，且那句错误要到达一个呈现出口——否则用户只能看着转圈（docs/12 §5 的 Renderer 小节）',
    ).toEqual([]);
  });
});

describe('界面 Token 纪律', () => {
  // 外观选择器的色板要预览「别的」色系，用当前 Token 画不出目标色系，
  // 因此这里的字面色值是设计意图本身，不是绕过 Token。
  const SWATCH_SELECTOR = /\.(mode|scheme)-preview/;
  const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

  it('样式表里的硬编码色值只允许出现在 Token 定义与外观预览色板', () => {
    const offenders: string[] = [];
    for (const relative of cssPaths()) {
      for (const declaration of declarationsOf(relative)) {
        if (declaration.property.startsWith('--')) continue;
        if (!COLOR_LITERAL.test(declaration.value)) continue;
        if (SWATCH_SELECTOR.test(declaration.selector)) continue;
        offenders.push(locate(declaration, relative));
      }
    }
    expect(offenders, '新增颜色先进 Token 契约并当场补齐 8 个 Variant（docs/12 §8）').toEqual([]);
  });

  it('样式表引用的每个 Token 都有定义', () => {
    // var(--x) 取不到定义时，属性在计算值阶段失效并回退初值：实心按钮的 hover
    // 背景会变透明、浮层阴影会消失，而 lint 与 typecheck 都发现不了这类问题。
    const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
    const defined = new Set<string>();
    for (const relative of cssPaths()) {
      for (const match of withoutComments(read(relative)).matchAll(/--[a-zA-Z0-9-]+(?=\s*:)/g)) {
        defined.add(match[0]);
      }
    }
    const offenders: string[] = [];
    for (const relative of cssPaths()) {
      const references = withoutComments(read(relative)).matchAll(
        /var\((--[a-zA-Z0-9-]+)\s*([,)])/g,
      );
      for (const match of references) {
        const token = match[1] ?? '';
        const hasFallback = match[2] === ',';
        if (!hasFallback && !defined.has(token)) offenders.push(`${relative}: var(${token})`);
      }
    }
    expect(offenders, '用了未定义的 Token 会让属性静默回退初值（docs/12 §8）').toEqual([]);
  });

  it('工作空间身份色的每一档都在明暗两套 Variant 里成对定义', () => {
    // 档位清单住在协议的 workspaceAccentIdSchema，色值只住在样式表（docs/10 §9.4）。
    // 少一档深色值既不报错也不报错——它只是让暗色侧栏里的图标糊成一片，
    // tsc 与 vitest 都发现不了，只能在这里逐档核对两套 Variant。
    const protocol = read('packages/agent-protocol/src/index.ts');
    const start = protocol.indexOf('export const workspaceAccentIdSchema');
    expect(start, 'workspaceAccentIdSchema 是身份色档位的唯一清单').toBeGreaterThan(-1);
    const accents = [
      ...protocol.slice(start, protocol.indexOf('])', start)).matchAll(/'([a-z]+)'/g),
    ]
      .map((match) => match[1])
      .filter((id): id is string => Boolean(id));
    expect(accents.length).toBeGreaterThanOrEqual(8);

    const identityDeclarations = declarationsOf('apps/desktop/src/renderer/src/styles.css').filter(
      (declaration) => declaration.property.startsWith('--ws-'),
    );
    const offenders = accents.filter((accent) => {
      const themes = new Set(
        identityDeclarations
          .filter((declaration) => declaration.property === `--ws-${accent}`)
          .map((declaration) =>
            declaration.selector.includes("data-theme='light'")
              ? 'light'
              : declaration.selector.includes("data-theme='dark'")
                ? 'dark'
                : 'other',
          ),
      );
      return !(themes.has('light') && themes.has('dark'));
    });
    expect(offenders, '身份色必须同时给出浅色与深色 Variant，不留半套').toEqual([]);
  });

  it('动效时长一律取自 Token', () => {
    const rawDuration = /\d+(?:\.\d+)?m?s\b/;
    const offenders: string[] = [];
    for (const relative of cssPaths()) {
      for (const declaration of declarationsOf(relative)) {
        if (!/^(transition|animation)(-duration|-delay)?$/.test(declaration.property)) continue;
        if (!rawDuration.test(declaration.value)) continue;
        // prefers-reduced-motion 的降级本身就是「把时长压到 0」，写死是它的职责。
        if (declaration.selector.includes('prefers-reduced-motion')) continue;
        offenders.push(locate(declaration, relative));
      }
    }
    expect(
      offenders,
      '时长只用 --motion-instant / --motion-expand / --motion-overlay（docs/12 §8）',
    ).toEqual([]);
  });

  it('小于 12px 的字号只允许出现在豁免徽标', () => {
    // 豁免仅限图形化标识（docs/12 §8）。`font-size: 0` 是收起态隐藏文字标签、
    // 只留图标的写法，不属于「用小字号换空间」。
    const exemptions = [
      { match: '.brand small', reason: '品牌字标' },
      { match: '.completed-work-icon', reason: '成果格式徽标' },
      { match: '.knowledge-format', reason: '资料格式徽标（MD/PDF/DOC/TXT）' },
      { match: '.notification-badge', reason: '未读数徽标' },
    ];
    const offenders: string[] = [];
    for (const relative of cssPaths()) {
      for (const declaration of declarationsOf(relative)) {
        if (declaration.property !== 'font-size') continue;
        const pixels = parsePixels(declaration.value);
        if (pixels === undefined || pixels === 0 || pixels >= 12) continue;
        if (exemptions.some((exemption) => declaration.selector.includes(exemption.match)))
          continue;
        offenders.push(locate(declaration, relative));
      }
    }
    const granted = exemptions.map((item) => `${item.match}（${item.reason}）`).join('、');
    expect(
      offenders,
      `正文与承载产品信息的次要文本不得小于 12px（docs/12 §8）。现行豁免：${granted}`,
    ).toEqual([]);
  });

  it('硬编码色值只允许出现在首帧主题、品牌标志与外观回退', () => {
    const allowedFiles = new Set([
      // 首帧窗口主题：CSS 还没加载，只能写字面值。
      'apps/desktop/src/main/window.ts',
      // 读不到 Token 时的回退值。
      'apps/desktop/src/renderer/src/appearance.ts',
      // 品牌标志是人工定稿资产。
      'apps/desktop/src/renderer/src/brand-logo.tsx',
    ]);
    const offenders = productionPathsUnder('apps/', 'packages/').filter(
      (relative) => !allowedFiles.has(relative) && COLOR_LITERAL.test(read(relative)),
    );
    expect(offenders, '色值只能来自语义化 Token（docs/12 §8）').toEqual([]);
  });

  it('首帧窗口主题与青玉浅色 Token 保持一致', () => {
    const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
    expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
    const jadeLight = declarationsOf(styles ?? '').filter(
      (declaration) =>
        declaration.selector.includes("data-theme='light'") &&
        declaration.selector.includes("data-scheme='jade'"),
    );
    const canvas = jadeLight.find((declaration) => declaration.property === '--canvas')?.value;
    const textPrimary = jadeLight.find(
      (declaration) => declaration.property === '--text-primary',
    )?.value;
    expect(canvas, '青玉浅色 Variant 缺少 --canvas').toBeDefined();
    expect(textPrimary, '青玉浅色 Variant 缺少 --text-primary').toBeDefined();

    const hexLiterals = (source: string): string[] =>
      [...source.matchAll(/#([0-9a-fA-F]{6})\b/g)].map(
        (match) => `#${(match[1] ?? '').toLowerCase()}`,
      );

    expect(
      hexLiterals(read('apps/desktop/src/main/window.ts')),
      'INITIAL_WINDOW_THEME 与青玉浅色 --canvas/--text-primary 不一致，冷启动会闪一下错误底色',
    ).toEqual([canvas, textPrimary]);
    expect(
      [...new Set(hexLiterals(read('apps/desktop/src/renderer/src/appearance.ts')))],
      'getWindowTheme 的回退值与青玉浅色 Token 不一致',
    ).toEqual([canvas, textPrimary]);
  });
});

function parsePixels(value: string): number | undefined {
  const pixels = /^(\d+(?:\.\d+)?)px$/.exec(value);
  if (pixels) return Number(pixels[1]);
  const rems = /^(\d+(?:\.\d+)?)rem$/.exec(value);
  if (rems) return Number(rems[1]) * 16;
  return undefined;
}

/**
 * 取一条声明值的实际像素数，`var(--token)` 时回查它的定义。
 * 档位一律住在 Token 里（docs/10 §9.13），护栏若只认字面 px，
 * 就会把「老实用了档位」判成「没写」——那等于逼着代码退回裸值。
 */
function resolvePixels(declarations: CssDeclaration[], value: string): number | undefined {
  const direct = parsePixels(value);
  if (direct !== undefined) return direct;
  const token = /^var\((--[a-zA-Z0-9-]+)\)$/.exec(value)?.[1];
  if (!token) return undefined;
  const definition = declarations.find((declaration) => declaration.property === token);
  return definition ? parsePixels(definition.value) : undefined;
}

function isInsetProperty(property: string): boolean {
  return /^(padding|margin)(-(left|right|inline))?$/.test(property);
}

/**
 * 把 `var(--token)` 换成它的定义、把 `var(--token, 兜底)` 在 Token 没有生产者时换成兜底——
 * 也就是 CSS 渲染出来的那个值。没换掉的（既无定义也无兜底）原样留着，交给下游读成「取不到像素数」。
 */
function expandVarTokens(declarations: CssDeclaration[], value: string): string {
  const pattern = /var\((--[a-zA-Z0-9-]+)(?:\s*,\s*([^()]*))?\)/u;
  let expanded = value;
  for (let pass = 0; pass < 3; pass += 1) {
    const match = pattern.exec(expanded);
    if (!match) break;
    const all = match[0] ?? '';
    const token = match[1];
    if (!token) break;
    const definition = declarations.find((declaration) => declaration.property === token)?.value;
    const replacement = definition ?? match[2] ?? '';
    if (replacement === all) break;
    const start = match.index;
    expanded = `${expanded.slice(0, start)}${replacement}${expanded.slice(start + all.length)}`;
  }
  return expanded;
}

/**
 * 一条 padding／margin 的水平分量（docs/10 §9.8 两条内缩轴共用）。shorthand 按一至四值展开取左右两侧。
 * `0` 与 `auto` 都不算内缩——前者是复位，后者是配平。
 *
 * **先把 `var()` 换成浏览器实际会用到的那个值，再按空格切侧**：`var(--card-padding)` 这类
 * 「档位本身就是两值」的写法要拿 Token 定义拆开，`var(--某-hook, 7px 9px)` 这种带兜底的写法
 * 在 Token 没有生产者时要拿兜底拆开——反过来先切空格再把 `var(..., 7px 9px)` 的逗号后半个
 * 当独立值读，护栏会报出一个谁都没写过的数。2026-10-01 变异探针 `.nav-item` 改回旧写法时
 * 报的就是「实测 7px」（垂直那一格），而水平那一格是 9px。
 */
function horizontalPixelsOf(declarations: CssDeclaration[], declaration: CssDeclaration): number[] {
  const parts = expandVarTokens(declarations, declaration.value)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const sides: string[] = [];
  if (declaration.property === 'padding' || declaration.property === 'margin') {
    if (parts.length === 1) sides.push(parts[0] ?? '');
    else if (parts.length === 2 || parts.length === 3) sides.push(parts[1] ?? '');
    else if (parts.length >= 4) sides.push(parts[1] ?? '', parts[3] ?? '');
  } else if (/^padding-(left|right)$/.test(declaration.property)) {
    sides.push(parts[0] ?? '');
  } else if (/^margin-(left|right)$/.test(declaration.property)) {
    sides.push(parts[0] ?? '');
  } else {
    sides.push(...parts);
  }
  return sides
    .map((side) => resolvePixels(declarations, side))
    .filter((pixels): pixels is number => pixels !== undefined && pixels > 0);
}

/** docs/10 §8.3 点名的页面骨架类。`ViewContainer` 用 `view-container-${mode}` 拼出变体，
 *  静态扫描取不到，因此显式登记。 */
const SKELETON_CLASSES = [
  'page-body',
  'page-header',
  'page-header-actions',
  'page-header-leading',
  'page-intro',
  'page-toolbar',
  'scroll-region',
  'view-container',
  'view-container-grid',
  'view-container-list',
];

/**
 * 纵向堆叠**控件**的骨架容器（docs/10 §9.8）。只列真正装控件的容器：
 * 滚动区与列表行的垂直节奏分别来自版心区块的内距和行自身的 padding + 分隔线，
 * 一律要求 gap 反而会让分隔线脱离下一行，因此不进这份清单。
 */
const CONTROL_STACK_SELECTORS = ['.page-toolbar'];

describe('界面间距与骨架纪律', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');
  const grouped = new Map<string, Map<string, string>>();
  for (const declaration of declarations) {
    const properties = grouped.get(declaration.selector) ?? new Map<string, string>();
    properties.set(declaration.property, declaration.value);
    grouped.set(declaration.selector, properties);
  }

  it('装控件的骨架容器自带纵向间距机制', () => {
    const offenders: string[] = [];
    for (const selector of CONTROL_STACK_SELECTORS) {
      const properties = grouped.get(selector);
      if (!properties) {
        offenders.push(`${selector}（styles.css 里没有这条基类规则）`);
        continue;
      }
      const direction = properties.get('flex-direction') ?? '';
      const display = properties.get('display') ?? '';
      const stacks = direction.includes('column') || display === 'grid' || display === 'flex';
      if (!stacks || !(properties.has('gap') || properties.has('row-gap'))) {
        offenders.push(`${selector} { display: ${display}; flex-direction: ${direction} }`);
      }
    }
    expect(
      offenders,
      '骨架容器没有纵向堆叠机制，同排的控件会 0 间距贴死；间距归容器的 gap 管（docs/10 §9.8）',
    ).toEqual([]);
  });

  /**
   * `gap` 与 `margin` 是同一道缝的两个所有者，所以共用一把标尺。
   * 2026-09-26 那一轮只收了 `gap`，docs/10 §9.8 当时写下「margin 与 padding 属下一轮改造」；
   * 本轮收 `margin`（含负值：抵消也取档）。`padding` 的档位要连控件几何一起定，另走一轮。
   */
  it('间距只用标尺上的档位', () => {
    const SCALE = new Set([4, 8, 12, 16, 24, 32]);
    const SPACING_PROPERTIES = [
      'gap',
      'row-gap',
      'column-gap',
      'margin',
      'margin-top',
      'margin-right',
      'margin-bottom',
      'margin-left',
      'margin-block',
      'margin-block-start',
      'margin-block-end',
      'margin-inline',
      'margin-inline-start',
      'margin-inline-end',
    ];
    const offenders: string[] = [];
    for (const declaration of declarations) {
      if (!SPACING_PROPERTIES.includes(declaration.property)) continue;
      for (const match of declaration.value.matchAll(/(\d+(?:\.\d+)?)px/g)) {
        const pixels = Number(match[1]);
        if (pixels !== 0 && !SCALE.has(pixels)) offenders.push(locate(declaration, styles ?? ''));
      }
    }
    expect(
      offenders,
      '缝只允许 4 / 8 / 12 / 16 / 24 / 32px 档位；同一档差 1–3px 正是「看着不统一」的来源（docs/10 §9.8）',
    ).toEqual([]);
  });

  it('次要文本 small 有 12px 字号基线', () => {
    // `<small>` 的 UA 默认是 0.83em，父级 12–13px 时会掉到下限之下，
    // 而只扫显式声明的字号护栏抓不到「没写」这种情况，所以钉住基线本身。
    const baseline = declarations.find(
      (declaration) => declaration.selector === 'small' && declaration.property === 'font-size',
    );
    expect(baseline, '<small> 缺少全局字号基线（docs/10 §9.8）').toBeDefined();
    const pixels = resolvePixels(declarations, baseline?.value ?? '');
    expect(pixels, 'small 基线必须用 px、rem 或一个能解析成它们的档位 Token').toBeDefined();
    expect(pixels ?? 0, 'small 基线不得小于 12px').toBeGreaterThanOrEqual(12);
  });

  it('页面选择器不得替骨架容器补 gap', () => {
    // 类名要整段匹配：`.page-header-leading` 不是 `.page-header` 的覆写。
    const skeletonOf = (selector: string): string | undefined =>
      SKELETON_CLASSES.find((name) =>
        new RegExp(`\\.${name.replace(/-/gu, '\\-')}(?![\\w-])`).test(selector),
      );
    const offenders: string[] = [];
    for (const declaration of declarations) {
      if (!['gap', 'row-gap', 'column-gap'].includes(declaration.property)) continue;
      const skeleton = skeletonOf(declaration.selector);
      if (!skeleton || declaration.selector === `.${skeleton}`) continue;
      offenders.push(locate(declaration, styles ?? ''));
    }
    expect(
      offenders,
      '逐页给骨架补间距会留下「覆写一次才正常」的坑，机制要收回基类（docs/10 §9.8）',
    ).toEqual([]);
  });
});

/**
 * 允许自带 overlay 阴影的浮层表面（docs/10 §10.1）。这份基线**只许降不许升**：
 * 它记录的是「还没迁进基座的存量」，不是「允许继续这样写」。需要新浮层时先复用
 * `PopoverMenu`，或把待迁入的基座标注在 reason 里，而不是在这里加一行豁免。
 */
const OVERLAY_SHADOW_BASELINE = 3;
const OVERLAY_SURFACES: { readonly match: string; readonly reason: string }[] = [
  { match: '.popover-menu', reason: '菜单类浮层基座（ADR-0012）' },
  {
    match: '.modal-panel',
    reason: '模态与覆盖层基座（docs/10 §10.1）：确认框、模型抽屉、放映层、消息中心共用这一层外壳',
  },
  { match: '.toast', reason: '全局结果提示' },
];

describe('浮层基座纪律', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');

  it('overlay 阴影只允许出现在登记过的浮层表面，且存量只降不升', () => {
    const offenders: string[] = [];
    let current = 0;
    for (const declaration of declarations) {
      if (declaration.property !== 'box-shadow') continue;
      if (!declaration.value.includes('shadow-color-overlay')) continue;
      current += 1;
      if (OVERLAY_SURFACES.some((surface) => declaration.selector.includes(surface.match))) {
        continue;
      }
      offenders.push(locate(declaration, styles ?? ''));
    }
    expect(
      offenders,
      '要浮层就复用 PopoverMenu，别自造带阴影的 absolute 面板（docs/10 §10.1）',
    ).toEqual([]);
    expect(
      current,
      `overlay 阴影存量比基线 ${OVERLAY_SHADOW_BASELINE} 多了——白名单不是豁免清单`,
    ).toBeLessThanOrEqual(OVERLAY_SHADOW_BASELINE);
    expect(
      current,
      `存量已降到 ${current}，请把 OVERLAY_SHADOW_BASELINE 一并改小，别把已收口的缺陷留在基线里`,
    ).toBeGreaterThanOrEqual(OVERLAY_SHADOW_BASELINE);
  });

  it('菜单项不自带字号，由基座镜像触发控件', () => {
    const offenders: string[] = [];
    for (const declaration of declarations) {
      if (declaration.property !== 'font-size') continue;
      if (!declaration.selector.includes('.popover-menu-item')) continue;
      offenders.push(locate(declaration, styles ?? ''));
    }
    expect(
      offenders,
      '浮层字号跟随触发控件；写死会让菜单比自己的触发按钮还大（docs/10 §10.1）',
    ).toEqual([]);
  });

  it('菜单类浮层的层级必须高于模态', () => {
    // 模态里也有下拉（模型抽屉的「模型角色」）。层级倒挂时菜单被自己的面板盖住，
    // 看起来就是「点了没反应」——jsdom 算不出层叠，只能在档位表上锁死。
    const level = (token: string): number => {
      const found = declarations.find((declaration) => declaration.property === token);
      const value = Number(found?.value ?? Number.NaN);
      expect(Number.isFinite(value), `${token} 必须是数值档位`).toBe(true);
      return value;
    };
    expect(level('--z-popover')).toBeGreaterThan(level('--z-modal-backdrop'));
    expect(level('--z-popover-backdrop')).toBeGreaterThan(level('--z-modal-backdrop'));
  });

  it('文本提示的层级必须高于菜单类浮层', () => {
    // 提示可能从菜单项或模态里长出来；被自己的弹出处盖住就等于白弹。
    const level = (token: string): number => {
      const found = declarations.find((declaration) => declaration.property === token);
      const value = Number(found?.value ?? Number.NaN);
      expect(Number.isFinite(value), `${token} 必须是数值档位`).toBe(true);
      return value;
    };
    expect(level('--z-tooltip')).toBeGreaterThan(level('--z-popover'));
  });

  it('模态语义只有一处实现，页面不得再自写背板与 Esc', () => {
    // 四套并存的后果已经付过学费：`ModelEditorSheet` 只有 aria-modal 外壳、
    // 放映层自己写键盘、消息中心连 aria-expanded 都没有（docs/reviews/2026-09-26-ui-consistency.md §3.1）。
    // 判据是「写了一遍 dialog 语义，却没接基座」：接了 `Modal` 或 `useOverlaySemantics`
    // 的锚定覆盖层（消息中心留在触发器局部定位）不算自造。
    const owners = [
      'apps/desktop/src/renderer/src/components/Modal.tsx',
      'apps/desktop/src/renderer/src/components/PopoverMenu.tsx',
    ];
    const rendererFiles = pathsUnder('apps/desktop/src/renderer/').filter(
      (relative) =>
        /\.(tsx|ts)$/.test(relative) &&
        !relative.endsWith('.test.tsx') &&
        !relative.endsWith('.test.ts'),
    );
    const offenders: string[] = [];
    for (const relative of rendererFiles) {
      const body = read(relative);
      const bespoke: string[] = [];
      // 旧背板类是退役绊线：最可能把它写回来的正是基座自己，所以这条不吃 owners 豁免。
      if (/sheet-backdrop|dialog-backdrop/.test(body)) bespoke.push('引用已收编的旧背板类');
      if (!owners.includes(relative)) {
        const usesBase =
          body.includes('useOverlaySemantics') ||
          /from '.*\/Modal'/.test(body) ||
          /from '.*\/PopoverMenu'/.test(body);
        if (!usesBase && /role="dialog"|role="alertdialog"/.test(body))
          bespoke.push('自写 role=dialog');
        if (!usesBase && /aria-modal/.test(body)) bespoke.push('自写 aria-modal');
        if (!usesBase && /key === 'Escape'/.test(body)) bespoke.push('自写 Esc 处理');
      }
      if (bespoke.length > 0) offenders.push(`${relative}：${bespoke.join('、')}`);
    }
    expect(offenders, '模态与覆盖层请复用 Modal／useOverlaySemantics（docs/10 §10.1）').toEqual([]);
  });
});

/**
 * 表单控件与按钮基座的几何必须来自 Token；这些正则与迁移脚本保持同一套口径。
 * `.[\w-]*-input` 收尾的那一列收的是「类名即以 input 结尾」的输入框（工作空间选择器
 * 里的搜索框就是这么命名的）；`(?![\w-])` 让它不会误伤 `.artifact-input-card` 这类卡片。
 */
const CONTROL_SELECTOR =
  /(^|[,>\s])input\b|(^|[,>\s])select\b|(^|[,>\s])textarea\b|(^|[,>\s])\.[\w-]*-input(?![\w-])|\.field-select-trigger|\.btn\b|\.icon-button\b/;
/**
 * 勾选轴的盒几何由 `--control-check-size` 与 UA 决定；Composer 的任务输入有独立契约。
 * 只读 TextArea 仍归输入基座，hover/focus 不能成为另造几何的豁免；已退役的
 * workspace-row input 与 counted 旧原生输入选择器不保留空白授权。
 */
const CONTROL_EXEMPTIONS = /checkbox|\.composer textarea/;

/**
 * 勾选行（复选框与文字同排）不是「标签 + 控件」结构，保留自己的排版；
 * 新增条目要说明为什么它不算表单字段，否则应改用 Field。
 */
const CHECKBOX_ROW_LABEL_SELECTORS: { readonly match: string; readonly reason: string }[] = [
  { match: '.skill-trust-box label', reason: 'Skill 信任确认行：框在左、说明在右' },
];

/**
 * 已被基座收编的自造类：样式不得复活（Badge 收 chip、EmptyState 收占位、ListRow 收行几何、
 * SectionHeader 收区块头）。
 * 行类一律用 `(?![-\w])` 收尾——`\b` 在连字符处也算词边界，会把仍在用的
 * `.knowledge-card-select` 当成复活的 `.knowledge-card`。
 */
const RETIRED_UTILITY_CLASSES: {
  readonly pattern: RegExp;
  readonly name: string;
  readonly family:
    'action-bar' | 'badge' | 'borrow' | 'button' | 'empty' | 'heading' | 'nav' | 'row';
}[] = [
  { pattern: /\.memory-list-empty(?![-\w])/, name: '.memory-list-empty', family: 'empty' },
  /* === 按钮皮与页面级后代规则（ADR-0031：外观的唯一出口是 `Button`） === */
  { pattern: /\.primary-button(?![-\w])/, name: '.primary-button', family: 'button' },
  { pattern: /\.secondary-button(?![-\w])/, name: '.secondary-button', family: 'button' },
  { pattern: /\.text-button(?![-\w])/, name: '.text-button', family: 'button' },
  { pattern: /\.chip-button(?![-\w])/, name: '.chip-button', family: 'button' },
  { pattern: /\.quiet-button(?![-\w])/, name: '.quiet-button', family: 'button' },
  {
    pattern: /\.danger-confirm-button(?![-\w])/,
    name: '.danger-confirm-button',
    family: 'button',
  },
  {
    pattern: /\.knowledge-research-button(?![-\w])/,
    name: '.knowledge-research-button',
    family: 'button',
  },
  { pattern: /\.open-source-button(?![-\w])/, name: '.open-source-button', family: 'button' },
  { pattern: /\.knowledge-more-button(?![-\w])/, name: '.knowledge-more-button', family: 'button' },
  {
    pattern: /\.evidence-open-button(?![-\w])/,
    name: '.evidence-open-button',
    family: 'button',
  },
  { pattern: /\.back-button(?![-\w])/, name: '.back-button', family: 'button' },
  { pattern: /\.context-toggle(?![-\w])/, name: '.context-toggle', family: 'button' },
  { pattern: /\.notification-bell(?![-\w])/, name: '.notification-bell', family: 'button' },
  { pattern: /\.async-button(?![-\w])/, name: '.async-button', family: 'button' },
  { pattern: /\.examples button/, name: '.examples button', family: 'button' },
  {
    pattern: /\.skill-detail-section[^{]*button/,
    name: '.skill-detail-section :where(button)',
    family: 'button',
  },
  {
    pattern: /\.memory-conflict-actions button/,
    name: '.memory-conflict-actions button',
    family: 'button',
  },
  { pattern: /\.knowledge-search button/, name: '.knowledge-search button', family: 'button' },
  {
    pattern: /\.page-header-actions button/,
    name: '.page-header-actions button',
    family: 'button',
  },
  {
    pattern: /\.knowledge-admin-row[^{]*button/,
    name: '.knowledge-admin-row button:not(.switch)',
    family: 'button',
  },
  { pattern: /\.knowledge-issues button/, name: '.knowledge-issues button', family: 'button' },
  {
    pattern: /\.knowledge-detail-members button/,
    name: '.knowledge-detail-members button',
    family: 'button',
  },
  {
    pattern: /\.knowledge-detail-header button/,
    name: '.knowledge-detail-header button',
    family: 'button',
  },
  {
    pattern: /\.knowledge-detail-actions button/,
    name: '.knowledge-detail-actions button',
    family: 'button',
  },
  {
    pattern: /\.knowledge-revision-row button/,
    name: '.knowledge-revision-row button',
    family: 'button',
  },
  {
    pattern: /\.knowledge-detail-pager button/,
    name: '.knowledge-detail-pager button',
    family: 'button',
  },
  {
    pattern: /\.composer-footer button/,
    name: '.composer-footer button',
    family: 'button',
  },
  {
    pattern: /\.list-row-actions[^{]*button/,
    name: '.list-row-actions :where(button)',
    family: 'button',
  },
  {
    pattern: /\.appearance-modes button|\.scheme-grid button/,
    name: '.appearance-modes button／.scheme-grid button',
    family: 'button',
  },
  {
    pattern: /\.latest-message-control button/,
    name: '.latest-message-control button',
    family: 'button',
  },
  { pattern: /\.skill-chip(?![-\w])/, name: '.skill-chip', family: 'badge' },
  {
    pattern: /\.dependency-status-chip(?![-\w])/,
    name: '.dependency-status-chip',
    family: 'badge',
  },
  { pattern: /\.memory-status-badge(?![-\w])/, name: '.memory-status-badge', family: 'badge' },
  {
    pattern: /\.memory-(?:kind|state)(?![-\w])/,
    name: '.memory-kind／.memory-state（建议卡的状态片，已改 Badge）',
    family: 'badge',
  },
  {
    pattern: /\.connection-status(?![-\w])/,
    name: '.connection-status（按状态改字色的领域规则，已改 Badge 的 tone 档位）',
    family: 'badge',
  },
  {
    pattern: /\.knowledge-admin-switch(?![-\w])/,
    name: '.knowledge-admin-switch（原生 checkbox 冒充开关，已改 Switch）',
    family: 'badge',
  },
  {
    pattern: /\.knowledge-admin-switch(?![-\w])/,
    name: '.knowledge-admin-switch（名为 switch 实为 checkbox，已改 Switch 基座）',
    family: 'badge',
  },
  { pattern: /\.empty-runs(?![-\w])/, name: '.empty-runs', family: 'empty' },
  { pattern: /\.empty-models(?![-\w])/, name: '.empty-models', family: 'empty' },
  { pattern: /\.setting-placeholder(?![-\w])/, name: '.setting-placeholder', family: 'empty' },
  { pattern: /\.notification-empty(?![-\w])/, name: '.notification-empty', family: 'empty' },
  { pattern: /\.context-placeholder(?![-\w])/, name: '.context-placeholder', family: 'empty' },
  { pattern: /\.brief-empty(?![-\w])/, name: '.brief-empty', family: 'empty' },
  { pattern: /\.run-item(?![-\w])/, name: '.run-item', family: 'row' },
  { pattern: /\.notification-item(?![-\w])/, name: '.notification-item', family: 'row' },
  {
    pattern: /\.completed-work-card(?![-\w])/,
    name: '.completed-work-card',
    family: 'row',
  },
  { pattern: /\.skill-list-item(?![-\w])/, name: '.skill-list-item', family: 'row' },
  { pattern: /\.context-row(?![-\w])/, name: '.context-row', family: 'row' },
  {
    pattern: /\.brief-item-title(?![-\w])/,
    name: '.brief-item-title（简报行已改 ListRow）',
    family: 'row',
  },
  {
    pattern: /\.selected-material-row(?![-\w])/,
    name: '.selected-material-row（本次材料行已改 ListRow）',
    family: 'row',
  },
  {
    pattern: /\.suggestion-setting-row(?![-\w])/,
    name: '.suggestion-setting-row（自动建议开关行已改 ListRow）',
    family: 'row',
  },
  {
    pattern: /\.(?:capability|material|expert)-chip(?![-\w])/,
    name: '.capability-chip／.material-chip／.expert-chip（三套绑定片已合成 BindingChip）',
    family: 'row',
  },
  {
    pattern: /\.artifact-evidence-main(?![-\w])/,
    name: '.artifact-evidence-main（引用行已改 SourceRow／ListRow）',
    family: 'row',
  },
  {
    pattern: /\.artifact-evidence-list (?:article|b|div|span|small)(?![-\w])/,
    name: '.artifact-evidence-list 的 article／b／div／span／small 后代行几何',
    family: 'row',
  },
  {
    pattern: /\.model-(?:row|main|actions)(?![-\w])/,
    name: '.model-row／.model-main／.model-actions',
    family: 'row',
  },
  {
    pattern: /\.mcp-connection-(?:row|main)(?![-\w])/,
    name: '.mcp-connection-row／-main',
    family: 'row',
  },
  { pattern: /\.evidence-row(?![-\w])/, name: '.evidence-row', family: 'row' },
  {
    pattern: /\.knowledge-job-(?:row|actions)(?![-\w])/,
    name: '.knowledge-job-row／-actions',
    family: 'row',
  },
  {
    pattern: /\.knowledge-card(?:-(?:main|actions))?(?![-\w])/,
    name: '.knowledge-card／-main／-actions',
    family: 'row',
  },
  {
    pattern: /\.memory-(?:main|actions)(?![-\w])/,
    name: '.memory-main／.memory-actions',
    family: 'row',
  },
  { pattern: /\.settings-heading(?![-\w])/, name: '.settings-heading', family: 'heading' },
  {
    pattern: /\.memory-heading-actions(?![-\w])/,
    name: '.memory-heading-actions',
    family: 'heading',
  },
  {
    pattern: /\.selected-materials-(?:heading|actions)(?![-\w])/,
    name: '.selected-materials-heading／-actions',
    family: 'heading',
  },
  {
    pattern: /\.skill-(?:detail|section)-(?:heading|actions)(?![-\w])/,
    name: '.skill-detail-heading／-actions、.skill-section-heading',
    family: 'heading',
  },
  {
    pattern: /\.memory-group-heading(?![-\w])/,
    name: '.memory-group-heading',
    family: 'heading',
  },
  {
    pattern: /\.artifact-reference-(?:heading|actions)(?![-\w])/,
    name: '.artifact-reference-heading／-actions',
    family: 'heading',
  },
  {
    pattern: /\.notification-panel-(?:header|actions)(?![-\w])/,
    name: '.notification-panel-header／-actions',
    family: 'heading',
  },
  {
    pattern: /\.tool-detail-heading(?![-\w])/,
    name: '.tool-detail-heading',
    family: 'heading',
  },
  {
    pattern: /\.brief-section-head(?![-\w])/,
    name: '.brief-section-head',
    family: 'heading',
  },
  {
    pattern: /\.discussion-checkpoints-header(?![-\w])/,
    name: '.discussion-checkpoints-header',
    family: 'heading',
  },
  {
    pattern: /\.memory-editor-footer(?![-\w])/,
    name: '.memory-editor-footer',
    family: 'action-bar',
  },
  {
    pattern: /\.material-picker-actions(?![-\w])/,
    name: '.material-picker-actions',
    family: 'action-bar',
  },
  {
    pattern: /\.mcp-editor-actions(?![-\w])/,
    name: '.mcp-editor-actions',
    family: 'action-bar',
  },
  {
    pattern: /\.discussion-checkpoint-footer(?![-\w])/,
    name: '.discussion-checkpoint-footer',
    family: 'action-bar',
  },
  {
    pattern: /\.expert-editor-actions(?![-\w])/,
    name: '.expert-editor-actions',
    family: 'action-bar',
  },
  {
    pattern: /\.artifact-editor footer/,
    name: '.artifact-editor footer（含其 div 与 button 后代）',
    family: 'action-bar',
  },
  { pattern: /\.filter-bar(?![-\w])/, name: '.filter-bar', family: 'nav' },
  {
    pattern: /\.run-list(?![-\w])/,
    name: '.run-list（不分组的最近任务列已由工作空间分组接替，ADR-0029）',
    family: 'nav',
  },
  {
    pattern: /\.new-task(?![-\w])/,
    name: '.new-task（行几何已归 NavItem）',
    family: 'nav',
  },
  { pattern: /\.primary-nav button/, name: '.primary-nav button', family: 'nav' },
  { pattern: /\.settings-nav button/, name: '.settings-nav button', family: 'nav' },
  {
    pattern: /\.settings-nav-list button/,
    name: '.settings-nav-list button',
    family: 'nav',
  },
  {
    pattern: /\.(?:task-run-history|artifact-version-list) button/,
    name: '.task-run-history button／.artifact-version-list button',
    family: 'nav',
  },
  {
    pattern: /\.message-action(?![-\w])/,
    name: '.message-action（借用消息流的皮，实为 .text-button）',
    family: 'borrow',
  },
  {
    pattern: /\.expert-option(?:-list)?(?![-\w])/,
    name: '.expert-option／.expert-option-list（借用专家页的复选组，已收进 CheckList）',
    family: 'borrow',
  },
  {
    pattern: /\.selected-mcp-(?:list|connection)(?![-\w])/,
    name: '.selected-mcp-list／-connection（跨页借类，已收进 McpToolBindingsPicker）',
    family: 'borrow',
  },
];

/** 把 retired 清单变成一条断言：任一 CSS 文件里都不得再出现这些选择器。 */
function assertRetiredClassesAbsent(
  offenders: string[],
  family: 'action-bar' | 'badge' | 'borrow' | 'button' | 'empty' | 'heading' | 'nav' | 'row',
): void {
  const retired = RETIRED_UTILITY_CLASSES.filter((entry) => entry.family === family);
  for (const relative of cssPaths()) {
    for (const declaration of declarationsOf(relative)) {
      const hit = retired.find((entry) => entry.pattern.test(declaration.selector));
      if (hit) offenders.push(`${relative} → ${hit.name}`);
    }
  }
}

/**
 * 清单条目里「就是一个类名」的那一部分（`.chip-button(?![-\w])` → `chip-button`）。
 * 复合选择器（`.examples button`）不是 className，取不到就返回 `undefined`；
 * 没有 `(?![-\w])` 收尾的条目也跳过——它本来就会命中同类名前缀，不能当精确名字用。
 */
function singleRetiredClassName(pattern: RegExp): string | undefined {
  const match = /^\\\.([a-z][\w-]*)\(\?!/.exec(pattern.source);
  return match?.[1];
}

/**
 * 卡片外壳的唯一出口（docs/10 §10.1）。
 *
 * 五套自造外壳并轨之后，这两条锁的是「别再长回五套」：领域钩子类可以继续存在
 * （悬停显形、网格定位、色条），但不许再声明底、边框、圆角与内距；基座的槽位类
 * 也不许由页面手写——那等于绕过 `Card` 自己拼一份卡片骨架。
 */
describe('卡片外壳基座纪律', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');

  /** 那条共用规则本身：`padding`／`background`／`border`／`border-radius` 只有这一处。 */
  const SHARED_CARD_SHELL = /^\.card,\s*\.option-card,\s*\.list-row\[data-variant='card'\]$/;
  const CARD_HOOKS = /\.(?:skill|expert|suggestion|artifact-input|option)-card(?![-\w])/;
  const SHELL_PROPERTIES = ['padding', 'background', 'border', 'border-radius'];

  it('卡片外壳的四件套不得被领域钩子重新声明', () => {
    const offenders = declarations
      .filter((declaration) => SHELL_PROPERTIES.includes(declaration.property))
      .filter((declaration) => {
        const selector = declaration.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (SHARED_CARD_SHELL.test(selector)) return false;
        // 逗号分列的每一个选择器都命中卡片钩子，才算「又给卡片写了一遍外壳」。
        return selector.split(',').every((part) => CARD_HOOKS.test(part.trim()));
      })
      .map((declaration) => locate(declaration, styles ?? ''));
    expect(
      offenders,
      '卡片底、边框、圆角与内距归 .card 那条共用规则；要更紧或更松先改 --card-padding 或加变体（docs/10 §10.1）',
    ).toEqual([]);
  });

  it('基座的槽位类不得由页面手写', () => {
    const owners = [
      'apps/desktop/src/renderer/src/components/Card.tsx',
      'apps/desktop/src/renderer/src/components/ListRow.tsx',
    ];
    // 整词比对：`artifact-input-card-icon` 是成果输入卡留在行槽里的身份块钩子，
    // 不是基座的 `.card`，也不该被误判成「手写外壳」。
    const baseClasses = new Set([
      'card',
      'card-top',
      'card-main',
      'card-head',
      'card-mark',
      'card-names',
      'card-title',
      'card-byline',
      'card-description',
      'card-footer',
    ]);
    const offenders: string[] = [];
    for (const relative of pathsUnder('apps/desktop/src/renderer/')) {
      if (!/\.tsx$/.test(relative) || /\.test\.tsx$/.test(relative)) continue;
      if (owners.includes(relative)) continue;
      const source = read(relative);
      for (const match of source.matchAll(/className(?:=\{?)["'`]+([^"'`]*)["'`]/g)) {
        const hit = (match[1] ?? '').split(/[\s]+/).find((token) => baseClasses.has(token));
        if (hit) offenders.push(`${relative} → className="${match[1] ?? ''}"（命中基座类 ${hit}）`);
      }
    }
    expect(
      offenders,
      '请用 Card 的 leading／title／byline／description／footer 槽位，不要手排基座的骨架类（docs/10 §10.1）',
    ).toEqual([]);
  });
});

/**
 * 目录条目卡片的出口（docs/10 §10.1、[ADR-0032](../../docs/adr/0032-catalog-entry-card-facts.md)）。
 *
 * `Card` 管外壳，`CatalogCard`／`CatalogRow` 管「一条条目要交代的那几格」。这四条防的是
 * 同一件事再长回来：G4 把专家页的卡片抄到技能页时抄出两套 120 行同构装配，并在列表档
 * 漏掉署名那一格——因为那份内容清单当时只写在散文与注释里，没有类型也没有绊线。
 */
describe('目录条目卡片纪律', () => {
  const pairBase = 'apps/desktop/src/renderer/src/components/CatalogCard.tsx';
  const pairSource = read(pairBase);

  /** 手摆 `Card` 六槽的文件：配对件之外只剩一处结构特殊的卡，理由必须写在这里。 */
  const HAND_BUILT_CARD_FILES = [
    {
      file: 'apps/desktop/src/renderer/src/components/MemorySuggestionList.tsx',
      // 候选建议卡整块走 `children`，没有「身份块＋署名」这两格，套不进 EntryFacts 的必填五格。
      reason: '记忆候选卡的结构与目录条目不同形',
    },
  ];

  it('网格卡片只有配对件一个出口，不许页面再手摆 Card 的六槽', () => {
    const owners = [
      'apps/desktop/src/renderer/src/components/Card.tsx',
      pairBase,
      ...HAND_BUILT_CARD_FILES.map((entry) => entry.file),
    ];
    const offenders: string[] = [];
    for (const relative of productionPathsUnder('apps/desktop/src/renderer/src/')) {
      if (!relative.endsWith('.tsx') || owners.includes(relative)) continue;
      if (/<Card\b/.test(read(relative))) offenders.push(relative);
    }
    expect(
      offenders,
      '同一种数据的卡片与列表行必须走 CatalogCard／CatalogRow 的同一份事实；结构确实不同形的卡，先登记进 HAND_BUILT_CARD_FILES 并写理由（docs/10 §10.1）',
    ).toEqual([]);
  });

  it('行档永远不做整行按钮：右槽站着就地动作', () => {
    // R3-D 原话是「列表行是靠『右槽有按钮就撤掉整行点击区』这条人工约定维持的，没有基座
    // 表达」。这一条就是那件基座——`CatalogRow` 的入参里没有 onClick，实现里也不许出现它。
    const rowImplementation = pairSource.slice(pairSource.indexOf('export function CatalogRow'));
    expect(
      rowImplementation.length > 'export function CatalogRow'.length,
      '找不到 CatalogRow 的实现，本条护栏已空跑',
    ).toBe(true);
    expect(
      /onClick/.test(rowImplementation),
      '整行可点那一档要加在 ListRow 上（R3-D），不要在目录条目的行档里私搭（ADR-0032 §决策 4）',
    ).toBe(false);
  });

  it('一份事实的五格内容必填，不许为了省事放宽成可选', () => {
    // 放宽任何一格，就等于把「漏署名」那条路重新打开：技能列表档丢的那一格正是 byline。
    const required = ['mark', 'name', 'byline', 'description', 'actions'];
    const start = pairSource.indexOf('export interface EntryFacts');
    expect(start, '找不到 EntryFacts，本条护栏已空跑').toBeGreaterThan(-1);
    const body = pairSource.slice(start, pairSource.indexOf('\n}', start));
    // 先按「必填与可选两种写法都认」确认这一格解析得到，再判它是不是被改成了可选——
    // 反过来写，将来真有人放宽一格时报的会是「解析不出」这句空跑话，指错方向。
    for (const field of required) {
      expect(body, `EntryFacts 里解析不出 ${field}，本条护栏已空跑`).toMatch(
        new RegExp(`^\\s{2}${field}(?:\\?)?:`, 'mu'),
      );
    }
    const optional = required.filter((field) => new RegExp(`^\\s{2}${field}\\?:`, 'mu').test(body));
    expect(
      optional,
      'EntryFacts 的这五格是「一张卡片要能自我介绍」的内容底线，改成可选就是给漏格开门（ADR-0030 §决策 1）',
    ).toEqual([]);
  });

  it('行档的说明必须有截断出口：挂在 Tooltip 锚点上，样式给单行省略', () => {
    // 2026-09-30 光哥走查撞出来的：ADR-0032 写的是「行档单行省略」，而 `.list-row-detail`
    // 只有字号与颜色——长描述整段摊开，一屏列表一行一个高。话与对上实现之后，这条钉住
    // 「不再退回整段摊开」：换档、加档都不许把这一格的截断丢掉。
    expect(
      /detail=\{<Tooltip className="entry-row-description"/.test(pairSource),
      '行档的说明请走 Tooltip 锚点，长描述才有就地补全的出口（docs/10 §10.1）',
    ).toBe(true);
    const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
    const clamp = declarationsOf(styles ?? '').filter(
      (declaration) => declaration.selector.trim() === '.entry-row-description',
    );
    const byProperty = new Map(
      clamp.map((declaration) => [declaration.property, declaration.value]),
    );
    expect(byProperty.get('white-space'), '.entry-row-description 缺单行钳制').toBe('nowrap');
    expect(byProperty.get('text-overflow'), '.entry-row-description 缺省略号').toBe('ellipsis');
    expect(byProperty.get('overflow'), '.entry-row-description 缺 overflow: hidden').toBe('hidden');
  });

  it('卡片页脚与悬停显形的钩子不得从页面复活', () => {
    // `.expert-card-actions` 是死声明（卡片那排动作归 Card 的 footer 槽），
    // `.expert-card-summon` 被 `.card-primary` 取代：显形规则是卡片的视觉语言，不由页面点名。
    const retired = ['expert-card-actions', 'expert-card-summon'] as const;
    const offenders: string[] = [];
    for (const relative of cssPaths()) {
      for (const declaration of declarationsOf(relative)) {
        const selector = declaration.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim();
        const hit = retired.find((name) =>
          new RegExp(`(^|[\\s,>+~.])\\.${name}(?![-\\w])`).test(selector),
        );
        if (hit) offenders.push(`${relative} → .${hit}`);
      }
    }
    for (const relative of productionPathsUnder('apps/desktop/src/renderer/src/')) {
      if (!relative.endsWith('.tsx')) continue;
      const hit = retired.find((name) => read(relative).includes(name));
      if (hit) offenders.push(`${relative} → ${hit}`);
    }
    expect(
      offenders,
      '卡片页脚归 Card 的 footer 槽、主行动显形归 .card-primary；页面不再点名这两个钩子（docs/10 §10.1）',
    ).toEqual([]);
  });
});

/**
 * 折叠披露的出口（docs/10 §10.1）。
 *
 * 六处 `<details>` 并成 `Disclosure` 之后，要防的是同一件事再从两个方向长回来：页面手写
 * 一对 `details`／`summary`，或样式表替那一行补一遍几何。第二条锁 CSS 而不锁 tsx，是因为
 * 基座连元素名都不点名——只用 `.disclosure*` 三个类，读起来就知道这一行只有一份实现。
 */
describe('折叠披露基座纪律', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');

  /** 点名 `details`／`summary` 元素的选择器：元素名前面必须是选择器分隔符，不能误伤 `.context-details`。 */
  const DISCLOSURE_ELEMENT_SELECTOR = /(^|[\s,>+~(])details\b|(^|[\s,>+~(])summary\b/;

  /** 那一行自己的几何与排版：命中区、字号、颜色、标记与展开内容的缝。 */
  const DISCLOSURE_ROW_PROPERTIES = [
    'align-items',
    'color',
    'cursor',
    'display',
    'flex-direction',
    'font-size',
    'gap',
    'list-style',
    'min-height',
    'min-width',
    'overflow-wrap',
    'padding',
  ];

  /** 从 `<Disclosure className="…">` 上扫出领域钩子类：新增站点自动进这条锁的范围。 */
  function disclosureHookClasses(): string[] {
    const hooks = new Set<string>();
    for (const relative of pathsUnder('apps/desktop/src/renderer/')) {
      if (!/\.tsx$/.test(relative) || /\.test\.tsx$/.test(relative)) continue;
      const source = read(relative);
      for (const match of source.matchAll(/<Disclosure\b/g)) {
        const tag = source.slice(match.index ?? 0);
        const end = tag.indexOf('>');
        for (const className of tag
          .slice(0, end === -1 ? undefined : end)
          .matchAll(/className="([^"]+)"/g)) {
          for (const token of (className[1] ?? '').split(/\s+/)) {
            if (token) hooks.add(token);
          }
        }
      }
    }
    return [...hooks].sort();
  }

  it('生产代码不再手写 details／summary，一律走 Disclosure', () => {
    // 2026-09-28：六处各写一遍，其中「高级参数」的两条规则体逐字相同，命中区却有三种，
    // 展开态的强调色只有一处有。基座从此是唯一出口。
    const owner = 'apps/desktop/src/renderer/src/components/Disclosure.tsx';
    const offenders: string[] = [];
    for (const relative of pathsUnder('apps/desktop/src/renderer/')) {
      if (!/\.tsx$/.test(relative) || /\.test\.tsx$/.test(relative)) continue;
      if (relative === owner) continue;
      const source = read(relative);
      for (const match of source.matchAll(/<(?:details|summary)[\s>/]/g)) {
        const line = source.slice(0, match.index ?? 0).split('\n').length;
        offenders.push(`${relative}:${line} ${match[0].trim()}`);
      }
    }
    expect(
      offenders,
      '「点一行展开更多」请复用 Disclosure；要新的档位先给它理由（docs/10 §10.1）',
    ).toEqual([]);
  });

  it('样式表不再点名 details／summary 元素', () => {
    // 基座用类不用元素名，所以这条可以锁得干净：一旦出现 `.某面板 details { … }`，
    // 就说明有人在这一行外面又起了一套几何。
    const offenders = declarations
      .map((declaration) => ({
        declaration,
        selector: declaration.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
      }))
      .filter(({ selector }) => DISCLOSURE_ELEMENT_SELECTOR.test(selector))
      .map(({ declaration }) => locate(declaration, styles ?? ''));
    expect(
      offenders,
      '披露行归 .disclosure-label；页面不得再按元素名给它发外观（docs/10 §10.1）',
    ).toEqual([]);
  });

  it('披露行的几何只住在基座', () => {
    const hooks = disclosureHookClasses();
    expect(hooks.length, '一条领域钩子类都没扫到，这条护栏已经在空转').toBeGreaterThan(0);
    const offenders = declarations
      .map((declaration) => ({
        declaration,
        selector: declaration.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
      }))
      .filter(({ selector }) => {
        if (selector.includes('.disclosure')) return false;
        const parts = selector.split(',').map((part) => part.trim());
        // 逗号分列的每一个选择器都是「那一行本身」，才算重述行几何；
        // `.context-details > small` 这类后代规则管的是展开出来的内容，不在范围内。
        return parts.every((part) =>
          hooks.some((hook) => new RegExp(`^\\.${hook}(?![-\\w])(\\[[^\\]]*\\])?$`).test(part)),
        );
      })
      .filter(({ declaration }) => DISCLOSURE_ROW_PROPERTIES.includes(declaration.property))
      .map(({ declaration }) => locate(declaration, styles ?? ''));
    expect(
      offenders,
      '钩子类只留分隔线、位置与内容排版；命中区、字号与颜色改了请动基座（docs/10 §9.8）',
    ).toEqual([]);
  });
});

describe('表单字段基座纪律', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');

  it('下拉选择只有 FieldSelect 一处实现', () => {
    // 原生 <select> 的弹层由操作系统画，字号、圆角、暗色全部脱离主题 Token；
    // 它与基座并存过的结果是同一屏出现两种下拉外观（docs/reviews/2026-09-26-ui-consistency.md §3.2）。
    const rendererFiles = pathsUnder('apps/desktop/src/renderer/').filter((relative) =>
      /\.(tsx|ts)$/.test(relative),
    );
    const offenders = rendererFiles.filter((relative) =>
      /<select\b|<option\b/.test(read(relative)),
    );
    expect(
      offenders,
      '下拉请选择 FieldSelect；它走 PopoverMenu 基座，主题与键盘语义只有一份',
    ).toEqual([]);
  });

  it('表单字段的标签几何只住在 Field', () => {
    // 每个视图各写一份 `label { gap / margin / font-size }`，才有同一屏两种标签字号与两种缝。
    // 选择器文本里带着 CSS 注释，先剥掉再判，否则注释里提到 label 就会被误伤。
    const offenders: string[] = [];
    for (const declaration of declarations) {
      const selector = declaration.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (!/(^|[,>\s])label\b/.test(selector)) continue;
      if (
        !['gap', 'row-gap', 'margin', 'margin-top', 'margin-bottom'].includes(declaration.property)
      )
        continue;
      if (CHECKBOX_ROW_LABEL_SELECTORS.some((row) => selector.includes(row.match))) continue;
      offenders.push(locate(declaration, styles ?? ''));
    }
    expect(
      offenders,
      '标签与控件之间的缝归 Field；页面请改用 <Field>，别再加一条 label 规则（docs/10 §10.1）',
    ).toEqual([]);
  });
});

describe('输入控件基座纪律', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');

  /** 唯一允许写原生输入标签的两处：`TextField` 是出口，任务输入区的 textarea 归 `Composer`。 */
  const INPUT_BASE_FILES: readonly string[] = [
    'apps/desktop/src/renderer/src/components/TextField.tsx',
    'apps/desktop/src/renderer/src/components/Composer.tsx',
  ];
  /**
   * 留在原生上的只有勾选轴（docs/10 §10.1：布尔设置走 `Switch`，多选／全选留原生 `checkbox`）：
   * 方框由操作系统绘制，套上控件档位高度反而把它撑歪，而 `CheckList`／`SingleSelectPicker`
   * 已经把「勾了哪几个」与「这一档是不是当前档」各自包住。判据写在 `type` 上而不是文件清单上——
   * 新增一处勾选行不必改护栏，新增一个文本框则必须走基座。
   */
  const CHECK_AXIS_TYPES: readonly string[] = ['checkbox', 'radio'];
  /** 基座之外仍写输入控件外观的地方，按 selector＋属性登记，只降不升。 */
  const INPUT_APPEARANCE_EXCEPTIONS: readonly {
    readonly selector: string;
    readonly property: string;
    readonly reason: string;
  }[] = [
    {
      selector: '.memory-editor-counted > .text-field',
      property: 'padding-right',
      reason: '给绝对定位的码点角标腾出右缘，不是重述控件内距',
    },
  ];

  it('生产代码的输入控件只走 TextField／TextArea', () => {
    const offenders: string[] = [];
    for (const relative of productionPathsUnder('apps/desktop/src/renderer/')) {
      if (!relative.endsWith('.tsx') || INPUT_BASE_FILES.includes(relative)) continue;
      for (const tag of jsxOpenTags(read(relative), /^<(input|textarea)(?![\w-])/u)) {
        const type = /\btype="([^"]+)"/u.exec(tag.attrs)?.[1];
        if (tag.name === 'input' && type !== undefined && CHECK_AXIS_TYPES.includes(type)) continue;
        offenders.push(`${relative}:${tag.line} <${tag.name}${type ? ` type="${type}"` : ''}>`);
      }
    }
    expect(
      offenders,
      '输入控件请走 TextField／TextArea：高度与内距成对取档、底色与聚焦环只有一份；勾选与单选留原生并按 `type` 登记，任务输入区归 Composer（docs/10 §9.10、§10.1、ADR-0033 决策 10）',
    ).toEqual([]);
  });

  it('输入框的三档高度与内距成对，基座自己把字面交回档位', () => {
    // 只对齐高度不对齐内距，同排的输入框与按钮仍是一个饱满一个瘦（docs/10 §9.10）；
    // 「这一档没声明」比「这一档写错」更隐蔽——调用点写了 `size="lg"`，CSS 里没有它，
    // 于是静悄悄退成基座缺省。
    const steps: { step: string; height: string; padding: string }[] = [
      {
        step: 'sm',
        height: 'var(--control-height-sm)',
        padding: 'var(--control-padding-sm)',
      },
      { step: 'md', height: 'var(--control-height)', padding: 'var(--control-padding)' },
      {
        step: 'lg',
        height: 'var(--control-height-lg)',
        padding: 'var(--control-padding-lg)',
      },
    ];
    const offenders: string[] = [];
    for (const entry of steps) {
      const rules = declarations.filter(
        (declaration) =>
          declaration.selector.replace(/\s+/g, '') === `.text-field[data-size='${entry.step}']`,
      );
      if (rules.length === 0) {
        offenders.push(`data-size='${entry.step}' 没有声明——调用点写了这一档却什么都不会变`);
        continue;
      }
      for (const property of ['min-height', 'padding'] as const) {
        const actual = rules.find((rule) => rule.property === property)?.value;
        const expected = property === 'min-height' ? entry.height : entry.padding;
        if (actual !== expected) {
          offenders.push(
            `.text-field[data-size='${entry.step}'] 的 ${property} 应为 ${expected}，实际 ${actual ?? '缺失'}`,
          );
        }
      }
    }
    // 多行区没有档高：它的高度由 `rows` 与内容决定，基座里长出 `.text-area[data-size]`
    // 就是给一个没有档的轴配了档。
    if (
      declarations.some((declaration) =>
        /\.text-area\[data-size='\w+'\]/u.test(declaration.selector),
      )
    ) {
      offenders.push('.text-area 不接受 data-size 档位（docs/10 §9.13 输入框几何一行）');
    }
    // 基座本体必须自带字号、行高与表面四件套，且全部取档位：
    // 收编前那 30 条规则里字号跨三档、底色有四种、聚焦环有三种处置。
    const base = declarations.filter(
      (declaration) =>
        declaration.selector.replace(/\s+/g, ' ').trim() === '.text-field, .text-area',
    );
    expect(base.length, '找不到 .text-field, .text-area 基座声明，本条护栏已空跑').toBeGreaterThan(
      0,
    );
    const baseValue = (property: string): string | undefined =>
      base.find((declaration) => declaration.property === property)?.value;
    for (const [property, expected] of [
      ['font-size', 'var(--font-size-body)'],
      ['line-height', 'var(--line-height-normal)'],
      ['background', 'var(--surface)'],
      ['border', 'var(--control-border)'],
      ['border-radius', 'var(--control-radius)'],
    ] as const) {
      if (baseValue(property) !== expected) {
        offenders.push(
          `基座的 ${property} 应为 ${expected}，实际 ${baseValue(property) ?? '缺失'}`,
        );
      }
    }
    expect(
      offenders,
      '输入控件的几何只从 --control-height-* × --control-padding-* 成对取档，文字取 §9.13 档位（docs/10 §9.10、§9.13）',
    ).toEqual([]);
  });

  it('页面不得替输入控件发几何与外观', () => {
    // 收编前 37 个 `<input>` 的长相由 30 条逐处自写的 CSS 规则决定；基座立起来之后，
    // 这些属性再出现在钩子选择器上就是「第二处真相」，只是这次长得和基座一样。
    const owned = (property: string): boolean =>
      [
        'background',
        'border',
        'border-radius',
        'outline',
        'font-size',
        'font-family',
        'color',
      ].includes(property) ||
      property === 'padding' ||
      property.startsWith('padding-');
    const offenders: string[] = [];
    let exemptions = 0;
    for (const declaration of declarations) {
      const selector = declaration.selector.replace(/\s+/g, ' ').trim();
      if (!/\.(text-field|text-area)(?![\w-])/.test(selector)) continue;
      if (!owned(declaration.property)) continue;
      // 基座自己的选择器（含 `[data-size]`、`:focus-visible` 等状态档）说的就是这条契约。
      if (/^\.(text-field|text-area)(?![\w-])/.test(selector)) continue;
      const registered = INPUT_APPEARANCE_EXCEPTIONS.find(
        (entry) => entry.selector === selector && entry.property === declaration.property,
      );
      if (registered) {
        exemptions += 1;
        continue;
      }
      offenders.push(locate(declaration, styles ?? ''));
    }
    expect(
      exemptions,
      `输入控件外观的例外存量 ${exemptions} 处与清单 ${INPUT_APPEARANCE_EXCEPTIONS.length} 处不符——清单里不许留着已经改掉的`,
    ).toBe(INPUT_APPEARANCE_EXCEPTIONS.length);
    expect(
      offenders,
      '位置与尺寸留给领域钩子，底色、边框、圆角、内距与字号归 TextField／TextArea 基座（docs/10 §9.10、§10.1）',
    ).toEqual([]);
  });

  it('docs/10 的档位表与 styles.css 的 Token 两侧同值', () => {
    // 上面几条查的是「代码里有没有这一档」，这一条查的是「文档说的数是不是代码里那个数」：
    // 页面标题曾一处写 20px、另一处写 19px，两份都对得上自己的邻居，只有并排读才发现差 1px。
    const doc = read('docs/10-ui-ux-system.md');
    const root = new Map<string, string>();
    for (const declaration of declarations) {
      if (declaration.selector === ':root' && declaration.property.startsWith('--')) {
        root.set(declaration.property, declaration.value.replace(/\s+/g, ' ').trim());
      }
    }
    const normalize = (value: string): string =>
      value.replace(/`/g, '').replace(/\s+/g, ' ').trim();
    const offenders: string[] = [];
    let checked = 0;
    const compare = (token: string, documented: string): void => {
      const actual = root.get(token);
      if (actual === undefined) {
        offenders.push(`${token} 文档有档位、代码里没有定义`);
        return;
      }
      checked += 1;
      if (normalize(documented) !== actual) {
        offenders.push(`${token} 文档写 ${normalize(documented)}，styles.css 是 ${actual}`);
      }
    };

    const sectionOf = (from: string, to: string): string => {
      const start = doc.indexOf(from);
      expect(start, `docs/10 找不到小节「${from}」，本条护栏已空跑`).toBeGreaterThan(-1);
      const end = doc.indexOf(to, start);
      return doc.slice(start, end < 0 ? undefined : end);
    };

    // 表一：§9.10 的「| `--token` | 值 | 用在哪 |」。
    for (const line of sectionOf('### 9.10 控件几何与浮层字号', '### 9.11').split('\n')) {
      const row = /^\|\s*`(--[a-z0-9-]+)`\s*\|\s*([^|]+?)\s*\|/u.exec(line);
      if (!row) continue;
      compare(row[1] ?? '', row[2] ?? '');
    }

    // 表二：§9.13 的档位行。字号与行高写成「`名字` 值」的并排对，表面内距与标记方块
    // 把名字与值分在两格，按出现顺序并起来比。
    const ladder = sectionOf('### 9.13', '## 10. 组件体系');
    const pairRows: { label: string; prefix: string }[] = [
      { label: '字号', prefix: '--font-size-' },
      { label: '行高', prefix: '--line-height-' },
    ];
    const zippedRows: { label: string; values: RegExp }[] = [
      { label: '表面内距', values: /[\d.]+px/u },
      { label: '标记方块', values: /[\d.]+px/u },
    ];
    for (const entry of pairRows) {
      const row = ladder.split('\n').find((line) => line.startsWith(`| ${entry.label} |`));
      if (!row) {
        offenders.push(`§9.13 找不到「${entry.label}」那一行`);
        continue;
      }
      for (const pair of row.matchAll(/`([a-z][a-z-]*)`\s+(\d+(?:\.\d+)?)(px)?/gu)) {
        compare(`${entry.prefix}${pair[1] ?? ''}`, `${pair[2] ?? ''}${pair[3] ?? ''}`);
      }
    }
    for (const entry of zippedRows) {
      const row = ladder.split('\n').find((line) => line.startsWith(`| ${entry.label} |`));
      if (!row) {
        offenders.push(`§9.13 找不到「${entry.label}」那一行`);
        continue;
      }
      const cells = row.split('|').map((cell) => cell.trim());
      const tokens = [...(cells[2] ?? '').matchAll(/`(--[a-z-]+)`/gu)].map(
        (match) => match[1] ?? '',
      );
      const values = (cells[3] ?? '')
        .split('／')
        .map(
          (segment) => /^((?:[\d.]+(?:px|%)|0)(?:\s+(?:[\d.]+(?:px|%)|0))*)\s/u.exec(segment)?.[1],
        );
      if (tokens.length === 0 || tokens.length !== values.length || values.some((v) => !v)) {
        offenders.push(`§9.13「${entry.label}」一行的名字与值对不上，护栏读不出档位`);
        continue;
      }
      tokens.forEach((token, index) => compare(token, values[index] ?? ''));
    }
    expect(
      checked,
      `只比对到 ${checked} 条档位，两张表都没解析出来——本条护栏已空跑`,
    ).toBeGreaterThanOrEqual(25);
    expect(
      offenders,
      'docs/10 §9.10 与 §9.13 写的档值必须等于 styles.css `:root` 的 Token 值；调一档要同轮改两处（docs/10 §9.13、AGENTS.md §8）',
    ).toEqual([]);
  });
});

describe('页签与切换组纪律', () => {
  it('页签与切换按钮组的语义只住在 Tabs 基座', () => {
    // 两处页签各写一遍的后果是都没有 roving tabindex：键盘用户要按 Tab 一格一格穿过去。
    // 判据同模态护栏——写了这组属性却没接基座才算自造。
    const owner = 'apps/desktop/src/renderer/src/components/Tabs.tsx';
    const rendererFiles = pathsUnder('apps/desktop/src/renderer/').filter(
      (relative) =>
        /\.(tsx|ts)$/.test(relative) &&
        !relative.endsWith('.test.tsx') &&
        !relative.endsWith('.test.ts'),
    );
    const offenders: string[] = [];
    for (const relative of rendererFiles) {
      if (relative === owner) continue;
      const body = read(relative);
      if (!/role="tablist"|role="tab"|aria-selected|aria-pressed/.test(body)) continue;
      if (/from '.*\/Tabs'/.test(body)) continue;
      offenders.push(relative);
    }
    expect(offenders, '页签与切换按钮组请复用 Tabs／SegmentedControl（docs/10 §10.1）').toEqual([]);

    const styles = cssPaths().find((relative) => relative.endsWith('styles.css')) ?? '';
    const offendersCss = declarationsOf(styles)
      .filter((declaration) => /button\[aria-(selected|pressed)/.test(declaration.selector))
      .filter(
        (declaration) =>
          !declaration.selector.includes('.tabs') &&
          !declaration.selector.includes('.segmented-control'),
      )
      .map((declaration) => locate(declaration, styles));
    expect(
      offendersCss,
      '选中态样式归基座；页面再补一条 button[aria-selected] 就是第二套页签外观',
    ).toEqual([]);
  });
});

describe('界面观感基线', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');

  it('z-index 只允许取层级 Token', () => {
    const offenders = declarations
      .filter((declaration) => declaration.property === 'z-index')
      .filter((declaration) => !declaration.value.startsWith('var(--z-'));
    expect(
      offenders.map((declaration) => locate(declaration, styles ?? '')),
      '叠放层级要先进 :root 的 --z-* 档位表（docs/10 §9.11）',
    ).toEqual([]);
  });

  /**
   * 「一排次级动作」竖成一列、每颗按钮占满一整行，是 2026-09-28 专家详情页被抓到的同类错误，
   * 也是光哥明确点名「已经犯过无数次」的那一类（docs/10 §10.1）。动作条的宽度由内容决定，
   * 放不下才换行；真正的纵向清单（下拉菜单项）按白名单登记，它不是「一排动作」。
   * `@media` 里的重排不算：窄视口把一排动作折成列是 docs/10 认可的手段，不是设计失误。
   */
  it('动作条不得把一排就地按钮竖成一列', () => {
    const VERTICAL_MENUS = ['.workspace-selector-actions'];
    const offenders = declarations
      .filter((declaration) => declaration.property === 'flex-direction')
      .filter((declaration) => declaration.value === 'column')
      .filter((declaration) => !declaration.selector.startsWith('@media'))
      .filter((declaration) => /-actions\b/.test(declaration.selector))
      .filter((declaration) => !VERTICAL_MENUS.some((name) => declaration.selector.includes(name)))
      .map((declaration) => locate(declaration, styles ?? ''));
    expect(
      offenders,
      '一排就地动作必须横排、放不下才换行；竖成一列会让每颗按钮占满整行（docs/10 §9.8、§10.1）',
    ).toEqual([]);
  });

  /**
   * 焦点环必须画在控件自己的盒子里（docs/10 §9.10、ADR-0035）。
   *
   * 画在边框盒之外的任何一段都可被祖先的 `overflow` 裁掉，而「这一层会不会裁」写页面时
   * 预判不了：`overflow-y: auto` 会把 `overflow-x: visible` 强制成 `auto`，一个只打算纵向滚
   * 的容器就顺手把左右两段的环切了。2026-10-01 光哥发现记忆页搜索框聚焦后左右边框不见，
   * 扫出 `styles.css` 53 条 `overflow` 声明里至少 8 处吃到环，最重的 `.segmented-control`
   * 四边全被吃——Tab 上去根本没有焦点指示（WCAG 2.4.7 失败）。
   *
   * 同日二轮补上「浅到环宽以内也不算盒内」：环带是 `[-偏移, -偏移 + 环宽)`，`-1px` 配 2px
   * 的环仍有一半在盒外，取值由离屏 Electron 渲染逐像素量出（ADR-0035 第二轮的表）。
   */
  it('焦点环必须画在控件自己的盒子里', () => {
    const offsets = declarations.filter((d) => d.property === 'outline-offset');
    const offenders = offsets
      .filter((declaration) => declaration.value !== 'var(--focus-ring-offset)')
      .map((declaration) => locate(declaration, styles ?? ''));
    for (const declaration of declarations) {
      if (declaration.property !== 'outline') continue;
      if (!declaration.value.includes('--focus-ring')) continue;
      // 环宽与环色同口径：1px 的环在深色底上几乎看不见，各写各的宽就等于没有档。
      if (declaration.value === '2px solid var(--focus-ring)') continue;
      offenders.push(locate(declaration, styles ?? ''));
    }
    const token = declarations.filter(
      (declaration) =>
        declaration.selector === ':root' && declaration.property === '--focus-ring-offset',
    );
    expect(
      token,
      '找不到 :root 的 --focus-ring-offset 定义，本条护栏已空跑——偏移一旦不引用 Token，下面那条负值检查就是空的',
    ).toHaveLength(1);
    const value = token[0]?.value ?? '';
    if (!/^-\d+(\.\d+)?px$/u.test(value)) {
      offenders.push(`--focus-ring-offset 必须是负 px（画在盒内），styles.css 实际是 ${value}`);
    }
    /**
     * 「负值」不等于「在盒内」：环带是 [-偏移, -偏移 + 环宽)，`-1px` 配 2px 的环只有一半
     * 进盒，另一半照旧被贴边的滚动容器吃掉（2026-10-01 光哥量出记忆页搜索框的左右环比
     * 上下细一倍）。所以这一条按可达深度判，不按符号判。
     */
    const RING_SEAM = 1;
    const widths = [
      ...new Set(
        declarations
          .filter((d) => d.property === 'outline' && d.value.includes('--focus-ring'))
          .map((d) => Number.parseFloat(d.value))
          .filter((width) => Number.isFinite(width)),
      ),
    ];
    const reach = Math.abs(Number.parseFloat(value));
    const widest = Math.max(0, ...widths);
    if (Number.isFinite(reach) && widths.length > 0 && reach < widest + RING_SEAM) {
      offenders.push(
        `--focus-ring-offset 向内只走 ${reach}px，环宽 ${widest}px：环带跨在边框盒边线上，贴边的 overflow 仍能裁掉外侧那一段。盒内可达必须 ≥ 环宽 + ${RING_SEAM}px 分隔缝（ADR-0035 验证表）`,
      );
    }
    expect(
      offenders,
      'outline-offset 只能取 var(--focus-ring-offset)：正值或 0 把环推到盒外，祖先一裁就少一段（docs/10 §9.10、ADR-0035）',
    ).toEqual([]);
  });

  /**
   * 「带环就得带偏移」：漏写 `outline-offset` 不是「没有环」，而是环退回初始值 0、
   * 又跑到盒子外面去——正是本轮要消灭的那个形状，且不会有任何报错。
   */
  it('带焦点环的规则必须同时声明偏移', () => {
    const ringSelectors = new Set(
      declarations
        .filter((d) => d.property === 'outline' && d.value.includes('--focus-ring'))
        .map((d) => d.selector),
    );
    const offenders = [...ringSelectors]
      .filter(
        (selector) =>
          !declarations.some(
            (d) =>
              d.selector === selector &&
              d.property === 'outline-offset' &&
              d.value === 'var(--focus-ring-offset)',
          ),
      )
      .map((selector) => `${selector} { outline: 2px solid var(--focus-ring) } 缺 outline-offset`);
    expect(ringSelectors.size, 'styles.css 里一处焦点环都没有，本条护栏已空跑').toBeGreaterThan(0);
    expect(offenders, '环画在盒外 0px 处仍会被祖先裁掉，偏移必须与环同块出现（ADR-0035）').toEqual(
      [],
    );
  });

  /**
   * 「一种几何，五个出口」这句话必须能被计数（ADR-0035 后果第 2 条）。
   *
   * ADR-0034 写下「聚焦环只剩一处出口」时它并不成立，因为从来没人核过清单与存量是否等量。
   * 新增一个吃环的表面必须在这里写明它是谁、为什么落不到全局那条元素规则上——`summary` 就是
   * 一个走不通的例子：它被「样式表不再点名 details／summary 元素」挡在外面，所以环由
   * `.disclosure-label` 这个类承载。
   */
  it('焦点环的出口只有登记的那几处', () => {
    const RING_OUTLETS: readonly string[] = [
      // 宽表滚动区是可聚焦的 div，复用全局控件环，不新增一套环几何（docs/10 §8.3）。
      'button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, .markdown-table:focus-visible',
      '.disclosure-label:focus-visible',
      '.scroll-region:focus-visible',
      '.single-select-picker-option:has(input:focus-visible)',
      '.composer:has(textarea:focus-visible)',
    ];
    const outlets = [
      ...new Set(
        declarations
          .filter((d) => d.property === 'outline' && d.value.includes('--focus-ring'))
          .map((d) => d.selector),
      ),
    ].sort();
    expect(
      outlets,
      '环的出口与清单不等量：多出来的那条要么并进全局元素规则，要么在这里写明理由；少掉的那条就是文档在讲一件不存在的事（docs/10 §9.10、ADR-0035）',
    ).toEqual([...RING_OUTLETS].sort());
  });

  /**
   * 关掉环与搬走环的差别只在「有没有指名搬到哪」：`.composer textarea` 的 `outline: 0`
   * 是搬走（环由卡片承载），但它曾长期是「关掉」——ADR-0034 写下「聚焦环只剩一处出口」时，
   * 全仓最重要的输入区正被这一条摘掉焦点指示，而护栏看不见它。
   */
  it('关掉焦点环必须指名搬到哪', () => {
    const RING_SUPPRESSIONS: readonly { readonly selector: string; readonly carrier: string }[] = [
      {
        selector: '.composer textarea',
        carrier: '.composer:has(textarea:focus-visible)',
      },
    ];
    const ringSelectors = new Set(
      declarations
        .filter((d) => d.property === 'outline' && d.value.includes('--focus-ring'))
        .map((d) => d.selector),
    );
    const offenders: string[] = [];
    let exemptions = 0;
    for (const declaration of declarations) {
      if (declaration.property !== 'outline') continue;
      if (!/^0$/u.test(declaration.value) && !/^none$/u.test(declaration.value)) continue;
      const registered = RING_SUPPRESSIONS.find((entry) => entry.selector === declaration.selector);
      if (registered === undefined) {
        offenders.push(
          `${locate(declaration, styles ?? '')} 关掉了焦点环却没有承载者（docs/10 §9.10、ADR-0035）`,
        );
        continue;
      }
      if (!ringSelectors.has(registered.carrier)) {
        offenders.push(
          `${registered.selector} 的环登记为由 ${registered.carrier} 承载，样式表里却没有那条规则`,
        );
        continue;
      }
      exemptions += 1;
    }
    expect(
      exemptions,
      `搬走环的存量 ${exemptions} 处与清单 ${RING_SUPPRESSIONS.length} 处不符——清单里不许留着已经改掉的`,
    ).toBe(RING_SUPPRESSIONS.length);
    expect(offenders).toEqual([]);
  });

  /**
   * 「减少动效」不能照通行配方写成 `* { transition-duration: 0.01ms }`。
   * `animation-name` 的初始值是 `none`，设时长造不出动画；`transition-property` 的初始值却是
   * `all`，给 `*` 设非零时长等于替每一个没声明过渡的元素声明了「所有属性都动一会儿」——
   * 那条降级于是反过来**开启**了动效。2026-10-02 的焦点环就是这么坏的：`.markdown-table`
   * 没有任何 `transition` 声明，`outline-width`／`outline-offset`／`outline-color` 被拉进
   * 过渡，离屏窗口的时间线不推进，环永远停在聚焦前的 `3px / 0px / currentColor`
   * （ADR-0035「减动效反而把环冻住」）。同一条几何也解释了按钮为什么一直是绿的：
   * 按钮显式列了五个过渡属性，不含 outline。
   */
  it('全局动效降级只能关过渡、压动画，不得给 * 造出过渡', () => {
    const starScope = /(^|\s)\*(?::{1,2}[a-z-]+)?$/u;
    const globalDurations = declarations.filter(
      (declaration) =>
        declaration.property === 'transition-duration' && starScope.test(declaration.selector),
    );
    expect(
      globalDurations.filter((declaration) =>
        declaration.selector.includes('prefers-reduced-motion'),
      ),
      '找不到 prefers-reduced-motion 里的全局 transition-duration，本条护栏已空跑——降级不再全局处理，新增动效就得各自判（docs/12 §8）',
    ).toHaveLength(1);
    const offenders = globalDurations
      .filter((declaration) => Number.parseFloat(declaration.value) !== 0)
      .filter(
        (declaration) =>
          !declarations.some(
            (sibling) =>
              sibling.selector === declaration.selector &&
              sibling.property === 'transition-property',
          ),
      )
      .map((declaration) => locate(declaration, styles ?? ''));
    expect(
      offenders,
      '`transition-property` 的初始值是 all：给 * 设非零 transition-duration 会替所有元素造出过渡，本来不动的属性（含焦点环）也跟着动。降级只能取 0s，或同块把 transition-property 收到具体清单（ADR-0035）',
    ).toEqual([]);
  });

  /**
   * 控件几何只住在 Token 上：边框、圆角、高度与**内距**同一口径。
   * 内距此前没人管，于是「同为 32px 档」的按钮与输入框，文字离边框一个 6px 一个 9px——
   * 高度统一了观感仍不统一。`padding` 与 `height` 一起纳进来，档位见 styles.css 的
   * `--control-padding-*`（docs/10 §9.8）。
   */
  it('表单控件的边框、圆角、高度与内距来自控件 Token', () => {
    const raw = new RegExp(`^(border|border-radius|min-height|height|width|padding)$`);
    const offenders: string[] = [];
    for (const declaration of declarations) {
      if (!raw.test(declaration.property)) continue;
      if (!CONTROL_SELECTOR.test(declaration.selector)) continue;
      if (CONTROL_EXEMPTIONS.test(declaration.selector)) continue;
      if (declaration.value.startsWith('var(--control-')) continue;
      // 侧栏的行不是控件：图标按钮的 sm／row 档取行高，那是 --row-height-* 的口径。
      if (declaration.value.startsWith('var(--row-height')) continue;
      if (
        declaration.value === '0' ||
        declaration.value === 'none' ||
        declaration.value === 'auto'
      ) {
        continue;
      }
      if (declaration.property === 'border' && !declaration.value.startsWith('1px solid')) continue;
      // 填充式主行动按钮用透明边框保持盒几何与带边框控件一致，颜色由填充色负责。
      if (declaration.property === 'border' && declaration.value === '1px solid transparent') {
        continue;
      }
      // 宽度与高度只在写死 px 时才算偏离档位（`width: 100%` 是排版，不是几何档）。
      if (
        ['width', 'height', 'min-height'].includes(declaration.property) &&
        !/^\d+px$/.test(declaration.value)
      ) {
        continue;
      }
      // 多行文本框的 min-height 是「编辑区至少多高」，与单行控件档位不是一回事。
      if (declaration.property === 'min-height' && /textarea/.test(declaration.selector)) continue;
      offenders.push(locate(declaration, styles ?? ''));
    }
    expect(
      offenders,
      '控件几何要取 --control-* 档位；各视图各写一遍正是「界面看着不统一」的来源（docs/10 §9.8）',
    ).toEqual([]);
  });

  it('独立类选择器不得被拆成两处并写出冲突值', () => {
    // `.text-button` 曾被前后两条规则各写一半：后者覆盖高度与背景、前者留下边框，
    // 结果渲染成"带边框的 25px 小胶囊"，与类名表达的不是一回事，且没人报错。
    const seen = new Map<string, Map<string, Set<string>>>();
    for (const declaration of declarations) {
      if (!/^\.[a-z][\w-]*$/.test(declaration.selector)) continue;
      const properties = seen.get(declaration.selector) ?? new Map<string, Set<string>>();
      const values = properties.get(declaration.property) ?? new Set<string>();
      values.add(declaration.value);
      properties.set(declaration.property, values);
      seen.set(declaration.selector, properties);
    }
    const offenders: string[] = [];
    for (const [selector, properties] of seen) {
      for (const [property, values] of properties) {
        if (values.size > 1) {
          offenders.push(`${selector} { ${property}: ${[...values].join(' | ')} }`);
        }
      }
    }
    expect(
      offenders,
      '同一个类的一处定义要能读出它的全部外观；分散叠加会让最终值不属于任何一条规则（docs/10 §9.8）',
    ).toEqual([]);
  });
});

/**
 * 微标圆角例外：3–4px 的图形化小件不进档位表。**只许降不许升**，
 * 新增一条要写清为什么它不是 `--radius-*` 里的某一档。
 */
const MICRO_MARK_RADII: {
  readonly match: string;
  readonly value: string;
  readonly reason: string;
}[] = [
  { match: '.composer-footer kbd', value: '4px', reason: '键帽' },
  { match: '.mode-preview b', value: '4px', reason: '外观模式预览色板' },
  { match: '.scheme-preview i', value: '3px', reason: '色系预览色块' },
];

describe('徽标与档位纪律', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');

  /**
   * 登记在案的「名字像徽标但不是徽标」：这几片是**可交互的绑定片**（内含移除按钮或用途下拉）、
   * 整片就是按钮的活动条、未读数角标，或基座自己的皮类，都套不进 `Badge` 的只读状态语义。
   * 新增这一档必须写清为什么不能复用 Badge；R3-D 计划把三套「名称＋移除 ×」绑定片
   * 收成一个基座（审计 §13 新发现），届时它们从这张表里消失。
   */
  const NON_BADGE_CHIP_CLASSES: { readonly match: string; readonly reason: string }[] = [
    { match: '.badge', reason: 'Badge 基座自己' },
    { match: '.binding-chip', reason: 'BindingChip 基座自己：可移除的绑定片，不是只读状态' },
    { match: '.tool-pill', reason: '工具调用活动条：整片是按钮，选中态走 aria-expanded' },
    { match: '.notification-badge', reason: '未读数角标：图形化标识，Badge 文档明确排除' },
  ];

  it('只读状态片必须由 Badge 画', () => {
    // §4.3 P6：Badge 基座落地后，页面又长出 `.memory-kind`／`.tool-pill-status` 这类
    // 「自己的 padding＋圆角＋底色」的片。字色与文案随领域变是合理的，
    // 但**片的形状**再各写一遍就等于没有基座。
    // 判据是「片状外观三件套」，不是类名——所以只有名字像、外观不像的不会误伤。
    const propsByClass = new Map<string, Set<string>>();
    for (const declaration of declarations) {
      const selector = declaration.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim();
      for (const className of selector.match(/\.[\w-]+/gu) ?? []) {
        const seen = propsByClass.get(className) ?? new Set<string>();
        seen.add(declaration.property);
        propsByClass.set(className, seen);
      }
    }
    const offenders = [...propsByClass]
      .filter(
        ([className, props]) =>
          props.has('background') &&
          props.has('border-radius') &&
          props.has('padding') &&
          /(?:chip|badge|status|state|kind|pill)$/u.test(className) &&
          !NON_BADGE_CHIP_CLASSES.some((entry) => className === entry.match),
      )
      .map(([className]) => className);
    expect(
      offenders,
      '只读状态文字请用 Badge（tone × shape）；确实不是徽标的，按理由登记进 NON_BADGE_CHIP_CLASSES（docs/10 §10.1）',
    ).toEqual([]);
  });

  it('状态徽标不得再回到各页自造的 chip 类', () => {
    // §3.4 记着 6 套 chip 各写一遍的下场；Badge 基座落地后这些类的样式不得复活。
    const offenders: string[] = [];
    assertRetiredClassesAbsent(offenders, 'badge');
    expect(offenders, '状态徽标请复用 Badge（docs/10 §10.1）').toEqual([]);
  });

  it('密集高度与圆角只允许取档位', () => {
    // 24–40px 的裸高度与 3–12px 的裸圆角各写一遍，正是「看着不统一」的最后一层。
    const heightOffenders: string[] = [];
    const radiusOffenders: string[] = [];
    let microMarks = 0;
    for (const declaration of declarations) {
      const selector = declaration.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (declaration.property === 'min-height') {
        const pixels = parsePixels(declaration.value);
        if (pixels === undefined || pixels < 24 || pixels > 40) continue;
        if (
          !declaration.value.startsWith('var(--control-height') &&
          !declaration.value.startsWith('var(--row-height')
        ) {
          heightOffenders.push(locate(declaration, styles ?? ''));
        }
        continue;
      }
      if (declaration.property !== 'border-radius') continue;
      const value = declaration.value;
      if (
        value.startsWith('var(--radius-') ||
        value.startsWith('var(--control-radius') ||
        value === '0'
      )
        continue;
      if (
        MICRO_MARK_RADII.some((entry) => selector.includes(entry.match) && entry.value === value)
      ) {
        microMarks += 1;
        continue;
      }
      radiusOffenders.push(locate(declaration, styles ?? ''));
    }
    expect(
      heightOffenders,
      '24–40px 的高度必须取 --control-height*／--row-height* 档位（docs/10 §9.10）',
    ).toEqual([]);
    expect(radiusOffenders, '圆角必须取 --radius-* 档位；微标例外要登记理由').toEqual([]);
    expect(
      microMarks,
      `微标圆角存量 ${microMarks} 处，比清单 ${MICRO_MARK_RADII.length} 多——例外不是新增口`,
    ).toBeLessThanOrEqual(MICRO_MARK_RADII.length);
  });
  it('空态占位不得再回到各页自造的类', () => {
    // §2 记着 6 处内联占位绕开 EmptyState：同一个「这里还没有东西」有四种尺寸与配色。
    const offenders: string[] = [];
    assertRetiredClassesAbsent(offenders, 'empty');
    expect(offenders, '空态请复用 EmptyContext／EmptyNotice（docs/10 §10.1）').toEqual([]);
  });

  it('胶囊圆角只允许取档位', () => {
    const offenders = declarations
      .filter((declaration) => declaration.property === 'border-radius')
      .filter((declaration) => /(^|\D)999px/.test(declaration.value));
    expect(
      offenders.map((declaration) => locate(declaration, styles ?? '')),
      '胶囊一律 var(--radius-pill)；再写一遍 999px 就是第二个档位源（docs/10 §9.10）',
    ).toEqual([]);
  });
});

describe('列表行基座纪律', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');

  it('行几何不得再回到各页自造的类', () => {
    // §3.4 记着同一结构有 9 套 flex／gap／padding／圆角，差异全部来自各写一遍。
    const offenders: string[] = [];
    assertRetiredClassesAbsent(offenders, 'row');
    expect(offenders, '列表行请复用 ListRow 的槽位（docs/10 §10.1）').toEqual([]);
  });

  it('行的间距与内边距只由基座的选择器拥有', () => {
    // 基座收编后，页面最常见的回归是「这条行在我这里想紧一点」：用后代选择器替骨架
    // 补一遍 gap／padding，等于把第 10 套行几何写回来。
    // 例外是卡片外壳那一条：`.list-row[data-variant='card']` 与 `.card`／`.option-card`
    // 共用同一份内距，正是「一份几何两种视图」，不是页面替骨架补缝（docs/10 §10.1）。
    const SHARED_CARD_SHELL = /^\.card,\s*\.option-card,\s*\.list-row\[data-variant='card'\]$/;
    const offenders = declarations
      .map((declaration) => ({
        declaration,
        selector: declaration.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
      }))
      .filter(({ selector }) => {
        if (!selector.includes('.list-row')) return false;
        if (SHARED_CARD_SHELL.test(selector)) return false;
        // 基座自己的选择器：`.list-row` 本体、三个变体档与六个槽位类。
        return !/^\.list-row(?:-[a-z]+)?(?![-\w])/.test(selector);
      })
      .filter(
        ({ declaration }) =>
          declaration.property === 'gap' ||
          declaration.property === 'row-gap' ||
          declaration.property === 'column-gap' ||
          declaration.property === 'padding',
      )
      .map(({ declaration }) => locate(declaration, styles ?? ''));
    expect(
      offenders,
      '行的 gap／padding 归 ListRow；要更紧或更松先改档位或加变体，别在页面里补一遍（docs/10 §9.8）',
    ).toEqual([]);
  });

  it('留在行上的领域钩子不再自带几何', () => {
    // 迁进 ListRow 后，`.memory-row` 这样的名字还要承担状态外观（左侧状态条、降饱和），
    // `.suggestion-job-row` 只承担一层抬升底色。允许它们活着的前提是行骨架不从它们身上
    // 长回来——否则第 13 套行几何只是换了个入口。
    const ROW_HOOK_CLASSES = ['memory-row', 'suggestion-job-row'];
    const offenders = declarations
      .map((declaration) => ({
        declaration,
        selector: declaration.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
      }))
      .filter(
        ({ selector }) =>
          !selector.includes('.list-row') &&
          ROW_HOOK_CLASSES.some((hook) => new RegExp(`^\\.${hook}(?![-\\w])`).test(selector)),
      )
      .filter(({ declaration }) =>
        [
          'display',
          'gap',
          'row-gap',
          'column-gap',
          'padding',
          'align-items',
          'flex-direction',
          'border-bottom',
        ].includes(declaration.property),
      )
      .map(({ declaration }) => locate(declaration, styles ?? ''));
    expect(
      offenders,
      '行的 flex／gap／padding 归 ListRow；领域钩子类只保留状态表达（docs/10 §10.1）',
    ).toEqual([]);
  });
});

describe('区块头基座纪律', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');

  it('被 SectionHeader 收编的区块头类不得复活', () => {
    // §3.1 P1：同一句「标题＋说明＋右槽动作」有 13 个类名、26 处写法，`gap` 取遍 4／8／12／16／24
    // 五档，`display` 有 flex-row／column／grid 三种。差异没有一条来自业务。
    const offenders: string[] = [];
    assertRetiredClassesAbsent(offenders, 'heading');
    expect(offenders, '区块头请复用 SectionHeader 的槽位（docs/10 §10.1）').toEqual([]);
  });

  it('区块头的几何只由基座的选择器拥有', () => {
    // 收编后最常见的回归是替骨架再补一遍缝：`某面板 .section-header { gap }`。
    // 面板自己的内缩与分隔线写在传给基座的领域钩子类上（如 `.notification-panel-heading`），
    // 那条类名里没有 `.section-header`，因此不受本条约束（docs/10 §9.8）。
    const offenders = declarations
      .map((declaration) => ({
        declaration,
        selector: declaration.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
      }))
      .filter(({ selector }) => {
        if (!selector.includes('.section-header')) return false;
        // 基座自己的选择器：`.section-header` 本体、两个变体档与四个槽位类。
        return !/^\.section-header(?:-[a-z]+)?(?![-\w])/.test(selector);
      })
      .filter(({ declaration }) =>
        [
          'gap',
          'row-gap',
          'column-gap',
          'padding',
          'padding-top',
          'padding-bottom',
          'margin',
          'margin-top',
          'margin-bottom',
          'align-items',
          'justify-content',
        ].includes(declaration.property),
      )
      .map(({ declaration }) => locate(declaration, styles ?? ''));
    expect(
      offenders,
      '区块头的缝与内缩归 SectionHeader；要更紧或更松先加变体档，别在页面里补一遍（docs/10 §9.8）',
    ).toEqual([]);
  });

  it('区块头的结构只住在基座里', () => {
    // 页面手写 `section-header-text` 就是把第 14 份结构写回来：它拿不到 `data-variant`
    // 上的字号与 gap，只会得到一个名字对不上的空壳。
    const owner = 'apps/desktop/src/renderer/src/components/SectionHeader.tsx';
    const offenders = pathsUnder('apps/desktop/src/renderer/')
      .filter(
        (relative) =>
          /\.tsx$/.test(relative) && !/\.test\.tsx$/.test(relative) && relative !== owner,
      )
      .filter((relative) => /section-header(-\w+)?\b/.test(read(relative)));
    expect(
      offenders,
      '区块头请传 title／hint／eyebrow／actions，不要手排基座的槽位类（docs/10 §10.1）',
    ).toEqual([]);
  });

  it('生产代码不再手写标题标签，一律走 SectionHeader', () => {
    // 2026-09-28：同一件事此前有 16 处 `<h2>`／`<h3>`／`<h4>` 加 10 条容器后代规则，
    // 字号在 13／14／20／21 之间来回。基座的两档（panel 13、block 21）从此是唯一出口。
    const HEADING_OWNERS = new Set([
      'apps/desktop/src/renderer/src/components/SectionHeader.tsx',
      // 页面与空态的 h1 由它们自己的基座渲染。
      'apps/desktop/src/renderer/src/components/layout/PageHeader.tsx',
      'apps/desktop/src/renderer/src/components/EmptyState.tsx',
    ]);
    const HEADING_FILE_EXEMPTIONS: { readonly file: string; readonly reason: string }[] = [
      {
        file: 'apps/desktop/src/renderer/src/views/SettingsView.tsx',
        reason:
          '设置空间的 h1「偏好与能力」与二级导航同栏，是这一空间的标题带，不是页面区块头（docs/10 §8.3）',
      },
      {
        file: 'apps/desktop/src/renderer/src/components/Welcome.tsx',
        reason: '首屏 hero 用衬线品牌字形（28px Georgia／Kaiti），属品牌表达，套不进 13／21 两档',
      },
    ];
    const exempt = new Set(HEADING_FILE_EXEMPTIONS.map((entry) => entry.file));
    const offenders: string[] = [];
    for (const relative of pathsUnder('apps/desktop/src/renderer/')) {
      if (!/\.tsx$/.test(relative) || /\.test\.tsx$/.test(relative)) continue;
      if (HEADING_OWNERS.has(relative) || exempt.has(relative)) continue;
      const source = read(relative);
      const matches = source.matchAll(/<h[1-4][\s>/]/g);
      for (const match of matches) {
        const line = source.slice(0, match.index ?? 0).split('\n').length;
        offenders.push(`${relative}:${line} ${match[0].trim()}`);
      }
    }
    expect(
      offenders,
      '「小标题＋说明＋右槽动作」与浮层标题都归 SectionHeader；新增一档请先给它理由（docs/10 §10.1）',
    ).toEqual([]);
  });

  it('标题的外观只住在基座与登记过的表面里', () => {
    // 上一那条锁的是 tsx，这一条锁 CSS：只要允许 `.某面板 h3 { font-size }`，
    // 基座的档位就只是默认值，第二套字号总会自己长回来。
    const HEADING_APPEARANCE = [
      'font-size',
      'font-weight',
      'color',
      'line-height',
      'letter-spacing',
      'margin',
      'margin-top',
      'margin-bottom',
    ];
    const HEADING_RULE_OWNERS: { readonly match: RegExp; readonly reason: string }[] = [
      { match: /^\.section-header/, reason: 'SectionHeader 基座自己的两档' },
      { match: /^h1,\s*h2,\s*h3,\s*p$/, reason: 'UA 默认外边距归零，不是外观' },
      { match: /^\.page-header h1$/, reason: '页面标题带基座自己的坐标' },
      { match: /^\.empty-page h1$/, reason: '空态页基座自己的主标题' },
      { match: /^\.settings-nav-list h1$/, reason: '设置空间标题带（见上一条豁免的理由）' },
      { match: /^\.welcome h2$/, reason: '首屏品牌 hero 的衬线字形' },
      {
        match: /^\.markdown-preview h[1-6]/,
        reason: '用户成果正文的文档排版，受 §9 的 Artifact 不套主题约束，不是 UI 小节头',
      },
      {
        match: /^\.message\.assistant \.markdown-preview h[1-6]$/,
        reason: '同上：对话里的 Markdown 成果排版',
      },
    ];
    const offenders = declarations
      .filter((declaration) => /\bh[1-6]\b/.test(declaration.selector))
      .filter((declaration) => HEADING_APPEARANCE.includes(declaration.property))
      .filter((declaration) => {
        const selector = declaration.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim();
        return !HEADING_RULE_OWNERS.some((owner) => owner.match.test(selector));
      })
      .map((declaration) => locate(declaration, styles ?? ''));
    expect(
      offenders,
      '页面级后代标题规则会把基座档位变成默认值；层级请加进 SectionHeader 的变体或给它登记理由（docs/10 §10.1）',
    ).toEqual([]);
  });
});

/**
 * 芯片里的微移除按钮不是面板头那颗方块按钮：它的 10px 命中区属于整枚芯片
 * （图标＋名称＋×），塞进 IconButton 的 24／28px 方块会把芯片撑破。
 * R3-A 落 `CapabilityChip` 时随芯片一起收口（docs/reviews/2026-09-27-ui-reuse-audit.md §3.1 P7）。
 */
const ICON_BUTTON_EXEMPT_CLASSES = ['binding-chip-remove'];

describe('图标按钮与动作条纪律', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');

  /** `<button` 的开始标签到哪里结束：引号与 `{}` 里的 `>` 都不算（`onClick={() => x()}` 常有）。 */
  const endOfOpeningTag = (text: string, start: number): number => {
    let quote = '';
    let depth = 0;
    for (let index = start + 1; index < text.length; index += 1) {
      const char = text[index] ?? '';
      if (quote) {
        if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") quote = char;
      else if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0) return index;
    }
    return -1;
  };

  /** 按钮体里只剩下图标（或三元式里两个图标分支）时，它就是一个图标按钮。 */
  const iconOnlyBody = (body: string): boolean => {
    if (!/<[A-Z][A-Za-z0-9]*Icon\b/.test(body)) return false;
    const stripped = body
      .replace(/<span[^>]*aria-hidden[^>]*>[\s\S]*?<\/span>/g, '')
      .replace(/<\/?[A-Z][A-Za-z0-9]*Icon\b[^>]*>/g, '')
      .trim();
    if (stripped === '') return true;
    return /^\{[^'"]*\}$/.test(stripped) && !/[\u4e00-\u9fff]/.test(stripped);
  };

  it('图标即按钮的唯一实现是 IconButton', () => {
    // 只装一个图标的 `<button>`：可及名称、方块几何与命中区都得由基座负责。
    // 5 处各写一遍的结果是同一颗关闭按钮有 24／26／30px 三种边长与两种圆角（§3.1 P3）。
    const offenders: string[] = [];
    for (const relative of productionPathsUnder('apps/desktop/src/renderer/')) {
      if (!relative.endsWith('.tsx')) continue;
      const text = read(relative);
      for (const match of text.matchAll(/<button\b/g)) {
        const start = match.index ?? 0;
        const tagEnd = endOfOpeningTag(text, start);
        const bodyEnd = text.indexOf('</button>', tagEnd + 1);
        if (tagEnd < 0 || bodyEnd < 0) continue;
        const opening = text.slice(start, tagEnd + 1);
        if (ICON_BUTTON_EXEMPT_CLASSES.some((hook) => opening.includes(hook))) continue;
        if (!iconOnlyBody(text.slice(tagEnd + 1, bodyEnd))) continue;
        offenders.push(`${relative}:${text.slice(0, start).split('\n').length} 手搓图标按钮`);
      }
    }
    expect(
      offenders,
      '只放图标的按钮请用 IconButton：`aria-label` 与方块几何只有一份（docs/10 §10.1）',
    ).toEqual([]);
  });

  it('被动作条基座收编的类不得复活', () => {
    const offenders: string[] = [];
    assertRetiredClassesAbsent(offenders, 'action-bar');
    expect(offenders, '底部动作条请复用 ActionBar（docs/10 §10.1）').toEqual([]);
  });

  it('图标按钮与动作条的外观只由基座的选择器拥有', () => {
    // 页面想给某颗关闭按钮挪位置，请把钩子类传进 `className`（如 `.sidebar-collapse-button`
    // 只留 `margin-left: auto`），不要借 `.icon-button`／`.action-bar` 的名字改它的排布。
    const offenders = declarations
      .map((declaration) => ({
        declaration,
        selector: declaration.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
      }))
      .filter(({ selector }) => /\.(?:icon-button|action-bar)(?![-\w])/.test(selector))
      .filter(
        ({ selector }) =>
          !/^\.(?:icon-button|action-bar|action-bar-hint)(?![-\w])/.test(selector) &&
          !/^\.icon-button\[data-size/.test(selector) &&
          !/^\.action-bar-hint(?![-\w])/.test(selector),
      )
      .map(({ declaration }) => locate(declaration, styles ?? ''));
    expect(
      offenders,
      '`.icon-button`／`.action-bar` 的外观与排布只住在基座里（docs/10 §9.8）',
    ).toEqual([]);
  });

  it('留在图标按钮上的领域钩子不再自带方块', () => {
    // 这两个钩子允许带着自己那份皮（侧栏那颗要顶到行尾、能力选择器要带边框），
    // 但方块尺寸、居中与内边距必须回到基座——否则 24／26／28／30px 四种边长又长回来。
    const ICON_BUTTON_HOOKS: { readonly match: string; readonly reason: string }[] = [
      { match: 'sidebar-collapse-button', reason: '只留 `margin-left: auto` 这一条定位' },
      { match: 'capability-picker-trigger', reason: '只留带边框的皮：border／background／color' },
    ];
    const offenders = declarations
      .map((declaration) => ({
        declaration,
        selector: declaration.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
      }))
      .filter(({ selector }) =>
        ICON_BUTTON_HOOKS.some((hook) => new RegExp(`\\.${hook.match}(?![-\\w])`).test(selector)),
      )
      .filter(({ declaration }) =>
        [
          'display',
          'width',
          'height',
          'place-items',
          'align-items',
          'justify-content',
          'padding',
          'border-radius',
          'cursor',
        ].includes(declaration.property),
      )
      .map(({ declaration }) => locate(declaration, styles ?? ''));
    expect(
      offenders,
      '图标按钮的方块归 IconButton；钩子只带位置与自己那份皮（docs/10 §10.1）',
    ).toEqual([]);
  });
});

/**
 * 基座自己渲染 `<button>` 的文件：它们就是出口本身，不再回头套自己。
 * 新增一条要写清为什么这件事不能交给 `Button`。
 */
const BUTTON_BASE_FILES = [
  'apps/desktop/src/renderer/src/components/Button.tsx',
  'apps/desktop/src/renderer/src/components/Card.tsx',
  'apps/desktop/src/renderer/src/components/IconButton.tsx',
  'apps/desktop/src/renderer/src/components/ListRow.tsx',
  'apps/desktop/src/renderer/src/components/NavList.tsx',
  'apps/desktop/src/renderer/src/components/Tabs.tsx',
  'apps/desktop/src/renderer/src/components/FieldSelect.tsx',
  'apps/desktop/src/renderer/src/components/Switch.tsx',
  'apps/desktop/src/renderer/src/components/BindingChip.tsx',
];

/**
 * 「形态不是动作按钮」的裸 `<button>`：整片可点的卡片、下拉触发器、状态条与投放区。
 * 它们套不进 `Button` 的档位（卡片不吃控件高度、触发器的展开态由 `aria-expanded` 表达），
 * 但每一枚都要在这里带理由登记——不登记就是在基座外另造一套皮（ADR-0031）。
 */
const NON_ACTION_BUTTON_SHAPES: { readonly match: string; readonly reason: string }[] = [
  {
    match: 'option-card',
    reason: '外观预览的选择卡：取 --radius-card 与卡片底，不吃三档控件高度',
  },
  { match: 'toast-body', reason: '整条通知可点：它是消息行的活动区' },
  { match: 'tool-activity-toggle', reason: '工具活动条：整片是状态条，展开态走 aria-expanded' },
  { match: 'tool-pill', reason: '工具状态片：选中态由 aria-expanded 表达，不是按钮档' },
  { match: 'workspace-selector-trigger', reason: '工作空间下拉触发器：带搜索面板的复合浮层' },
  { match: 'workspace-selector-action', reason: '浮层里的菜单项：宽度由面板给，不是就地动作' },
  { match: 'workspace-folder-drop', reason: '文件夹投放区：可点，但首先是拖放目标' },
  { match: 'artifact-thumbnail-trigger', reason: '缩略图放大触发器：整片是图片，cursor: zoom-in' },
];

/** 由 `Button` 的 `variant`／`size`／`tone` 负责的外观属性，页面与容器都不许自己写。 */
const BUTTON_APPEARANCE_PROPERTIES = [
  'min-height',
  'padding',
  'padding-inline',
  'padding-block',
  'border',
  'border-color',
  'border-radius',
  'background',
  'color',
  'font-size',
  'font-weight',
];

/**
 * 允许自己给 `<button>` 发外观的**基座**选择器前缀：它们在管自己的槽位几何，
 * 不是页面替别人的控件补外观。`.list-row-actions :where(button)` 曾在这里，
 * ADR-0031 把它删了——行内动作从此一律由调用点写明档位。
 */
const BUTTON_BASE_OWNERS = [
  /^button\b/,
  /^\.btn\b/,
  /^\.tabs\b/,
  /^\.segmented-control\b/,
  /^\.list-row\b/,
  /^button\.list-row\b/,
];

/** 从 `export type X = 'a' | 'b';` 里取出成员，顺序无关。 */
function unionMembers(source: string, name: string): string[] {
  const block = new RegExp(`export type ${name} =([\\s\\S]*?);`).exec(source);
  if (!block) throw new Error(`找不到 export type ${name}`);
  return [...(block[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '').sort();
}

/**
 * 从 CSS 里取出 `.btn[...]` 上出现过的档位。只看含 `.btn` 的选择器，
 * 否则 `.icon-button[data-size='row']` 会把图标按钮的档位混进按钮的 `size` 集合。
 */
function cssDataSteps(
  declarations: readonly { readonly selector: string }[],
  attribute: string,
): string[] {
  const steps = declarations
    .filter((declaration) => /\.btn\b/.test(declaration.selector))
    .flatMap((declaration) => [
      ...declaration.selector.matchAll(new RegExp(`\\[data-${attribute}='([^']+)'`, 'g')),
    ])
    .map((match) => match[1] ?? '');
  return [...new Set(steps)].sort();
}

/**
 * 类型里有、CSS 里刻意没有的档位：`neutral` 就是三档带边框 variant 的默认颜色，
 * 「没有一条规则」本身就是它的实现。新增一条要写清为什么同理。
 */
const TONE_STEPS_WITHOUT_RULE = ['neutral'];

describe('按钮基座纪律', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');
  const buttonSource = read('apps/desktop/src/renderer/src/components/Button.tsx');

  it('被 Button 基座收编的皮与容器后代规则不得复活', () => {
    const offenders: string[] = [];
    assertRetiredClassesAbsent(offenders, 'button');
    expect(
      offenders,
      '按钮外观只由 Button 基座输出；旧皮类与 `.某容器 button` 请改成 `variant`／`size`（ADR-0031）',
    ).toEqual([]);
  });

  it('生产代码的按钮只有 Button／基座／登记过的形态三种来源', () => {
    // 裸 `<button>` 没有档位，外观只能靠容器后代或浏览器默认——上一轮 9 颗、这一轮
    // 又抓到 8 颗「容器上根本没有规则」的按钮，正是这种失效的现场（ADR-0031）。
    const offenders: string[] = [];
    for (const relative of productionPathsUnder('apps/desktop/src/renderer/')) {
      if (!relative.endsWith('.tsx') || BUTTON_BASE_FILES.includes(relative)) continue;
      const text = read(relative);
      for (const match of text.matchAll(/<button\b/g)) {
        const start = match.index ?? 0;
        const line = text.slice(0, start).split('\n').length;
        const tagEnd = text.indexOf('>', start);
        // 开始标签到第一个 `>` 足够看清它带的是哪一类；多行属性由 prettier 收在同行内。
        const head = text.slice(start, tagEnd < 0 ? undefined : tagEnd);
        if (NON_ACTION_BUTTON_SHAPES.some((shape) => head.includes(shape.match))) continue;
        offenders.push(`${relative}:${line} ${head.replace(/\s+/g, ' ').slice(0, 70)}`);
      }
    }
    expect(
      offenders,
      '动作按钮请用 Button（variant × size）；确实不是动作按钮的形态，按理由登记进 NON_ACTION_BUTTON_SHAPES（docs/10 §10.1、ADR-0031）',
    ).toEqual([]);
  });

  it('variant／size／tone 的档位集合与基座穷举相等', () => {
    // 多一档：CSS 写了档位但类型没有，页面永远传不到；
    // 少一档：类型能传但没有皮，按钮掉回 `.btn` 的裸壳——两边都不会有编译错误，
    // 只会等到人工走查时才发现某档按钮没样式。
    expect(cssDataSteps(declarations, 'variant'), '`variant` 档位与 ButtonVariant 不一致').toEqual(
      unionMembers(buttonSource, 'ButtonVariant'),
    );
    expect(cssDataSteps(declarations, 'size'), '`size` 档位与 ButtonSize 不一致').toEqual(
      unionMembers(buttonSource, 'ButtonSize'),
    );
    expect(
      cssDataSteps(declarations, 'tone'),
      '`tone` 档位与 ButtonTone 不一致（缺省档要登记进 TONE_STEPS_WITHOUT_RULE）',
    ).toEqual(
      unionMembers(buttonSource, 'ButtonTone').filter(
        (tone) => !TONE_STEPS_WITHOUT_RULE.includes(tone),
      ),
    );
  });

  it('每一档 size 的 min-height 都取自控件高度 Token', () => {
    const sizes = unionMembers(buttonSource, 'ButtonSize');
    const offenders: string[] = [];
    for (const size of sizes) {
      const rules = declarations.filter(
        (declaration) =>
          declaration.selector.replace(/\s+/g, '') === `.btn[data-size='${size}']` &&
          declaration.property === 'min-height',
      );
      if (rules.length === 0) {
        offenders.push(`size='${size}' 没有 min-height——这一档的高度不受 Token 约束`);
        continue;
      }
      if (!/--control-height(-sm|-lg)?\b/.test(rules[0]?.value ?? '')) {
        offenders.push(
          `size='${size}' 的 min-height 没有取 --control-height-*：${rules[0]?.value ?? ''}`,
        );
      }
    }
    expect(offenders, '三档高度必须全部来自 --control-*（docs/10 §9.10、ADR-0031）').toEqual([]);
  });

  it('容器后代不得替按钮发外观', () => {
    // `.某容器 button { padding / background }` 记的是「这颗按钮属于哪个页面」，
    // 不是「它是什么动作」：槽位结构一换就整片掉回浏览器默认，tsc 与 vitest 都不报。
    const offenders = declarations
      .filter((declaration) => {
        const selector = declaration.selector.replace(/\s+/g, ' ').trim();
        const stylesAButton =
          /(^|[,>\s(+])button(?![\w-])/.test(selector) || /(^|[,>\s])\.btn(?![\w-])/.test(selector);
        if (!stylesAButton) return false;
        if (BUTTON_BASE_OWNERS.some((owner) => owner.test(selector))) return false;
        return BUTTON_APPEARANCE_PROPERTIES.includes(declaration.property);
      })
      .map((declaration) => locate(declaration, styles ?? ''));
    expect(
      offenders,
      '按钮外观只由 Button 基座或基座自己的槽位选择器负责（docs/10 §10.1、ADR-0031）',
    ).toEqual([]);
  });
  /**
   * 一排动作的槽位清单（docs/10 §9.10「动作排」）。
   *
   * 上一轮把同档规则写在 `ActionBar` 这个**组件名**上，代价是契约只管得住 8 排里的
   * 1 排：页头那一排——专家页「新建专家」36px 挨着技能页「导入 Skill」32px——
   * 从来不在任何约束里，而它恰恰是最显眼的一排。契约的单位应该是
   * 「并排摆放的一排控件」，所以这里列的是**槽位**而不是组件。
   * 新增一种「一排」必须先加进这张表，否则护栏对它是盲的。
   * ADR-0031 第六条那条写在组件名上的旧断言已删——它管的每一排都在这里，
   * 留着就是同一份契约的两处实现，弱的那一处还会给人「已经查过了」的错觉。
   */
  const ACTION_ROW_SLOTS: readonly { readonly owner: string; readonly slot: string }[] = [
    { owner: 'ActionBar', slot: 'children' },
    { owner: 'PageToolbar', slot: 'children' },
    { owner: 'PageHeader', slot: 'leading' },
    { owner: 'PageHeader', slot: 'actions' },
    { owner: 'SectionHeader', slot: 'actions' },
    { owner: 'Card', slot: 'footer' },
    { owner: 'ListRow', slot: 'actions' },
  ];

  /** 文字／输入控件共用的高度档，对应 `--control-height-sm`／``／`-lg`。 */
  const CONTROL_HEIGHT_STEPS: Record<string, number> = { sm: 28, md: 32, lg: 36 };
  /**
   * 图标按钮走自己的**命中区轴**（方块 23／28／34，见 docs/10 §10.1）：
   * 它不是与文字按钮等高的控件，不参与等高要求，但同排的图标之间不得各选各的。
   */
  const ICON_HIT_STEPS: Record<string, number> = { sm: 23, md: 28, row: 34 };
  /**
   * 这些外壳内部自成一排（模态里的动作条、浮层菜单、输入区），出现在槽位里时
   * 整条槽位跳过——它们各自的排由自己的槽位被检查。登记的取舍：这样会漏掉
   * 「页头槽位里直接写模态」的写法，但那种写法本身没有一排并排的语义。
   */
  const ROW_SCOPE_BREAKS = ['Modal', 'PopoverMenu', 'ConfirmationDialog', 'Composer'];

  interface RowControl {
    /** 命中区／高度档的字面值（`sm`／`md`／`lg`／`row`）。 */
    step: string;
    /** 该控件属于哪一档：图标按钮单列，其余走高度档。 */
    axis: 'control' | 'icon';
    /** 调用点是否省略了 `size`（省略即隐式 `md`，仍然算一档）。 */
    implicit: boolean;
    label: string;
  }

  /** 控件 → 档位。返回 undefined 表示这一排不管它（纯容器、图标本身等）。 */
  function rowControlOf(tag: { name: string; attrs: string }): RowControl | undefined {
    const explicit = /\bsize="(\w+)"/.exec(tag.attrs)?.[1];
    if (tag.name === 'Button' || tag.name === 'AsyncButton') {
      return {
        step: explicit ?? 'md',
        axis: 'control',
        implicit: explicit === undefined,
        label: `${tag.name}·${/\bvariant="(\w+)"/.exec(tag.attrs)?.[1] ?? '缺省'}·${explicit ?? '隐式md'}`,
      };
    }
    if (tag.name === 'IconButton') {
      return {
        // 隐式档是基座那一格 28px（CSS 里没有 `[data-size='md']` 覆写），不是 `sm`；
        // 写成 `sm` 会让「一颗隐式、一颗显式 sm」这一组真落差（28 与 23）被判成同档。
        step: explicit ?? 'md',
        axis: 'icon',
        implicit: explicit === undefined,
        label: `IconButton·${explicit ?? '隐式md'}`,
      };
    }
    if (tag.name === 'SegmentedControl' || tag.name === 'Tabs' || tag.name === 'FieldSelect') {
      return {
        step: explicit ?? 'md',
        axis: 'control',
        implicit: explicit === undefined,
        label: `${tag.name}·${explicit ?? '隐式md'}`,
      };
    }
    // `TextField` 与按钮共用同一张「高度 × 内距」档位表（docs/10 §9.10、ADR-0033 决策 10）：
    // 搜索框挨着「搜索」按钮排时，它矮一档那一排就还是不齐。
    // `TextArea` 不在这一轴上——它的高度由 `rows` 与内容决定，没有档可取，不参与比较。
    if (tag.name === 'TextField') {
      return {
        step: explicit ?? 'md',
        axis: 'control',
        implicit: explicit === undefined,
        label: `TextField·${explicit ?? '隐式md'}`,
      };
    }
    return undefined;
  }

  /** 花括号配平：返回与 `openIndex` 处 `{` 相配的 `}` 下标。 */
  function matchingBrace(text: string, openIndex: number): number {
    let depth = 0;
    for (let cursor = openIndex; cursor < text.length; cursor += 1) {
      if (text[cursor] === '{') depth += 1;
      else if (text[cursor] === '}') {
        depth -= 1;
        if (depth === 0) return cursor;
      }
    }
    return text.length;
  }

  function controlsInRow(block: string): RowControl[] {
    const controls: RowControl[] = [];
    for (let cursor = 0; cursor < block.length; cursor += 1) {
      if (block[cursor] !== '<') continue;
      const tag = jsxOpenTag(block, cursor);
      if (!tag) continue;
      cursor = tag.end;
      const control = rowControlOf(tag);
      if (control) controls.push(control);
    }
    return controls;
  }

  /**
   * 元素 `>` 之后到配对的 `</owner>` 为止的子区段（隐式 children 槽）。
   *
   * 两个模式都必须锚定在 `cursor` 上。不锚定时 `closePattern.test(rest)` 是拿**整段余文**
   * 去匹配，第一个子元素的收尾标签就被当成外层收尾，区段于是截断在半句上——护栏只查到
   * 「这一排只有一个控件」，同排混档与省略档位都看不见（2026-10-01 变异验证抓到：
   * 把专家修订页的「保存修订」改回 `lg` 而门禁仍绿）。
   */
  function childrenRegion(text: string, owner: string, tagEnd: number): string {
    const openPattern = new RegExp(`^<${owner}(?![\\w-])`);
    const closePattern = new RegExp(`^</${owner}>`);
    let depth = 0;
    let cursor = tagEnd + 1;
    while (cursor < text.length) {
      const rest = text.slice(cursor);
      if (closePattern.test(rest)) {
        if (depth === 0) return text.slice(tagEnd + 1, cursor);
        depth -= 1;
        cursor += owner.length + 3;
        continue;
      }
      if (openPattern.test(rest)) {
        const nested = jsxOpenTag(text, cursor);
        if (nested && !nested.selfClosing) depth += 1;
        cursor = (nested?.end ?? cursor) + 1;
        continue;
      }
      cursor += 1;
    }
    return '';
  }

  it('一排动作里的控件必须同档（动作排纪律）', () => {
    // 这条护栏是本轮治理的核心补丁：「没写 size」与「不是 ActionBar 的那一排」
    // 两处都不查，就会出现「89 颗按钮里 6 颗省略 size，其中 4 颗是主按钮」
    // 以及「lg 主行动挨着 md 次级行动」这种没人报错的混排。
    const offenders: string[] = [];
    for (const relative of productionPathsUnder('apps/desktop/src/renderer/')) {
      if (!relative.endsWith('.tsx')) continue;
      const text = read(relative);
      for (const row of ACTION_ROW_SLOTS) {
        for (const match of text.matchAll(new RegExp(`<${row.owner}(?![\\w-])`, 'g'))) {
          const start = match.index ?? 0;
          const tag = jsxOpenTag(text, start);
          if (!tag) continue;
          const rawTag = text.slice(start, tag.end + 1);
          let block: string;
          if (row.slot === 'children') {
            if (tag.selfClosing) continue;
            block = childrenRegion(text, row.owner, tag.end);
          } else {
            const slot = new RegExp(`\\b${row.slot}=\\{`).exec(rawTag);
            if (!slot) continue;
            const openIndex = start + (slot.index ?? 0) + row.slot.length + 1;
            block = text.slice(openIndex + 1, matchingBrace(text, openIndex));
          }
          const line = text.slice(0, start).split('\n').length;
          // 外壳内部自成排（模态里的 ActionBar），那一排由它自己的槽位被查到。
          if (ROW_SCOPE_BREAKS.some((name) => new RegExp(`<${name}(?![\\w-])`).test(block)))
            continue;
          const controls = controlsInRow(block);
          if (controls.length < 2) continue;
          const stepOf = (control: RowControl): number =>
            (control.axis === 'icon' ? ICON_HIT_STEPS : CONTROL_HEIGHT_STEPS)[control.step] ?? -1;
          for (const axis of ['control', 'icon'] as const) {
            const group = controls.filter((control) => control.axis === axis);
            if (group.length < 2) continue;
            const distinct = [...new Set(group.map(stepOf))];
            if (distinct.length > 1) {
              offenders.push(
                `${relative}:${line} ${row.owner}.${row.slot} 一排出现 ${group
                  .map((control) => control.label)
                  .join(' | ')}（高度 ${distinct.join('／')}px）`,
              );
            }
            const omitted = group
              .filter((control) => control.implicit)
              .map((control) => control.label);
            if (omitted.length > 0) {
              offenders.push(
                `${relative}:${line} ${row.owner}.${row.slot} 省略 size：${omitted.join('、')}`,
              );
            }
          }
        }
      }
    }
    expect(
      offenders,
      '一排动作是一个契约单位：同排控件取同一档，`size` 必须写明（docs/10 §9.10「动作排」）',
    ).toEqual([]);
  });

  it('控件基座的 size 是必填属性，不得有隐式缺省', () => {
    // `size?: ButtonSize` ＋ `size = 'md'` 的组合让「不写」成为第三种高度：
    // 它不会编译失败、不会测试失败，只会让同一排里的两颗按钮差 4px。
    // `IconButton` 在同一张榜上：它的隐式档是命中区的 `md`（28px），
    // 隐式与显式混在一排里就是「一颗 23、一颗 28」，而它此前确实有 12 处没写。
    const requiredOn: readonly string[] = [
      'apps/desktop/src/renderer/src/components/Button.tsx',
      'apps/desktop/src/renderer/src/components/AsyncButton.tsx',
      'apps/desktop/src/renderer/src/components/Tabs.tsx',
      'apps/desktop/src/renderer/src/components/FieldSelect.tsx',
      'apps/desktop/src/renderer/src/components/IconButton.tsx',
      'apps/desktop/src/renderer/src/components/TextField.tsx',
    ];
    const offenders: string[] = [];
    for (const relative of requiredOn) {
      const source = read(relative);
      // 属性声明必须是不带 `?` 的 `size: …`。
      if (!/\n {2}size: (ButtonSize|ControlSize|IconButtonSize);/.test(source)) {
        offenders.push(`${relative} 的 size 不是必填属性`);
      }
      // 解构里也不得再给缺省值。
      if (/\bsize\s*=\s*'(sm|md|lg|row)'/.test(source)) {
        offenders.push(`${relative} 的 size 仍带隐式缺省值`);
      }
    }
    // 高度三档的 CSS 出口必须齐：`data-size` 少一档，那一档就会退成基座缺省。
    // `.icon-button` 除外——它走自己的命中区轴 23／28／34（`sm`／基座／`row`），
    // 与文字按钮等高不是它的契约（docs/10 §9.10「动作排」）。
    const cssSizes = new Set(
      declarations
        .filter(
          (declaration) =>
            !declaration.selector.includes('.icon-button') &&
            /\[data-size='(\w+)'\]/.test(declaration.selector),
        )
        .map((declaration) => /\[data-size='(\w+)'\]/.exec(declaration.selector)?.[1]),
    );
    expect([...cssSizes].sort(), 'CSS 的 data-size 档位必须与三档一致').toEqual(['lg', 'md', 'sm']);
    const iconSizes = new Set(
      declarations
        .filter((declaration) => /\.icon-button\[data-size='(\w+)'\]/.test(declaration.selector))
        .map((declaration) => /\.icon-button\[data-size='(\w+)'\]/.exec(declaration.selector)?.[1]),
    );
    expect([...iconSizes].sort(), '图标方块的命中区只有 sm 与 row 两档覆写').toEqual(['row', 'sm']);
    expect(
      offenders,
      '按钮与同排控件的高度只能由调用点写明；缺省值会造出「隐式 md」这一档（docs/10 §9.10）',
    ).toEqual([]);
  });
});

describe('导航列表纪律', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');

  /** 基座自己渲染 `' active'` 高亮（键盘项），它的类名与状态词不算自造选中态。 */
  const NAV_BASE_FILES = ['apps/desktop/src/renderer/src/components/PopoverMenu.tsx'];

  it('选中态不得再用一个 `.active` 类表达', () => {
    // §3.1 P10：CSS 类不是 ARIA。用 `className={当前 ? 'active' : ''}` 表达「这是当前项」，
    // 读屏听到的就是一串没有状态的按钮；键盘 Tab 序里也看不出自己在哪。
    // 现在这一族有 `NavList`（`aria-current`）与 `ListRow selected` 两条正路。
    const offenders: string[] = [];
    for (const relative of productionPathsUnder('apps/desktop/src/renderer/')) {
      if (!relative.endsWith('.tsx') || NAV_BASE_FILES.includes(relative)) continue;
      const text = read(relative);
      for (const match of text.matchAll(/className=/g)) {
        const start = match.index ?? 0;
        const lineEnd = text.indexOf('\n', start);
        // 只看 className 的值本身：同一行后面常有领域值恰好也叫 'active'（专家生命周期），
        // 那不是选中态类，把它算进来就是误伤。
        const after = text
          .slice(start, lineEnd < 0 ? undefined : lineEnd)
          .split(/\son[A-Z]\w*=|\stype=|\saria-\w+=|>/u)[0];
        if (!/\bactive\b/.test(after ?? '')) continue;
        const line = text.slice(0, start).split('\n').length;
        offenders.push(
          `${relative}:${line} ${(text.slice(start, lineEnd).match(/.{0,60}/u)?.[0] ?? '').trim()}`,
        );
      }
    }
    expect(
      offenders,
      '选中请用 NavList／ListRow 的 `selected`（`aria-current`）；展开态直接用已经发布的 `aria-expanded`（docs/10 §10.1）',
    ).toEqual([]);
  });

  it('被导航基座收编的类不得复活', () => {
    const offenders: string[] = [];
    assertRetiredClassesAbsent(offenders, 'nav');
    expect(
      offenders,
      '导航行与筛选组请复用 NavList／SegmentedControl／ListRow（docs/10 §10.1）',
    ).toEqual([]);
  });

  it('导航行的几何只由基座的选择器拥有', () => {
    // 窄屏那一档只换 `--nav-item-*` 自定义属性，不重述宽度与内边距——
    // 折叠态此前在 `.sidebar-collapsed` 与媒体查询里各写一遍，才有 `font-size: 0` 这种删名字的做法。
    const offenders = declarations
      .map((declaration) => ({
        declaration,
        selector: declaration.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
      }))
      .filter(({ selector }) => /\.nav-(?:item|list)(?![-\w])/.test(selector))
      .filter(
        ({ selector }) => !/^\.nav-(?:item|list|item-icon|item-label)(?![-\w])/.test(selector),
      )
      .filter(({ declaration }) =>
        [
          'display',
          'width',
          'min-height',
          'height',
          'gap',
          'row-gap',
          'column-gap',
          'padding',
          'align-items',
          'justify-content',
          'border-radius',
          'color',
          'background',
          'font-size',
        ].includes(declaration.property),
      )
      .map(({ declaration }) => locate(declaration, styles ?? ''));
    expect(
      offenders,
      '导航行的几何与配色归 NavItem／NavList；位置与折叠态请换自定义属性（docs/10 §9.8）',
    ).toEqual([]);
  });
});

/**
 * 定宽列：侧栏 240px、上下文面板 380px、消息中心 360px、`Modal` 的 sheet 抽屉 480px。
 * 这些表面的宽度是写死的，横向溢出换不来「多看一点」，只换来一条滚动条——
 * 名字太长是截断问题（收短之后由 `Tooltip` 就地补全），说明文字放不下就是折行问题，
 * 两者都不是滚动问题。
 */
const FIXED_WIDTH_COLUMN_SCROLLERS = [
  '.workspace-groups',
  '.context-content',
  '.notification-list',
  '.knowledge-drawer-body',
  '.model-sheet',
];

/** 选择器里出现的类名清单（注释已在解析前被抹平，不会误伤说明文字）。 */
function classesOf(selector: string): string[] {
  return [...selector.matchAll(/\.[-\w]+/g)].map((match) => match[0] ?? '');
}

describe('定宽列的横向溢出纪律', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');

  it('定宽列的滚动容器不得横向可滚', () => {
    // `overflow: auto` 不指明轴向＝两轴都可滚。2026-09-28 侧栏就是这么长出一条横向杠，
    // 而它下面的分组外壳还是 `display: grid` 的隐式列，省略号被推到可视区之外——
    // 用户读到的是「名字被砍断」，不是「名字太长」。
    const offenders = declarations
      .filter((declaration) =>
        FIXED_WIDTH_COLUMN_SCROLLERS.some((scroller) =>
          classesOf(declaration.selector).includes(scroller),
        ),
      )
      .filter(
        (declaration) =>
          declaration.property === 'overflow' || declaration.property === 'overflow-x',
      )
      .filter((declaration) => {
        const horizontal = declaration.value.split(/\s+/)[0] ?? '';
        return horizontal !== 'hidden' && horizontal !== 'clip';
      })
      .map((declaration) => locate(declaration, styles ?? ''));
    expect(
      offenders,
      '定宽列只允许纵向滚动：横向溢出请收到列宽或就地截断，不要放一条横向滚动条出去（docs/10 §9.8）',
    ).toEqual([]);
  });

  it('定宽列的分组外壳必须把列收到 0', () => {
    // grid 隐式列的下限是 min-content，一句不折行的名称就能把列顶宽。上一条护栏把
    // 滚动条关掉之后，这种溢出从「能滚」变成「看不见」，所以列宽必须显式收到 0。
    const shells = ['.workspace-group', '.workspace-group-tasks'];
    const offenders = shells
      .map((shell) => {
        const track = declarations.find(
          (declaration) =>
            declaration.selector.trim() === shell &&
            declaration.property === 'grid-template-columns',
        );
        if (track && /^minmax\(0,\s*1fr\)$/.test(track.value)) return undefined;
        return `${shell} { grid-template-columns: ${track?.value ?? '(未声明)'} }`;
      })
      .filter((offender): offender is string => offender !== undefined);
    expect(
      offenders,
      '承载单行文本的定宽列外壳请写 `grid-template-columns: minmax(0, 1fr)`（docs/10 §9.8）',
    ).toEqual([]);
  });

  it('导航行的可收缩住在基座，不由领域类各补一遍', () => {
    // `.workspace-group-name` 曾经自己补过一条 `min-width: 0`——于是每一个新用 NavItem
    // 的定宽列都要记得补同一件事。收进基座之后，领域类只负责「占多宽」。
    const minWidth = declarations.find(
      (declaration) =>
        declaration.selector.trim() === '.nav-item' && declaration.property === 'min-width',
    );
    expect(minWidth?.value, '.nav-item 基座缺 `min-width: 0`').toBe('0');
  });
});

/**
 * 定宽列里「段落壳给这一列的水平内缩」只有一档 16px（docs/10 §9.8、ADR-0033 决策 6 的 2026-10-01 追记）。
 *
 * 并档前 380px 那一列的同一格有 12／14／15／16 四种取值：`.activity-list` 比隔壁小节少缩 1px，夹在
 * 段与段之间的 `InlineError` 比它上下两个小节各多缩 2px——而那句提示说的正是上面那段话失败了。
 * 16px 不是新造的档：它已经在 §9.8 那把尺上，也是 `--card-padding`（12px 16px）与
 * `--surface-padding-panel` 的水平格，「列里的块和卡片用同一把水平尺」一句讲得通。
 *
 * 侧栏与设置空间的左导航不在这一轴：它们的段落是**行**，行的水平缝归 `NavList` 基座那一处 `8px`，
 * 整列的余量归下面那条「列壳」轴（同日稍晚也并到 16px，见 `COLUMN_SHELL_WIDTH_OWNERS`）。
 * 名字族扫描管「这几件壳不许改档」，`components/ContextPanel.test.tsx` 的 DOM 断言管「新增段落必须
 * 挑一件登记过的壳」——两条合起来才封住这一轴。
 */
const COLUMN_INSET_OWNERS: {
  readonly selector: string;
  readonly property: string;
  readonly reason: string;
}[] = [
  { selector: '.context-topline', property: 'padding', reason: '列顶那一行（当前对象名）' },
  {
    selector: '.context-panel .tabs',
    property: 'padding',
    reason: '列内页签带：左右内缩由面板给，几何仍归 Tabs 基座',
  },
  { selector: '.context-section', property: 'padding', reason: '列里绝大多数段落的小节壳' },
  { selector: '.brief-panel', property: 'padding', reason: '简报页的壳' },
  { selector: '.activity-list', property: 'padding', reason: '过程页的列表壳' },
  {
    selector: '.context-content > .inline-error',
    property: 'margin',
    reason: '夹在段与段之间的内联提示，左右必须与段落壳对齐',
  },
  {
    selector: '.notification-panel-heading',
    property: 'padding',
    reason: '消息中心（360px 那一列）面板头自己拥有的那道缝',
  },
];

/** 命中列内类名族、但**不在这条轴**上的水平内缩：逐条写明凭什么不算，免得下一次又被当成漏档。 */
const NOT_ON_COLUMN_INSET_AXIS: {
  readonly selector: string;
  readonly property: string;
  readonly pixels: number;
  readonly reason: string;
}[] = [
  {
    selector: '.context-exclusion-list',
    property: 'padding-left',
    pixels: 18,
    reason: '段落内部列表的符号缩进，不是列缝',
  },
  {
    selector: '.context-replay-list',
    property: 'padding-left',
    pixels: 18,
    reason: '同上：重放条目列表的符号缩进',
  },
  {
    selector: '.activity-summary',
    property: 'padding',
    pixels: 12,
    reason: '过程页一行的行内距，归「行」那一轴',
  },
  {
    selector: '.activity-marker',
    property: 'margin',
    pixels: 4,
    reason: '标记方块在行内的偏移，不是内缩',
  },
  {
    selector: '.empty-context',
    property: 'padding',
    pixels: 28,
    reason: '区域级空态的四周留白并水平居中，光哥 2026-10-01 确认它不是段落缝、不并档',
  },
  {
    selector: '.modal-panel, .notification-panel',
    property: 'padding',
    pixels: 24,
    reason: '整块表面的内缩，走 §9.13 的 `--surface-padding-modal`（已登记在 SURFACE_PADDING）',
  },
  {
    selector: ".modal-panel[data-variant='sheet']",
    property: 'padding',
    pixels: 24,
    reason: '480px 抽屉的外壳内距，同样是 §9.13 的模态档；它没有「列内段落」这一轴',
  },
  {
    selector: ".modal-panel[data-variant='viewer']",
    property: 'padding',
    pixels: 16,
    reason: '放映／查看器抽屉按面板档——数字与段落壳的 16px 撞车是巧合，不是同一件事',
  },
];

const COLUMN_INSET_FAMILY =
  /^\.(context|brief|activity|empty-context|notification-panel|modal-panel)/;

describe('定宽列段落内缩档位', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');

  const scanned = declarations.filter(
    (declaration) =>
      isInsetProperty(declaration.property) &&
      classesOf(declaration.selector).some((className) => COLUMN_INSET_FAMILY.test(className)) &&
      horizontalPixelsOf(declarations, declaration).length > 0,
  );

  function keyOf(declaration: CssDeclaration): string {
    return `${declaration.selector.trim()} :: ${declaration.property}`;
  }

  it('列内声明的水平内缩必须命中清单，存量与清单等量', () => {
    expect(
      COLUMN_INSET_OWNERS.length,
      '段落壳清单不得清空（清空等于这条轴没有尺）',
    ).toBeGreaterThanOrEqual(7);
    const registered = new Map<string, string>([
      ...COLUMN_INSET_OWNERS.map(
        (entry) => [`${entry.selector} :: ${entry.property}`, '段落壳'] as const,
      ),
      ...NOT_ON_COLUMN_INSET_AXIS.map(
        (entry) => [`${entry.selector} :: ${entry.property}`, '不在这一轴'] as const,
      ),
    ]);
    const offenders = scanned
      .filter((declaration) => !registered.has(keyOf(declaration)))
      .map((declaration) => `新增未登记：${locate(declaration, styles ?? '')}`);
    for (const [key, kind] of registered) {
      if (scanned.some((declaration) => keyOf(declaration) === key)) continue;
      offenders.push(`${kind}清单里的 ${key} 在 CSS 里找不到了——改了值就同步改清单，不许让它空着`);
    }
    expect(
      offenders,
      '定宽列的水平内缩要么登记成段落壳、要么登记成「不在这一轴」并写明理由（docs/10 §9.8）',
    ).toEqual([]);
  });

  it('每一段左边缘都落在同一道 16px 缝上', () => {
    const offenders: string[] = [];
    for (const owner of COLUMN_INSET_OWNERS) {
      const declaration = scanned.find(
        (candidate) => keyOf(candidate) === `${owner.selector} :: ${owner.property}`,
      );
      if (!declaration) {
        offenders.push(`${owner.selector} 的 ${owner.property} 不见了：${owner.reason}`);
        continue;
      }
      const sides = horizontalPixelsOf(declarations, declaration);
      if (sides.length === 0 || sides.some((pixels) => pixels !== 16)) {
        offenders.push(
          `${locate(declaration, styles ?? '')} → 水平分量 ${sides.join('／') || '无'}px，段落壳只许 16px（${owner.reason}）`,
        );
      }
    }
    expect(
      offenders,
      '列里的段落壳必须同档，否则同列相邻两块会差 1–2px 而没人报错；要改档先改 docs/10 §9.8',
    ).toEqual([]);
  });

  it('「不在这一轴」的每一项仍与 CSS 实测一致', () => {
    const offenders: string[] = [];
    for (const entry of NOT_ON_COLUMN_INSET_AXIS) {
      const declaration = scanned.find(
        (candidate) => keyOf(candidate) === `${entry.selector} :: ${entry.property}`,
      );
      if (!declaration) continue;
      const sides = horizontalPixelsOf(declarations, declaration);
      if (!sides.includes(entry.pixels)) {
        offenders.push(
          `${entry.selector} 的水平分量实测 ${sides.join('／') || '无'}px，登记的却是 ${entry.pixels}px：口径变了就同轮改清单与 docs/10 §9.8（${entry.reason}）`,
        );
      }
    }
    expect(offenders, '不在这一轴不是免检：登记的理由与值都得对得上现场').toEqual([]);
  });
});

/**
 * 定宽列的「列壳给整列那道水平余量」只有一档 16px（docs/10 §9.8、ADR-0033 决策 6 的第二次追记）。
 *
 * 上一条轴并的是 380px 那一列的**段落壳**，这一条并的是**列壳**：同一条轴上散着 12（侧栏）、
 * 20（设置左导航）、10（成果详情左列）、8（窄栏，以及 `.brand`／`.section-label`／`.sidebar-divider`
 * 各自再补的那一道），而它们彼此从不被任何门禁比对。并到 16 而不是 12：16 已在档位表里
 * （`--surface-padding-panel`，也是 `--card-padding` 的水平格），12 在这一轴没有对应物——
 * 定 12 等于给列壳另起一个名字，而「列里的块、行、卡片用同一把水平尺」这句讲得通。
 *
 * 于是这道缝只有一个算法：**列壳 16 ＋行自己的内距 8 → 行里的图标落在 24**；
 * 段落壳 16 → 段落文字落在 16。侧栏那三处各补的 8px 归零，左边缘改由列壳决定，
 * 因此小节标签会比它下面那行图标靠左 8px（此前两者巧合地都在 ~20px）——已写进回看清单。
 *
 * 清单由两问交叉得出，不凭手头那张截图：① 名字族里所有水平内缩 > 0 的声明全列出来；
 * ② 逐个问「它是给整列的余量，还是行内距／层级缩进／控件内距／另一件表面」。
 */
const COLUMN_SHELL_WIDTH_OWNERS: {
  readonly selector: string;
  readonly property: string;
  readonly reason: string;
}[] = [
  {
    selector: '.sidebar',
    property: 'padding',
    reason: '侧栏（240px，≤1279px 收到 220px）的列壳',
  },
  {
    selector: '.settings-nav-list',
    property: 'padding',
    reason: '设置空间左导航（220px，≤960px 收到 168px）的列壳；36px 是纵向呼吸，不在这条轴',
  },
  {
    selector: '.artifact-version-list',
    property: 'padding',
    reason: '成果详情左列（176px）的列壳，取 `--card-padding` 的水平格',
  },
];

/** 命中名字族、但**不在这一轴**的水平内缩：每条写明凭什么不算，下一次同类报告能直接回答「扫过了没有」。 */
const NOT_ON_COLUMN_SHELL_AXIS: {
  readonly selector: string;
  readonly property: string;
  readonly pixels: number;
  readonly reason: string;
}[] = [
  {
    selector: '.sidebar-collapsed .sidebar',
    property: 'padding',
    pixels: 8,
    reason:
      '折叠成 88px 窄栏：`.sidebar` 有 `align-items: center`，36px 的导航项居中，列壳的横向值不改变行的位置，只决定 `.brand` 的可用宽——要统一该钉宽度而不是这道 padding（光哥 2026-10-01 拍板不并）',
  },
  {
    selector: '@media (max-width: 960px) .sidebar',
    property: 'padding',
    pixels: 8,
    reason:
      '窄视口自动收成窄栏的第二份定义，与上一条同一档；它的纵向 15px 与手折叠的 18／14px 不一致，属 §9.13 纵向轴，另案',
  },
  {
    selector: '.nav-item',
    property: 'padding',
    pixels: 8,
    reason: '行自己的内距，归 §9.10；它排在列壳之内，与列缝相加才是图标与文字的左边缘',
  },
  {
    selector: '.workspace-group-tasks',
    property: 'margin-left',
    pixels: 12,
    reason: '子级任务相对父级的层级缩进，不是列缝',
  },
  {
    selector: '.workspace-group-tasks',
    property: 'padding-left',
    pixels: 8,
    reason: '同一条层级缩进的第二段（展开标记与行之间），仍不是列缝',
  },
  {
    selector: '.workspace-selector-trigger',
    property: 'padding',
    pixels: 8,
    reason: '控件内距，归 §9.10 那张成对档位表',
  },
  {
    selector: '.workspace-selector-search',
    property: 'padding',
    pixels: 8,
    reason: '同上：搜索行控件内距',
  },
  {
    selector: '.workspace-selector-actions',
    property: 'padding',
    pixels: 6,
    reason:
      '同上，且 `4px 6px` 的 6 与 `--control-padding`（6px 10px）不成对——已登记为 §9.10 的待处理项，不属这条轴',
  },
  {
    selector: '.workspace-selector-action',
    property: 'padding',
    pixels: 10,
    reason: '同上：`--control-padding` 的水平格',
  },
  {
    selector: '.workspace-folder-drop',
    property: 'padding',
    pixels: 16,
    reason: '目录投放区是一件卡片档表面，它的 16 与列缝撞数是巧合，同 viewer 档那条',
  },
];

/** 名字族＝五件定宽列及其内部会给出水平余量的类；段落壳归上一条轴，不在这里重复登记。 */
const COLUMN_SHELL_FAMILY =
  /^\.(sidebar|settings-nav-list|artifact-version-list|workspace-|brand|section-label|nav-item|nav-list)/;

describe('定宽列列壳内缩档位', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');

  const scanned = declarations.filter(
    (declaration) =>
      isInsetProperty(declaration.property) &&
      classesOf(declaration.selector).some((className) => COLUMN_SHELL_FAMILY.test(className)) &&
      horizontalPixelsOf(declarations, declaration).length > 0,
  );

  function keyOf(declaration: CssDeclaration): string {
    return `${declaration.selector.trim()} :: ${declaration.property}`;
  }

  it('列壳名字族里的水平内缩必须命中清单，存量与清单等量', () => {
    const registered = new Map<string, string>([
      ...COLUMN_SHELL_WIDTH_OWNERS.map(
        (owner) => [`${owner.selector} :: ${owner.property}`, '列壳'] as const,
      ),
      ...NOT_ON_COLUMN_SHELL_AXIS.map(
        (entry) => [`${entry.selector} :: ${entry.property}`, '不在这一轴'] as const,
      ),
    ]);
    expect(
      COLUMN_SHELL_WIDTH_OWNERS.length,
      '列壳清单为空等于这条轴没人守——先确认扫描真的跑到了 styles.css',
    ).toBeGreaterThanOrEqual(3);
    const offenders = scanned
      .filter((declaration) => !registered.has(keyOf(declaration)))
      .map((declaration) => `新增未登记：${locate(declaration, styles ?? '')}`);
    for (const [key, kind] of registered) {
      if (scanned.some((declaration) => keyOf(declaration) === key)) continue;
      offenders.push(`${kind}清单里的 ${key} 在 CSS 里找不到了——改了值就同步改清单，不许让它空着`);
    }
    expect(
      offenders,
      '定宽列里的水平余量要么登记成列壳、要么登记成「不在这一轴」并写明理由（docs/10 §9.8）',
    ).toEqual([]);
  });

  it('每一处列壳的水平缝都落在同一道 16px 上', () => {
    const offenders: string[] = [];
    for (const owner of COLUMN_SHELL_WIDTH_OWNERS) {
      const declaration = scanned.find(
        (candidate) => keyOf(candidate) === `${owner.selector} :: ${owner.property}`,
      );
      if (!declaration) {
        offenders.push(`${owner.selector} 的 ${owner.property} 不见了：${owner.reason}`);
        continue;
      }
      const sides = horizontalPixelsOf(declarations, declaration);
      if (!sides.every((pixels) => pixels === 16)) {
        offenders.push(
          `${locate(declaration, styles ?? '')} 实测 ${sides.join('／')}px，定宽列的列壳只允许 16px 一档：${owner.reason}`,
        );
      }
    }
    expect(offenders, '列壳内缩并到 16px 一档（docs/10 §9.8、ADR-0033）').toEqual([]);
  });

  it('「不在这一轴」的每一项仍与 CSS 实测一致', () => {
    const offenders: string[] = [];
    for (const entry of NOT_ON_COLUMN_SHELL_AXIS) {
      const declaration = scanned.find(
        (candidate) => keyOf(candidate) === `${entry.selector} :: ${entry.property}`,
      );
      if (!declaration) continue;
      const sides = horizontalPixelsOf(declarations, declaration);
      if (!sides.includes(entry.pixels)) {
        offenders.push(
          `${entry.selector} 的 ${entry.property} 实测 ${sides.join('／') || '无'}px，登记的却是 ${entry.pixels}px：口径变了就同轮改清单与 docs/10 §9.8（${entry.reason}）`,
        );
      }
    }
    expect(offenders, '不在这一轴不是免检：登记的理由与值都得对得上现场').toEqual([]);
  });

  it('行的内距只住在 NavItem 基座，窄栏不再补第三个数', () => {
    // 原先基座写 `var(--nav-item-padding, 7px 9px)`，而窄栏两处覆盖成 `7px`：
    // 7、9 都不在任何档位表上，同一件行内距实测出三个值。窄栏折叠改的是宽度与间距，
    // 内距没有理由跟着变，所以这道没人读的 hook 整个删掉，只留基座那一处 8px。
    const item = declarations.find(
      (declaration) =>
        declaration.selector.trim() === '.nav-item' && declaration.property === 'padding',
    );
    expect(item?.value, '.nav-item 的行内距只允许基座那一个 8px').toBe('8px');
    const overrides = declarations.filter(
      (declaration) => declaration.property === '--nav-item-padding',
    );
    expect(
      overrides.map((declaration) => locate(declaration, styles ?? '')),
      '`--nav-item-padding` 已没有任何生产者：留着兜底写法就是留一个没人读的第二出口',
    ).toEqual([]);
  });
});

describe('来源行纪律', () => {
  it('来源类型的图标与标签三元式只允许有一处', () => {
    // §3.1 P12：`isWeb ? GlobeIcon : isMcp ? CapabilityIcon : KnowledgeIcon` 与
    // 「MCP 工具／网页来源／本地资料」这组标签此前在上下文面板与成果详情各写一遍，
    // 而且两边详细度不同——同一条 Evidence 在两处报出不同的身份。
    const offenders = productionPathsUnder('apps/desktop/src/renderer/')
      .filter((relative) => /sourceType === '(?:web-page|mcp-tool)'/.test(read(relative)))
      .filter((relative) => !relative.endsWith('components/SourceRow.tsx'));
    expect(
      offenders,
      '一条来源是哪一类、配哪个图标，只有 SourceRow 一处说了算（docs/10 §10.1）',
    ).toEqual([]);
  });
});

describe('消息流与输入区纪律', () => {
  it('一条发言与任务输入区的结构只有一处实现', () => {
    // §10.2 把 MessageBlock／Composer 列为业务组件，它们却长期内联在 App.tsx：
    // 气泡与它下面那排动作之间靠 `.message-actions` 的 -10px margin 相接，
    // 「这两块属于同一件事」只写在 CSS 的负数里。外提之后结构归基座。
    const owners = [/components\/MessageBlock\.tsx$/, /components\/Composer\.tsx$/];
    const offenders = productionPathsUnder('apps/desktop/src/renderer/')
      .filter((relative) => !owners.some((owner) => owner.test(relative)))
      .filter((relative) =>
        /className="message (?:user|assistant)"|className="message-actions"|<form className="composer"/.test(
          read(relative),
        ),
      );
    expect(offenders, '消息气泡与任务输入区请复用 MessageBlock／Composer（docs/10 §10.1）').toEqual(
      [],
    );
  });

  it('「状态 · 时间」这句运行摘要只许拼一次', () => {
    // 侧栏「最近任务」把状态与时间并成一行、上下文面板「执行记录」拆成两行，
    // 同一个运行在两个列表里报出的层次不同（docs/reviews/2026-09-27-ui-reuse-audit.md §3.2）。
    const offenders = productionPathsUnder('apps/desktop/src/renderer/')
      .filter((relative) => !relative.endsWith('components/RunSummaryRow.tsx'))
      // 锚点只认「状态词 ＋ 中点 ＋ 一个插值」，不认是哪个格式化函数：基座自己把时间
      // 提出了局部变量（compact 档走 relativeTime、常规档走 formatTime），把函数名写进
      // 锚点等于只守一半——页面照抄 compact 那句就绕过去了。
      .filter((relative) => /runStatusName\[[^\]]*\]\}\s·\s\$\{/.test(read(relative)));
    expect(offenders, '运行摘要行的措辞归 RunSummaryRow，页面不再自己拼（docs/10 §10.1）').toEqual(
      [],
    );
  });
});

describe('页面骨架契约纪律', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');

  /** 骨架的六个类：结构由 `components/layout/` 负责，页面只能往里面放内容。 */
  const SKELETON_CLASSES = [
    'page-header',
    'page-toolbar',
    'page-body',
    'page-intro',
    'scroll-region',
    'view-container',
  ];

  /**
   * 登记在案的例外：容器已有 `gap` 时，工具栏那道 `margin-bottom` 是重复的缝，
   * 由承载页抵消。基座不能改成无 margin——知识页那个容器没有 gap，靠这条边距分开。
   * 新增例外要写清为什么不能改成「缝归容器」，否则就是又一处替骨架补设定。
   */
  const SKELETON_EXCEPTIONS: {
    readonly match: string;
    readonly property: string;
    readonly reason: string;
  }[] = [
    {
      match: '.memory-settings .page-toolbar',
      property: 'margin-bottom',
      reason: '本页容器 .memory-settings 已有 gap: 12px，抵消工具栏自带的下边距',
    },
  ];

  it('被基座收编的借类不得复活', () => {
    // §4.5：跨文件借他人 CSS 类是「复用了皮、没复用结构」。修它的正确方式是给结构建基座
    // （CheckList）或改用主皮类名（.text-button），而不是把别人的类抄进自己文件。
    const offenders: string[] = [];
    assertRetiredClassesAbsent(offenders, 'borrow');
    expect(offenders, '跨页面借类请改接基座或具名主皮（docs/10 §10.1）').toEqual([]);
  });

  it('已收编的类名不得留在调用点的 className 上', () => {
    // 上面那几条只查 CSS：规则删干净了，调用点留着 `className="chip-button"` 不会红。
    // 于是那颗按钮实际渲染成缺省的 `secondary`，而读代码的人（和文档）以为它走品牌底
    // ——ADR-0031 收皮时留下过两处（`.chip-button`、`.knowledge-research-button`）。
    // 这一条查的是「引用不存在的外观」：类名要么有 CSS 规则、要么是基座的 data 属性，
    // 挂一个已退役的名字只能是一句假话。
    const offenders: string[] = [];
    for (const relative of productionPathsUnder('apps/desktop/src/renderer/')) {
      if (!relative.endsWith('.tsx')) continue;
      const text = read(relative);
      const lines = text.split('\n');
      for (const entry of RETIRED_UTILITY_CLASSES) {
        const className = singleRetiredClassName(entry.pattern);
        if (!className) continue;
        const needle = new RegExp(`["'\` ]${className}["'\` ]`);
        lines.forEach((line, index) => {
          if (!/\bclassName=/.test(line) || !needle.test(line)) return;
          offenders.push(`${relative}:${index + 1} className 仍引用已收编的 .${className}`);
        });
      }
    }
    expect(
      offenders,
      'CSS 里的规则已随收编删除，className 还挂着它就是声称一个不存在的外观（docs/10 §10.1）',
    ).toEqual([]);
  });

  it('页面不得替骨架补几何', () => {
    const offenders = declarations
      .map((declaration) => ({
        declaration,
        selector: declaration.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
      }))
      .filter(({ selector }) =>
        SKELETON_CLASSES.some((cls) => new RegExp(`\\.${cls}(?![-\\w])`).test(selector)),
      )
      .filter(({ selector }) => {
        const head = selector.trim().split(/[,\s>]/)[0] ?? '';
        return !SKELETON_CLASSES.some((cls) => head === `.${cls}`);
      })
      .filter(({ declaration }) =>
        [
          'display',
          'flex',
          'flex-direction',
          'gap',
          'row-gap',
          'column-gap',
          'padding',
          'margin',
          'margin-bottom',
          'margin-top',
          'width',
          'max-width',
          'min-height',
          'height',
        ].includes(declaration.property),
      )
      .filter(
        ({ selector, declaration }) =>
          !SKELETON_EXCEPTIONS.some(
            (item) => selector.includes(item.match) && declaration.property === item.property,
          ),
      )
      .map(({ declaration, selector }) =>
        selector.includes('@media')
          ? locate(declaration, styles ?? '')
          : `${locate(declaration, styles ?? '')}`.replace(/\s+\{.*/u, ''),
      );
    expect(
      offenders,
      '骨架的几何只住在 components/layout/ 与它自己的类上；要一列可增长的内容，请把钩子类给元素自己（如 `.message-flow`），别写 `.某容器 > .page-body`（docs/10 §8.3、§9.8）',
    ).toEqual([]);
  });

  /**
   * 登记在案的例外：这三档宽度属于 Modal 基座自己的表面几何（对话框／抽屉／查看器），
   * 不是页面版心。基座内部要各自宽窄是设计的一部分；页面不得援引此例另起版心。
   */
  const PAGE_WIDTH_EXCEPTIONS: { readonly match: string; readonly reason: string }[] = [
    {
      match: ".modal-panel[data-variant='dialog']",
      reason: 'Modal 基座的对话框表面宽度，属浮层几何不属版心（docs/10 §8.3、§10.1）',
    },
    {
      match: ".modal-panel[data-variant='viewer']",
      reason: 'Modal 基座的查看器表面宽度：要容得下整页文档与演示',
    },
    {
      match: ".modal-panel[data-variant='sheet']",
      reason: 'Modal 基座的抽屉表面宽度：贴边滑出，与正文列无关',
    },
  ];

  it('版心宽度全仓只有一处', () => {
    // §4.1：专家页曾给正文写 `width: min(720px, 100%)`，同一站点的正文因此有两种行长。
    // 收口方式是把 860px 定成 `--page-body-width`，对话列、输入框、讨论节点卡都读它。
    const offenders = declarations
      .map((declaration) => ({
        declaration,
        selector: declaration.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
      }))
      .filter(({ declaration }) => declaration.property === 'width')
      .filter(({ declaration }) => /min\(\s*\d+px/u.test(declaration.value))
      .filter(({ selector }) => {
        const head = selector.trim().split(/[\s>]/)[0] ?? '';
        return !/^\.page-body(?![-\w])/.test(head);
      })
      .filter(
        ({ selector }) => !PAGE_WIDTH_EXCEPTIONS.some((item) => selector.includes(item.match)),
      )
      .map(
        ({ declaration, selector }) => `${selector} { ${declaration.value} } (${declaration.line})`,
      );
    expect(
      offenders,
      '版心只有一个值：`--page-body-width`，由 `.page-body` 消费；要更窄请写成 max-width，要另一档请先改 docs/10 §8.3（浮层表面宽度按清单登记）',
    ).toEqual([]);
  });

  it('版心 Token 有且只有一个定义点并被骨架消费', () => {
    const defined = declarations.filter(
      (declaration) =>
        declaration.property === '--page-body-width' &&
        /^:(?:root|html)$/.test(declaration.selector.trim().split(/[\s>]/)[0] ?? ''),
    );
    expect(defined, '`--page-body-width` 只能定义一次（docs/10 §8.3）').toHaveLength(1);
    expect(defined[0]?.value, '版心值改了要同步 docs/10 §8.3 与本条断言').toBe('860px');
    const consumed = declarations.filter(
      (declaration) =>
        declaration.value.includes('var(--page-body-width)') &&
        (declaration.selector.trim().split(/[\s>]/)[0] ?? '') === '.page-body',
    );
    expect(
      consumed,
      '`--page-body-width` 必须被 `.page-body` 消费，否则它只是个死变量',
    ).toHaveLength(1);
  });
});

describe('导出面纪律', () => {
  it('导出的组件必须有跨文件消费者', () => {
    // §3.4 末与 §3.2「伪导出」：`SettingsView.tsx` 曾把四个只被同文件消费的分区导出成公共 API，
    // `ContextPanel.tsx` 的 `ActivityGroupRow` 同罪。导出面就是契约面——
    // 多一个导出，等于全仓多一个可以被绕过的入口，也让「这块到底归谁渲染」从代码里消失。
    const rendererFiles = pathsUnder('apps/desktop/src/renderer/').filter(
      (relative) => /\.(tsx|ts)$/.test(relative) && !/\.test\.tsx?$/.test(relative),
    );
    const sources = rendererFiles.filter(
      (relative) =>
        relative.includes('/views/') ||
        relative.includes('/components/') ||
        relative.endsWith('notifications.tsx'),
    );
    const offenders: string[] = [];
    for (const relative of sources) {
      for (const match of read(relative).matchAll(/^export function ([A-Z]\w*)/gmu)) {
        const name = match[1];
        if (name === undefined) continue;
        const referenced = new RegExp(`\\b${name}\\b`, 'u');
        const consumed = rendererFiles
          .concat(pathsUnder('apps/desktop/src/renderer/').filter((r) => /\.test\.tsx?$/.test(r)))
          .filter((other) => other !== relative)
          .some((other) => referenced.test(read(other)));
        if (!consumed) offenders.push(`${relative} → ${name}`);
      }
    }
    expect(
      offenders,
      '只被同文件消费的分区不要导出；确实要给别人用的，先有消费者再开出口（docs/12 §3）',
    ).toEqual([]);
  });
});

describe('反馈通道纪律', () => {
  it('内联反馈块的配色只能由 tone 档位提供', () => {
    // docs/10 §11.5.1 只有三个落点，`InlineError` 是第二落点的唯一出口，档位是 danger／warning。
    // 知识页曾把「来源检查完成（9/9）」写成常驻内联块：与消息中心重复，而且没有任何清除
    // 路径——只有下一次动作会覆盖它。基础类一旦自己长出颜色，谁写一句就得到第二条成功通道。
    const styles = cssPaths().find((relative) => relative.endsWith('styles.css')) ?? '';
    // 选择器组按逗号拆开逐个判，否则 `.a, .inline-error { … }` 整组漏网。
    const partsOf = (selector: string): string[] =>
      selector
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    const bareOf = (selector: string): boolean =>
      partsOf(selector).some(
        (part) => /^\.inline-error(?![\w-])/.test(part) && !/\[data-tone=/.test(part),
      );
    const colorOffenders = declarationsOf(styles)
      .filter(({ selector }) => bareOf(selector))
      .filter(({ property }) => property === 'color' || property.startsWith('background'))
      .map((declaration) => locate(declaration, styles));
    expect(
      colorOffenders,
      '色与底只能由 `.inline-error[data-tone=…]` 提供，写在基础类上等于开出第二个成功通道',
    ).toEqual([]);

    const tones = [
      ...new Set(
        declarationsOf(styles)
          .map(({ selector }) => /\.inline-error\[data-tone='([^']+)'\]/u.exec(selector)?.[1])
          .filter((tone): tone is string => tone !== undefined),
      ),
    ].sort();
    expect(tones, '内联反馈只有 danger／warning 两档（docs/10 §11.5.1）').toEqual([
      'danger',
      'warning',
    ]);
  });

  it('InlineError 基座不得自带上下缝', () => {
    // 上下缝由承载它的位置拥有：技能页与专家页给 `margin: 12px 32px`（页头带之下、
    // 滚动区之外），知识页与设置页给 `12px 0`。基座自己再叠一道，就会在已有 gap 的
    // 容器里读成双缝（docs/10 §9.8）。
    const styles = cssPaths().find((relative) => relative.endsWith('styles.css')) ?? '';
    const offenders = declarationsOf(styles)
      .filter(({ selector }) =>
        selector
          .split(',')
          .map((part) => part.trim())
          .some((part) => /^\.inline-error(?![\w-])(\s*\[[^\]]*\])?$/u.test(part)),
      )
      .filter(({ property }) => property.startsWith('margin'))
      .map((declaration) => locate(declaration, styles));
    expect(offenders, '`.inline-error` 裸类不得声明 margin，缝归容器').toEqual([]);
  });

  it('已废弃的反馈表面不得复活', () => {
    // `.action-error-banner` 是 §11.5.1 三个落点之外的第四个表面：全局单槽被 25 个调用点
    // 共用、后一个覆盖前一个、要等到切换工作空间才清空，还常与内联提示重复播报同一句话——
    // 用户关掉一处后读到的是「这个提示关不掉」。
    // `.page-toast-host` 与 `.toast-host` 在同一坐标各自 `position: fixed`，后渲染的整列
    // 盖住先渲染的，页面的短时确认会被全局通知压掉；两者已合并为 `#toast-stack` 一列。
    // 后七个是同一个「带底色的内联错误条」的七套几何，已收成 `InlineError` 一处
    // （docs/10 §10.1 台账）。`.memory-projection` 是 2026-09-28 补漏抓到的第八个：
    // 它自带 `--warning-soft` 底、`10px 12px` 内距，还在壳里手排「图标＋文字＋按钮」，
    // 说的是「记忆已保存但投影没跟上」——一句动作结果，按 §11.5.1 归本基座。
    // `.action-note` 曾在这一条外被划给状态轴，那是误判：它唯一的调用点写的是保存成果的
    // 成功／失败，属反馈；两档现已按 §11.5.1 拆开，三条规则一并删除（见 §11.5.2）。
    const retiredSurfaces = [
      'action-error-banner',
      'page-toast-host',
      'toast-host',
      'inline-message',
      'field-error',
      'memory-warnings',
      'knowledge-issues',
      'artifact-action-error',
      'memory-editor-problems',
      'memory-projection',
    ];
    const offenders: string[] = [];
    for (const relative of pathsUnder('apps/desktop/src/renderer/')) {
      if (!/\.(tsx|css)$/.test(relative) || /\.test\.tsx$/.test(relative)) continue;
      const source = read(relative);
      for (const name of retiredSurfaces) {
        // 只看「有没有把它当类名用」：注释里提到这些名字记录的正是「为什么删」，
        // 而 CSS 侧由 selector 判定，不会被散文误伤。
        const usedAsClass = new RegExp(`className[^\\n]*\\b${name}\\b`, 'u').test(source);
        const styled = declarationsOf(relative).some(({ selector }) =>
          selector.includes(`.${name}`),
        );
        if (usedAsClass || styled) offenders.push(`${relative} → .${name}`);
      }
    }
    expect(offenders, '这些表面已并入三个合法落点，不得复活（docs/10 §11.5.1）').toEqual([]);
  });

  it('右下角那一列浮层只有一个容器', () => {
    const styles = cssPaths().find((relative) => relative.endsWith('styles.css')) ?? '';
    const users = [
      ...new Set(
        declarationsOf(styles)
          .filter(({ property, value }) => property === 'z-index' && value.includes('--z-toast'))
          .map(({ selector }) => selector),
      ),
    ];
    expect(
      users,
      '只有 `.toast-stack` 使用 `--z-toast`：再一处 fixed 容器就会在同一坐标盖住另一处（docs/10 §11.5.1）',
    ).toEqual(['.toast-stack']);
  });

  it('内联错误必须走 InlineError 基座', () => {
    // 基座之外留着 `role="alert"`，就是还有一处自己决定底色、字号与关闭路径的错误条。
    // 旧表面全部迁完之后，这条从「只降不升的存量清单」升级为绝对断言：
    // 只有第二落点（`InlineError`）与整页错误态（`EmptyState` 的 `ErrorPage`）可以自写它。
    const exempt: readonly string[] = [
      'apps/desktop/src/renderer/src/components/InlineError.tsx',
      'apps/desktop/src/renderer/src/components/EmptyState.tsx',
    ];
    const offenders = pathsUnder('apps/desktop/src/renderer/')
      .filter((relative) => /\.tsx$/.test(relative) && !/\.test\.tsx$/.test(relative))
      .filter((relative) => read(relative).includes('role="alert"'))
      .filter((relative) => !exempt.includes(relative));
    expect(
      offenders,
      '新增内联错误请用 InlineError；整页错误态才是 EmptyState 里那个 role="alert"（docs/10 §10.1、§11.5.1）',
    ).toEqual([]);

    // 白名单自己也要回对现状：列进去却不再自写 `role="alert"` 的是死条目，留着它只会让
    // 下一个绕过基座的人以为「再加一行是这里的规矩」。
    const staleExemptions = exempt.filter((relative) => !read(relative).includes('role="alert"'));
    expect(staleExemptions, '豁免清单里有文件已经不再自写 role="alert"，把它删掉').toEqual([]);
  });

  it('短时浮层的自消计时不依赖 onDismiss 的标识', () => {
    // `TransientToast` 承诺「4s／6s 后自己消失」。把 `onDismiss` 列进依赖数组就兑现不了这个
    // 承诺：调用点写的是内联箭头（`onDismiss={() => setNote('')}`），宿主每次重渲染都换一个
    // 函数标识，于是每次重渲染都把计时清零——运行中浮层可能永远不消失。这是 2026-09-28
    // 核实的真缺陷，修法在基座（回调经 ref 转发）而不在调用点：包五个 `useCallback`
    // 拦不住下一个页面。这条锁依赖数组的字面形状，同时兼作锚点——effect 被改写即红。
    const relative = 'apps/desktop/src/renderer/src/components/TransientToast.tsx';
    const source = read(relative);
    const effect = /const timer = window\.setTimeout\([\s\S]*?\},\s*\[([^\]]*)\]\);/u.exec(source);
    expect(
      effect,
      `${relative} 里那枚「一条浮层一枚自消计时器」的 effect 换了形状，请同步本条护栏`,
    ).not.toBeNull();
    const dependencies = (effect?.[1] ?? '')
      .split(',')
      .map((dependency) => dependency.trim())
      .filter((dependency) => dependency.length > 0);
    expect(
      dependencies,
      '自消计时只能由「换了哪一句、换了哪一档」重启；`onDismiss` 走 ref 转发，不进依赖（docs/10 §11.5.1）',
    ).not.toContain('onDismiss');
    expect(
      /useRef[^\n]*\(onDismiss\)/u.test(source),
      '回调必须由 ref 转发，否则最新那一个 `onDismiss` 不会被调用',
    ).toBe(true);
  });
});

describe('状态呈现纪律', () => {
  // docs/10 §11.5.2：状态轴说「这个对象现在是什么」，反馈轴（§11.5.1）说「你刚做的那一下
  // 怎么样了」。两轴各只有一个出口，否则同一句「现在如此」会散成八个类名、各写一遍语义字色。
  const retiredStatusSurfaces = [
    'success-copy',
    'skill-blocked-reasons',
    'expert-card-status',
    'memory-duplicate-hint',
    'memory-dependencies',
    'memory-policy-hint',
    'memory-pending-governance',
    'appearance-note',
    'action-note',
    'context-hint',
    'context-phase',
  ];

  it('已废弃的自造状态说明表面不得复活', () => {
    // `.memory-pending-governance` 与 `.appearance-note` 借的是反馈表面的壳（`padding: 10px 12px`
    // ＋ soft 底色），讲的却是一句常驻状态，读起来像「刚刚出事了」；`.success-copy` 的绿字
    // 靠 `!important` 才盖得住容器的 `> p` 规则。三者都已并入 `StatusNote`。
    //
    // `.context-hint`／`.context-note`／`.context-phase` 是同一件事的上下文面板版：三个类只差
    // 字色（muted／secondary／secondary），21 处调用里混着空态、对象状态与读法说明。2026-09-29
    // 逐句分类后前两个类退役——**空态归 `EmptyNotice`、对象状态归 `StatusNote`**，只剩
    // `.context-note` 承载「该怎么读这一段」的说明（3 处），因为说明不属于这两条轴。
    // 所以本条清单里既有并入 `StatusNote` 的类，也有并入 `EmptyNotice` 的类。
    const offenders: string[] = [];
    for (const relative of pathsUnder('apps/desktop/src/renderer/')) {
      if (!/\.(tsx|css)$/.test(relative) || /\.test\.tsx$/.test(relative)) continue;
      const source = read(relative);
      for (const name of retiredStatusSurfaces) {
        const usedAsClass = new RegExp(`className[^\\n]*\\b${name}\\b`, 'u').test(source);
        const styled = declarationsOf(relative).some(({ selector }) =>
          selector
            .split(',')
            .map((part) => part.trim())
            .some((part) => new RegExp(`\\.${name}(?![\\w-])`, 'u').test(part)),
        );
        if (usedAsClass || styled) offenders.push(`${relative} → .${name}`);
      }
    }
    expect(
      offenders,
      '一句只读说明不得自造类：空态归 EmptyNotice、对象状态归 StatusNote（docs/10 §10.1、§11.5.2）',
    ).toEqual([]);
  });

  it('通用字色 utility 不得复活', () => {
    // `.danger`／`.danger-text` 是「谁都能拿来给一句文字上红色」的裸工具类：
    // 它们绕开 tone 档位，让状态色重新散回页面。ADR-0031 收口按钮时删掉了用法，
    // 规则本身留到本轮才清掉，源码里已零引用——留着就是下一条内联成功通道的入口。
    const styles = cssPaths().find((relative) => relative.endsWith('styles.css')) ?? '';
    const offenders = declarationsOf(styles)
      .filter(({ selector }) =>
        selector
          .split(',')
          .map((part) => part.trim())
          .some((part) => /^\.danger(-text)?(?![\w-])/u.test(part)),
      )
      .map((declaration) => locate(declaration, styles));
    expect(
      offenders,
      '语义状态色只能由四个出口或登记清单给，不给「裸色类」留第二条路（docs/10 §11.5.2）',
    ).toEqual([]);
  });

  it('StatusNote 基座不长出表面，档位只有四档', () => {
    const styles = cssPaths().find((relative) => relative.endsWith('styles.css')) ?? '';
    // 「裸类」只指不带 tone 属性的那一条——配色本来就归 `[data-tone]` 档位给。
    const isBare = (selector: string): boolean =>
      selector
        .split(',')
        .map((part) => part.trim())
        .some((part) => /^\.status-note(?![\w-])$/u.test(part));
    const isToneSlot = (selector: string): boolean =>
      selector
        .split(',')
        .map((part) => part.trim())
        .some((part) => /^\.status-note(?![\w-])\s*\[[^\]]*\]$/u.test(part));
    // 有底、有内距、自带上下缝，它就变成第二个 `InlineError`——而 §11.5.1 明确禁止
    // 常驻内联块长出一个成功态。
    const surfaceOffenders = declarationsOf(styles)
      .filter(({ selector }) => isBare(selector))
      .filter(({ property }) =>
        ['color', 'background', 'padding', 'margin'].some((head) => property.startsWith(head)),
      )
      .map((declaration) => locate(declaration, styles));
    expect(
      surfaceOffenders,
      '`.status-note` 裸类不出底色与上下缝：配色归 tone 档位，缝归容器（docs/10 §9.8、§11.5.2）',
    ).toEqual([]);

    const tones = [
      ...new Set(
        declarationsOf(styles)
          .filter(({ selector }) => isToneSlot(selector))
          .map(({ selector }) => /data-tone='([^']+)'/u.exec(selector)?.[1])
          .filter((tone) => tone !== undefined),
      ),
    ].sort();
    expect(
      tones,
      '档位是 neutral／success／warning／danger 四档；`--info` 属通知等级词汇，不补第五档',
    ).toEqual(['danger', 'neutral', 'success', 'warning']);
  });

  it('语义状态色只能由四个出口给，其余逐条登记理由', () => {
    // 「一句状态说明」此前有八个类名各写一遍 `color: var(--warning)`，同一种「要注意」
    // 在不同页面有不同的红。这条把剩下的每一处都点名：不是基座档位，就得给出不复用的理由。
    const styles = cssPaths().find((relative) => relative.endsWith('styles.css')) ?? '';
    const colored = declarationsOf(styles).filter(
      ({ property, value }) =>
        property === 'color' && /^var\(--(?:success|warning|danger)\)$/u.test(value),
    );
    const exits: readonly (readonly [RegExp, string])[] = [
      [/^\.badge\[data-tone='\w+'\]$/u, 'Badge 的 tone 档位（§10.1）'],
      [/^\.inline-error\[data-tone='\w+'\]$/u, 'InlineError 的 tone 档位（§11.5.1）'],
      [/^\.status-note\[data-tone='\w+'\]$/u, 'StatusNote 的 tone 档位（§11.5.2）'],
      [/^\.btn\[data-variant='\w+'\]\[data-tone='\w+'\]$/u, 'Button 的 tone 档位（ADR-0031）'],
      [/^\.popover-menu-item\.danger$/u, '菜单里的破坏性动作项，由 PopoverMenu 基座出档'],
      [/^\.binding-chip\[data-tone='danger'\]$/u, 'BindingChip 的 tone 档位'],
    ];
    const exceptions: Record<string, string> = {
      '.suggestion-facts .warn': '建议卡事实行里的一段要注意文字，随事实折行不独立成行',
      '.error-page-icon': '整页错误态的图标色，不给文字',
      '.dependency-warning':
        'Field 的 hint 是 <span>，块级基座放进去是非法 HTML，只能是一段带色文字（§11.5.2）',
      '.memory-source-available':
        'meta 行里的来源状态词，由 memory-source-${availability} 模板组合',
      '.memory-source-unavailable': '同上',
      '.memory-source-review-required': '同上',
      '.memory-policy-pinned': '优先带入的策略徽片，有意不冒充状态结论',
      '.memory-conflict.conflict-unresolved > strong': '冲突条的领域强调，讲的是这一对的裁决状态',
      '.memory-editor small.over': '字数超限的计数提示，住在进场内右端',
      '.level-success': '通知等级色块（aria-hidden 的图标容器），不是状态说明',
      '.level-error': '同上',
      '.level-warning': '同上',
      '.tool-failure-count': '工作过程条里的失败计数',
      '.tool-pill.failed .tool-pill-status': '工具条的状态文字，由状态类组合',
      '.tool-pill.completed .tool-pill-status': '同上',
    };
    const offenders: string[] = [];
    const hitExceptions = new Set<string>();
    for (const declaration of colored) {
      for (const part of declaration.selector
        .split(',')
        .map((raw) => raw.trim())
        .filter((raw) => raw.length > 0)) {
        if (exits.some(([pattern]) => pattern.test(part))) continue;
        const reason = exceptions[part];
        if (reason === undefined) {
          offenders.push(locate(declaration, styles));
          continue;
        }
        hitExceptions.add(part);
      }
    }
    expect(
      offenders,
      '未登记的语义状态字色：新增一行状态说明请用 StatusNote，别的形态先补 docs/10 §11.5.2（清单见本条）',
    ).toEqual([]);

    // 清单自核：登记过的选择器已经不在样式表里，说明这条护栏已经空跑，删掉死条目而不是留着。
    const stale = Object.keys(exceptions).filter(
      (part) =>
        !hitExceptions.has(part) &&
        !colored.some(({ selector }) =>
          selector
            .split(',')
            .map((raw) => raw.trim())
            .includes(part),
        ),
    );
    expect(stale, '登记清单里有选择器已经不存在，把它从清单删掉').toEqual([]);
  });
});

describe('计时基准车道纪律', () => {
  const timingTests = pathsUnder(...SOURCE_ROOTS).filter(
    (relative) => /\.test\.tsx?$/.test(relative) && !relative.endsWith('.bench.test.ts'),
  );

  it('墙钟计时断言只允许住在 *.bench.test.ts', () => {
    // 并发跑 137 个文件时，p95 会漂到 1.5–5 倍：这类断言留在 `npm test` 里
    // 等于给每次提交加随机红，而红了的门禁很快就会被绕过。
    // 判据取 `performance.now()`——本仓只有「测耗时」用它，`Date.now()` 大量用于
    // 数据夹具（updatedAt/revision 时间戳），拿它当信号会淹成假阳性。
    const offenders = timingTests.filter((relative) => read(relative).includes('performance.now'));
    expect(offenders, '计时基准要挪进 `npm run bench` 的串行车道（docs/12 §9）').toEqual([]);
  });

  it('三条车道的配置与脚本各就各位，且 verify 不含基准', () => {
    const config = read('vitest.config.ts');
    expect(config).toContain("name: 'functional'");
    expect(config).toContain("name: 'heavy'");
    expect(config).toContain("name: 'bench'");
    expect(config).toContain("'**/*.bench.test.ts'");
    expect(config).toContain('fileParallelism: false');

    const scripts = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    // `test` 必须是两次独立调用：漏掉后半，heavy 档的文件会同时被 functional 的 exclude
    // 排掉、又没有任何车道跑它——静默消失且门禁全绿。
    expect(scripts.scripts['test']).toContain('--project functional');
    expect(scripts.scripts['test']).toContain('--project heavy');
    expect(scripts.scripts.bench).toContain('--project bench');
    expect(scripts.scripts.verify ?? '').not.toContain('bench');
  });

  it('heavy 档清单里的每个文件都真实存在', () => {
    // 清单自核：路径写错或文件改名后，该文件既被 functional 的 exclude 排掉、又匹配不上
    // heavy 的 include，于是**一个用例都不跑而门禁全绿**。这是 include／exclude 分档
    // 最贵的失效方式，所以要有一条正向断言盯着清单本身。
    const config = read('vitest.config.ts');
    const block = /const HEAVY_TEST_FILES = \[([\s\S]*?)\];/u.exec(config);
    expect(block, 'vitest.config.ts 里找不到 HEAVY_TEST_FILES 清单').not.toBeNull();
    const listed = [...(block?.[1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1])
      .filter((relative): relative is string => relative !== undefined);
    expect(listed.length, 'heavy 档清单为空，等于这条车道不存在').toBeGreaterThan(0);
    const missing = listed.filter((relative) => !REPO_FILES.includes(relative));
    expect(missing, 'heavy 档清单里有文件已不存在，把它删掉或改准路径').toEqual([]);
  });

  it('基准车道里确实有用例，不给自己留空挡', () => {
    const benchFiles = pathsUnder(...SOURCE_ROOTS).filter((relative) =>
      relative.endsWith('.bench.test.ts'),
    );
    expect(benchFiles.length, '至少要有一条串行车道基准').toBeGreaterThan(0);
    for (const benchFile of benchFiles) {
      expect(read(benchFile), '基准用例必须打印样本值，否则红了无法判断是回归还是抢核').toContain(
        'console.warn',
      );
    }
  });
});

describe('规则与文档索引', () => {
  it('当前组件台账与真实导出双向一致', () => {
    const sources = productionPathsUnder('apps/desktop/src/renderer/src/components/')
      .filter((file) => file.endsWith('.tsx'))
      .map((file) => ({ file, text: read(file) }));
    expect(componentCatalogIssues(read('docs/10-ui-ux-system.md'), sources)).toEqual([]);
  });

  it('所有现行门禁摘要包含实际 verify 的完整步骤', () => {
    const pipeline = (
      JSON.parse(read('package.json')) as { scripts: { verify: string } }
    ).scripts.verify
      .split(' && ')
      .map((command) => command.replace(/^npm (?:run )?/u, '').trim());
    expect(pipeline).toEqual(['lint', 'format:check', 'typecheck', 'test', 'build', 'ui:check']);
    for (const file of [
      'AGENTS.md',
      'docs/12-engineering-standards.md',
      'docs/11-qoder-handoff.md',
      '.qoder/rules/betterwork-code-style.md',
      '.qoder/rules/betterwork-dev-cycle.md',
    ]) {
      const summaries = [...read(file).matchAll(/lint\s*\+\s*format:check(?:\s*\+\s*[\w:]+)+/gu)];
      expect(summaries.length, `${file} 缺少可核对的门禁摘要`).toBeGreaterThan(0);
      for (const summary of summaries)
        expect(
          summary[0].split('+').map((item) => item.trim()),
          file,
        ).toEqual(pipeline);
    }
  });

  it('讨论节点复用勾选组与徽标，不恢复旧的自造表面', () => {
    const file = read('apps/desktop/src/renderer/src/components/DiscussionCheckpointPanel.tsx');
    expect(file).toMatch(/<CheckList\b/u);
    expect(file).toMatch(/<Badge\b/u);
    expect(file).not.toMatch(/<input\b|data-status=/u);
    expect(read('apps/desktop/src/renderer/src/styles.css')).not.toMatch(
      /\.discussion-checkpoint-history span|\.discussion-checkpoint-artifacts label/u,
    );
  });
  it('.qoder/rules 下的每个规则文件都登记在场景索引里', () => {
    const index = read('.qoder/rules/betterwork.md');
    const unregistered = REPO_FILES.filter(
      (relative) =>
        relative.startsWith('.qoder/rules/') &&
        relative.endsWith('.md') &&
        relative !== '.qoder/rules/betterwork.md' &&
        !index.includes(path.posix.basename(relative)),
    );
    expect(unregistered, '未登记的规则文件不会被 Qoder 加载，等于不存在').toEqual([]);
  });

  it('编码规范速查文件的每条复述都要带出处', () => {
    // `.qoder/rules/betterwork-code-style.md` 是 docs/12 的速查复述：它被自动加载，读到它的
    // 概率远高于人手去翻 docs/12，所以最危险的不是它啰嗦，而是它与出处**各说一套**。
    // IPC 收口判据就在这里漂过一次（账本 P3-11：四处两种措辞，本文件那处直到 2026-09-29
    // 才对齐）。要求每条复述句末带 `§N`，让「这条出自哪一节」永远可查——没有出处的复述
    // 等于另立标准，漂移时没人能判断哪一份对。
    //
    // **本条只管这一个文件**，不是「所有规则文件」。2026-09-29 实测另外 5 个规则文件共
    // 38 条复述缺出处（ui 9／diagnosis 2／knowledge 7／ipc-artifact 10／dev-cycle 10），
    // 扩过去要先逐条核准目标小节存在（写错指针比不写更糟），已按实数登记进账本 §8 待派发。
    const relative = '.qoder/rules/betterwork-code-style.md';
    const bullets = read(relative)
      .split('\n')
      .filter((line) => line.startsWith('- '));
    expect(bullets.length, '速查文件里没有复述条目，本条护栏已空跑').toBeGreaterThan(0);
    const unsourced = bullets.filter((line) => !/§\d/u.test(line)).map((line) => line.slice(0, 40));
    expect(
      unsourced,
      `${relative} 的每条复述都要标出处（docs/12 §N 或 AGENTS.md §N），否则它就是第二份标准`,
    ).toEqual([]);
  });

  it('两个智能体入口都指向同一份工程规范', () => {
    const standard = 'docs/12-engineering-standards.md';
    expect(read('AGENTS.md'), 'Codex 入口 AGENTS.md 必须指向唯一规范').toContain(standard);
    expect(
      read('.qoder/rules/betterwork-code-style.md'),
      'Qoder 入口 betterwork-code-style.md 必须指向唯一规范',
    ).toContain(standard);
  });

  it('一级导航标签与 docs/10 §6.1 的称呼表两侧一致', () => {
    // 侧栏有哪几项是**代码**说了算（`PRIMARY_NAV_ITEMS`），页面叫什么、页头写哪句是
    // docs/10 §6.1 那张表说了算。2026-09-30 的漂移不是有人改了代码，是引用方凭印象造了
    // 一个从未存在的页面名（把「技能页」写成「能力页」）——所以两侧都要钉：表里的导航列
    // 必须与代码一致，代码将来改名而文档不跟同样红。
    const appSource = read('apps/desktop/src/renderer/src/App.tsx');
    const declarationStart = appSource.indexOf('PRIMARY_NAV_ITEMS');
    expect(declarationStart, '找不到 PRIMARY_NAV_ITEMS，本条护栏已空跑').toBeGreaterThan(-1);
    const declaration = appSource.slice(
      declarationStart,
      appSource.indexOf('];', declarationStart) === -1
        ? appSource.length
        : appSource.indexOf('];', declarationStart),
    );
    const navLabels = [...declaration.matchAll(/label: '([^']+)'/gu)]
      .map((match) => match[1] ?? '')
      .filter((label) => label !== '');
    expect(navLabels, 'PRIMARY_NAV_ITEMS 里解析不出导航标签，本条护栏已空跑').not.toHaveLength(0);

    const governance = read('docs/10-ui-ux-system.md');
    const sectionStart = governance.indexOf('### 6.1 应用级导航');
    expect(sectionStart, 'docs/10 §6.1 的标题被改名，本条护栏已空跑').toBeGreaterThan(-1);
    const sectionEnd = governance.indexOf('### 6.1.1', sectionStart);
    const section = governance.slice(sectionStart, sectionEnd === -1 ? undefined : sectionEnd);
    const tableNavColumn = [...section.matchAll(/^\| ([^|]+?) \| [^|]+?\|/gmu)]
      .map((match) => match[1]?.trim() ?? '')
      .filter((cell) => cell !== '' && !/^-+$/.test(cell) && cell !== '一级导航');
    for (const label of navLabels) {
      expect(
        tableNavColumn,
        `代码里的导航项「${label}」没有登记进 docs/10 §6.1 的称呼表（docs/10 §6.1）`,
      ).toContain(label);
    }
    expect(
      tableNavColumn.filter((cell) => !navLabels.includes(cell)),
      '称呼表的导航列多出代码里没有的项；设置是侧栏底部项，不在一级导航里',
    ).toEqual(['设置']);
  });

  it('退役的页面称呼不得回到会被智能体读取的文本里', () => {
    // 「能力」是模型／技能／MCP／搜索的**总称**，不是任何页面的名字（docs/10 §6.1）。
    // 「能力页」在 2026-09-09 的日志与 2026-09-30 的走查清单里各出现过一次——历史文本里的
    // 错名会被下一次引用捞回来，所以把它钉成绊线。
    //
    // **范围是「会被当成指令读」的文本**：AGENTS.md、`.qoder/**` 下的规则与规格、渲染层源码
    // 与样式。docs/** 不锁——退役这件事本身要在文档里写明，锁住它等于禁止记录；那次改准的
    // 事实记在 docs/logs/2026-09-30.md。`docs/prototype/skills-view/index.html` 也不锁：
    // 它是 2026-09-09 拍板时的评审快照，改它等于改掉当时被批准的那件东西。
    const retiredPageNames = ['能力页'];
    const scanned = REPO_FILES.filter(
      (file) =>
        /^\.qoder\/.*\.md$/.test(file) ||
        file === 'AGENTS.md' ||
        (/^apps\/desktop\/src\/renderer\/.*\.(ts|tsx|css)$/.test(file) &&
          !/^apps\/desktop\/src\/renderer\/.*\.test\.(ts|tsx)$/.test(file)),
    );
    expect(scanned, '一条没扫到文件的绊线等于没写，本条护栏已空跑').not.toHaveLength(0);
    const offenders: string[] = [];
    for (const relative of scanned) {
      const text = read(relative);
      for (const name of retiredPageNames) {
        if (text.includes(name)) offenders.push(`${relative} → ${name}`);
      }
    }
    expect(
      offenders,
      '页面称呼只有一张表：一级导航是 工作／成果／知识／技能／专家，Skill 管理那一页叫技能页（docs/10 §6.1）',
    ).toEqual([]);
  });
});

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
    selector: '.abacus::before, .abacus::after',
    property: 'width',
    value: '24px',
    reason: '品牌算珠的横梁（配 height 1px），属品牌标志不是图标底座',
  },
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
