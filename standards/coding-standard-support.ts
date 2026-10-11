import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type CssDeclaration, parseCssDeclarations } from './ui-governance';

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

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

export const PRUNED_DIRECTORIES = new Set([
  '.git',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'release',
]);

/** 生产源码的扫描根。护栏自身的几何与分层判据只针对产品代码，本文件不计入。 */
export const SOURCE_ROOTS = ['apps/', 'packages/', 'scripts/'] as const;

export function collectFiles(directory: string): string[] {
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

export const REPO_FILES: string[] = collectFiles(REPO_ROOT)
  .map((absolute) => path.relative(REPO_ROOT, absolute).split(path.sep).join('/'))
  .sort();

export function pathsUnder(...roots: string[]): string[] {
  return REPO_FILES.filter((relative) => roots.some((root) => relative.startsWith(root)));
}

export function sourcePathsUnder(...roots: string[]): string[] {
  return pathsUnder(...roots).filter((relative) => /\.(ts|tsx|mts|cts)$/.test(relative));
}

export function productionPathsUnder(...roots: string[]): string[] {
  return sourcePathsUnder(...roots).filter((relative) => !/\.test\.tsx?$/.test(relative));
}

export function read(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

export function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s*'([^']+)'/g), ...source.matchAll(/^\s*import\s*'([^']+)'/gm)]
    .map((match) => match[1] ?? '')
    .filter((specifier) => specifier.length > 0);
}

export const declarationCache = new Map<string, CssDeclaration[]>();

export function declarationsOf(relativePath: string): CssDeclaration[] {
  const cached = declarationCache.get(relativePath);
  if (cached) return cached;
  const parsed = parseCssDeclarations(read(relativePath));
  declarationCache.set(relativePath, parsed);
  return parsed;
}

export function cssPaths(): string[] {
  return pathsUnder('apps/', 'packages/').filter((relative) => relative.endsWith('.css'));
}

export function locate(declaration: CssDeclaration, relativePath: string): string {
  return `${relativePath}:${declaration.line} ${declaration.selector} { ${declaration.property}: ${declaration.value} }`;
}

/**
 * 从 `<` 处读出一个 JSX 开标签：属性文本只保留花括号深度 0 的部分。
 *
 * 动作排与输入控件两条护栏都要它：属性里的箭头函数带 `>`，用正则截到第一个 `>`
 * 会把标签读断；花括号深度只在 0 时才算标签自己的收尾。
 */
export function jsxOpenTag(
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

export function parsePixels(value: string): number | undefined {
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
export function resolvePixels(declarations: CssDeclaration[], value: string): number | undefined {
  const direct = parsePixels(value);
  if (direct !== undefined) return direct;
  const token = /^var\((--[a-zA-Z0-9-]+)\)$/.exec(value)?.[1];
  if (!token) return undefined;
  const definition = declarations.find((declaration) => declaration.property === token);
  return definition ? parsePixels(definition.value) : undefined;
}

/** docs/10 §8.3 点名的页面骨架类。`ViewContainer` 用 `view-container-${mode}` 拼出变体，
 *  静态扫描取不到，因此显式登记。 */
export const SKELETON_CLASSES = [
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
 * 已被基座收编的自造类：样式不得复活（Badge 收 chip、EmptyState 收占位、ListRow 收行几何、
 * SectionHeader 收区块头）。
 * 行类一律用 `(?![-\w])` 收尾——`\b` 在连字符处也算词边界，会把仍在用的
 * `.knowledge-card-select` 当成复活的 `.knowledge-card`。
 */
export const RETIRED_UTILITY_CLASSES: {
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
export function assertRetiredClassesAbsent(
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

/** 选择器里出现的类名清单（注释已在解析前被抹平，不会误伤说明文字）。 */
export function classesOf(selector: string): string[] {
  return [...selector.matchAll(/\.[-\w]+/g)].map((match) => match[0] ?? '');
}
