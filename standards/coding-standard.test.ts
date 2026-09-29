import { execFileSync } from 'node:child_process';
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
    const pixels = parsePixels(baseline?.value ?? '');
    expect(pixels, 'small 基线必须用 px 或 rem 才能判定').toBeDefined();
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
 * 逐条理由：勾选框的盒几何由 `--control-check-size` 与 UA 决定；`:focus`／`:hover`
 * 只改颜色不改几何；`.workspace-row input` 是行内改名用的透明输入框，没有边框；
 * `.composer textarea` 的左右内距归 `.composer`，它自己只留上下 11px；
 * `textarea[readonly]` 与 `.counted` 是展示用的只读文本块，不是编辑控件。
 */
const CONTROL_EXEMPTIONS =
  /checkbox|::placeholder|:focus|:hover|\.workspace-row input|\.composer textarea|textarea\[readonly\]|counted/;

/**
 * 勾选行（复选框与文字同排）不是「标签 + 控件」结构，保留自己的排版；
 * 新增条目要说明为什么它不算表单字段，否则应改用 Field。
 */
const CHECKBOX_ROW_LABEL_SELECTORS: { readonly match: string; readonly reason: string }[] = [
  { match: '.discussion-checkpoint-artifacts label', reason: '成果版本勾选行：框在左、标题在右' },
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

  it('焦点环只有一种写法', () => {
    const offenders = declarations
      .filter((declaration) => declaration.property === 'outline')
      .filter((declaration) => declaration.value.includes('--focus-ring'))
      .filter((declaration) => declaration.value !== '2px solid var(--focus-ring)');
    expect(
      offenders.map((declaration) => locate(declaration, styles ?? '')),
      '聚焦指示必须同宽同色，1px 的环在深色底上几乎看不见（docs/10 §9.11）',
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
  it('一条动作条里的按钮必须同档', () => {
    // 本轮的起点就是这条：专家修订页「保存修订」36px 与「取消」28px 差 8px，
    // 主行动被自己的同伴衬成一块砖。`size` 刻意不做条件缺省，所以同排同档
    // 必须由调用点保证——不锁住它就会长回来。
    const offenders: string[] = [];
    for (const relative of productionPathsUnder('apps/desktop/src/renderer/')) {
      if (!relative.endsWith('.tsx')) continue;
      const text = read(relative);
      for (const match of text.matchAll(/<ActionBar\b[\s\S]*?<\/ActionBar>/g)) {
        const block = match[0];
        // 只数按钮的档位：图标按钮的 `size` 与基座自己的属性不算。
        const steps = [...block.matchAll(/\bsize="([a-z]+)"/g)].map((m) => m[1] ?? 'md');
        const distinct = [...new Set(steps)];
        if (distinct.length > 1) {
          const line = text.slice(0, match.index ?? 0).split('\n').length;
          offenders.push(`${relative}:${line} 动作条里出现 ${distinct.join('／')}`);
        }
      }
    }
    expect(
      offenders,
      'ActionBar 是一「排」动作，主行动与取消必须同档（docs/10 §10.1、ADR-0031）',
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
  ];

  it('已废弃的自造状态说明表面不得复活', () => {
    // `.memory-pending-governance` 与 `.appearance-note` 借的是反馈表面的壳（`padding: 10px 12px`
    // ＋ soft 底色），讲的却是一句常驻状态，读起来像「刚刚出事了」；`.success-copy` 的绿字
    // 靠 `!important` 才盖得住容器的 `> p` 规则。三者都已并入 `StatusNote`。
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
    expect(offenders, '一句只读状态说明只能用 StatusNote（docs/10 §11.5.2、§10.1 台账）').toEqual(
      [],
    );
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
});
