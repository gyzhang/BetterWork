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

  it('间距只用标尺上的档位', () => {
    const SCALE = new Set([4, 8, 12, 16, 24, 32]);
    const offenders: string[] = [];
    for (const declaration of declarations) {
      if (!['gap', 'row-gap', 'column-gap'].includes(declaration.property)) continue;
      for (const match of declaration.value.matchAll(/(\d+(?:\.\d+)?)px/g)) {
        const pixels = Number(match[1]);
        if (pixels !== 0 && !SCALE.has(pixels)) offenders.push(locate(declaration, styles ?? ''));
      }
    }
    expect(offenders, '间距只允许 4 / 8 / 12 / 16 / 24 / 32px 档位（docs/10 §9.8）').toEqual([]);
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
const OVERLAY_SHADOW_BASELINE = 4;
const OVERLAY_SURFACES: { readonly match: string; readonly reason: string }[] = [
  { match: '.popover-menu', reason: '菜单类浮层基座（ADR-0012）' },
  {
    match: '.modal-panel',
    reason: '模态与覆盖层基座（docs/10 §10.1）：确认框、模型抽屉、放映层、消息中心共用这一层外壳',
  },
  { match: '.toast', reason: '全局结果提示' },
  { match: '.action-error-banner', reason: '全局错误横幅' },
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
      if (owners.includes(relative)) continue;
      const body = read(relative);
      const usesBase =
        body.includes('useOverlaySemantics') ||
        /from '.*\/Modal'/.test(body) ||
        /from '.*\/PopoverMenu'/.test(body);
      const bespoke: string[] = [];
      if (!usesBase && /role="dialog"|role="alertdialog"/.test(body))
        bespoke.push('自写 role=dialog');
      if (!usesBase && /aria-modal/.test(body)) bespoke.push('自写 aria-modal');
      if (!usesBase && /key === 'Escape'/.test(body)) bespoke.push('自写 Esc 处理');
      if (/sheet-backdrop|dialog-backdrop/.test(body)) bespoke.push('引用已收编的旧背板类');
      if (bespoke.length > 0) offenders.push(`${relative}：${bespoke.join('、')}`);
    }
    expect(offenders, '模态与覆盖层请复用 Modal／useOverlaySemantics（docs/10 §10.1）').toEqual([]);
  });
});

/** 表单控件与三档按钮的几何必须来自 Token；这些正则与迁移脚本保持同一套口径。 */
const CONTROL_SELECTOR =
  /(^|[,>\s])input\b|(^|[,>\s])select\b|(^|[,>\s])textarea\b|\.field-select-trigger|\.primary-button|\.secondary-button|\.text-button/;
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
  readonly family: 'action-bar' | 'badge' | 'borrow' | 'empty' | 'heading' | 'nav' | 'row';
}[] = [
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
  family: 'action-bar' | 'badge' | 'borrow' | 'empty' | 'heading' | 'nav' | 'row',
): void {
  const retired = RETIRED_UTILITY_CLASSES.filter((entry) => entry.family === family);
  for (const relative of cssPaths()) {
    for (const declaration of declarationsOf(relative)) {
      const hit = retired.find((entry) => entry.pattern.test(declaration.selector));
      if (hit) offenders.push(`${relative} → ${hit.name}`);
    }
  }
}

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

  it('表单控件的边框、圆角与高度来自控件 Token', () => {
    const raw = new RegExp(`^(border|border-radius|min-height)$`);
    const offenders: string[] = [];
    for (const declaration of declarations) {
      if (!raw.test(declaration.property)) continue;
      if (!CONTROL_SELECTOR.test(declaration.selector)) continue;
      if (CONTROL_EXEMPTIONS.test(declaration.selector)) continue;
      if (declaration.value.startsWith('var(--control-')) continue;
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
      if (declaration.property === 'min-height' && !/^\d+px$/.test(declaration.value)) continue;
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

/** 24–40px 带内的唯一例外：两行文本的钳制高度，既不是控件也不是行（docs/10 §9.10）。 */
const TEXT_MIN_HEIGHT_EXEMPTION = ['.expert-card-desc'];

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
  { match: '.current-badge', value: '4px', reason: '当前模型徽标' },
  { match: '.mode-preview b', value: '4px', reason: '外观模式预览色板' },
  { match: '.scheme-preview i', value: '3px', reason: '色系预览色块' },
  { match: '.artifact-evidence-list b', value: '4px', reason: '来源格式微标' },
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
    { match: '.chip-button', reason: '具名按钮皮类（docs/10 §10.1），不是状态片' },
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
        if (TEXT_MIN_HEIGHT_EXEMPTION.some((entry) => selector.includes(entry))) continue;
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
    const offenders = declarations
      .map((declaration) => ({
        declaration,
        selector: declaration.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
      }))
      .filter(({ selector }) => {
        if (!selector.includes('.list-row')) return false;
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
    // 迁进 ListRow 后，`.memory-row` 这样的名字还要承担状态外观（左侧状态条、降饱和）。
    // 允许它活着的前提是行骨架不从它身上长回来——否则第 13 套行几何只是换了个入口。
    const ROW_HOOK_CLASSES = ['memory-row'];
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

describe('导航列表纪律', () => {
  const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
  expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
  const declarations = declarationsOf(styles ?? '');

  /** 基座自己渲染 `' active'` 高亮（键盘项），它们的类名与状态词不算自造选中态。 */
  const NAV_BASE_FILES = [
    'apps/desktop/src/renderer/src/components/NavList.tsx',
    'apps/desktop/src/renderer/src/components/PopoverMenu.tsx',
  ];

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
  it('内联提示只承载可行动的失败原因', () => {
    // docs/10 §11.5.1 只有三个落点，`.inline-message` 是其中的错误态。
    // 知识页曾把「来源检查完成（9/9）」写成常驻 `.inline-message`：与消息中心重复，
    // 而且没有任何清除路径——只有下一次动作会覆盖它。
    const offenders = pathsUnder('apps/desktop/src/renderer/')
      .filter((relative) => /\.tsx$/.test(relative) && !/\.test\.tsx$/.test(relative))
      .filter((relative) => /className="inline-message(?! error)"/.test(read(relative)));
    expect(
      offenders,
      '成功与信息走 TransientToast（自消、不落库）；内联只留 .inline-message.error（docs/10 §11.5.1）',
    ).toEqual([]);
  });

  it('.inline-message 不得长出错误以外的配色变体', () => {
    const styles = cssPaths().find((relative) => relative.endsWith('styles.css')) ?? '';
    const offenders = declarationsOf(styles)
      .map((declaration) => ({
        declaration,
        selector: declaration.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
      }))
      .filter(({ selector }) => /\.inline-message\.(?!error\b)[a-z]/.test(selector))
      .map(({ declaration }) => locate(declaration, styles));
    expect(
      offenders,
      '内联提示只有错误态；再补一个 .inline-message.success 就是第二个成功通道',
    ).toEqual([]);
  });

  it('内联提示的基础类不得自带配色，也不得自带上下缝', () => {
    // 上面两条只看「渲染层有没有裸用法」和「有没有别的变体类」，所以基础规则里的
    // `color: var(--success)` 与 `margin: 15px 0` 一直活着：谁写一句 `<p className="inline-message">`
    // 就得到一条绿色成功横幅（第二个成功通道），而 22 处已由容器 gap 提供缝的位置被它再叠一道。
    // 配色归 `.inline-message.error`，上下缝归承载它的那个容器（docs/10 §9.8、§11.5.1）。
    const styles = cssPaths().find((relative) => relative.endsWith('styles.css')) ?? '';
    // 选择器组按逗号拆开逐个判，否则 `.field-error, .inline-message { … }` 整组漏网。
    const partsOf = (selector: string): string[] =>
      selector
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    const colorOffenders = declarationsOf(styles)
      .filter(({ selector }) =>
        partsOf(selector).some(
          (part) => /\.inline-message(?![\w-])/.test(part) && !/\.error\b/.test(part),
        ),
      )
      .filter(({ property }) => property === 'color' || property.startsWith('background'))
      .map((declaration) => locate(declaration, styles));
    expect(colorOffenders, '内联提示的配色只能由错误态提供').toEqual([]);

    // 只审裸选择器（`.inline-message` 单独成条）。容器侧写成 `.某页面 > .inline-message`
    // 正是「缝由承载它的位置拥有」的写法，不在本条范围内。
    const marginOffenders = declarationsOf(styles)
      .filter(({ selector }) =>
        partsOf(selector).some((part) => /^\.inline-message(?![\w-])$/.test(part)),
      )
      .filter(({ property }) => property.startsWith('margin'))
      .map((declaration) => locate(declaration, styles));
    expect(
      marginOffenders,
      '上下缝由容器拥有：`.inline-message` 自带 margin 会在已有 gap 的容器里叠成双缝（docs/10 §9.8）',
    ).toEqual([]);
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

  it('两条车道的配置与脚本各就各位，且 verify 不含基准', () => {
    const config = read('vitest.config.ts');
    expect(config).toContain("name: 'functional'");
    expect(config).toContain("name: 'bench'");
    expect(config).toContain("'**/*.bench.test.ts'");
    expect(config).toContain('fileParallelism: false');

    const scripts = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(scripts.scripts['test']).toContain('--project functional');
    expect(scripts.scripts.bench).toContain('--project bench');
    expect(scripts.scripts.verify ?? '').not.toContain('bench');
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

  it('两个智能体入口都指向同一份工程规范', () => {
    const standard = 'docs/12-engineering-standards.md';
    expect(read('AGENTS.md'), 'Codex 入口 AGENTS.md 必须指向唯一规范').toContain(standard);
    expect(
      read('.qoder/rules/betterwork-code-style.md'),
      'Qoder 入口 betterwork-code-style.md 必须指向唯一规范',
    ).toContain(standard);
  });
});
