import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * 规范护栏。
 *
 * `eslint.config.mjs` 与 `.prettierrc.json` 管住了「一个文件内部的写法」，但管不住
 * 跨文件的结构性约定：规范配置本身会不会被复制成第二份、豁免注释会不会悄悄出现、
 * 分层边界会不会被绕过、主题 Token 会不会被硬编码色值架空。这些约定写在
 * `docs/12-engineering-standards.md` 里，本文件是它们的可执行形式。
 *
 * 例外一律写成下面的显式白名单并注明理由（docs/12 §10），不允许在源码里就地豁免。
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const PRUNED_DIRECTORIES = new Set(['.git', 'coverage', 'dist', 'node_modules', 'out', 'release']);

/** 生产源码的扫描根。本护栏自身在 `standards/`，因此不会与被扫描的字符串互相污染。 */
const SOURCE_ROOTS = ['apps/', 'packages/', 'scripts/'] as const;

function collectFiles(directory: string): string[] {
  const collected: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (PRUNED_DIRECTORIES.has(entry.name)) continue;
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

interface CssDeclaration {
  selector: string;
  property: string;
  value: string;
  line: number;
}

/**
 * 最小 CSS 声明扫描器：只关心「哪个选择器块里写了哪条声明」，
 * 保留行号以便失败时能直接定位，并且保留 `@media` 等外层块作为选择器前缀。
 */
function parseCssDeclarations(css: string): CssDeclaration[] {
  // 注释按等长空白替换，行号因此与源文件保持一致。
  const source = css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
  const declarations: CssDeclaration[] = [];
  const selectorStack: string[] = [];
  let buffer = '';
  let line = 1;
  for (const char of source) {
    if (char === '\n') {
      line += 1;
      buffer += char;
      continue;
    }
    if (char === '{') {
      selectorStack.push(buffer.trim().replace(/\s+/g, ' '));
      buffer = '';
      continue;
    }
    if (char === '}') {
      selectorStack.pop();
      buffer = '';
      continue;
    }
    if (char === ';') {
      const declaration = buffer.trim();
      const colon = declaration.indexOf(':');
      if (colon > 0 && selectorStack.length > 0) {
        declarations.push({
          selector: selectorStack.join(' '),
          property: declaration.slice(0, colon).trim(),
          value: declaration.slice(colon + 1).trim(),
          line,
        });
      }
      buffer = '';
      continue;
    }
    buffer += char;
  }
  return declarations;
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
    const offenders = REPO_FILES.filter((relative) => {
      if (relative.endsWith('.env.example')) return false;
      return /(^|\/)\.env(\.[^/]*)?$/.test(relative) || /\.(db|sqlite|sqlite3)$/.test(relative);
    });
    expect(offenders, '这些文件属于本机运行产物或凭据，不得进入仓库（AGENTS.md §7）').toEqual([]);
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
      { match: '.current-badge', reason: '当前模型徽标' },
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

describe('规则与文档索引', () => {
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

  it('两个智能体入口都指向同一份工程规范', () => {
    const standard = 'docs/12-engineering-standards.md';
    expect(read('AGENTS.md'), 'Codex 入口 AGENTS.md 必须指向唯一规范').toContain(standard);
    expect(
      read('.qoder/rules/betterwork-code-style.md'),
      'Qoder 入口 betterwork-code-style.md 必须指向唯一规范',
    ).toContain(standard);
  });
});
