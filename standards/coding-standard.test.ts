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
const OVERLAY_SHADOW_BASELINE = 6;
const OVERLAY_SURFACES: { readonly match: string; readonly reason: string }[] = [
  { match: '.popover-menu', reason: '浮层基座（ADR-0012）' },
  { match: '.confirmation-dialog', reason: '模态确认框' },
  { match: '.notification-panel', reason: '待迁入 Modal 基座（缺 aria-expanded/Esc/焦点）' },
  { match: '.toast', reason: '全局结果提示' },
  { match: '.action-error-banner', reason: '全局错误横幅' },
  { match: '.slide-viewer', reason: '待迁入 Modal 基座（自写键盘与焦点）' },
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
});

/** 表单控件与三档按钮的几何必须来自 Token；这些正则与迁移脚本保持同一套口径。 */
const CONTROL_SELECTOR =
  /(^|[,>\s])input\b|(^|[,>\s])select\b|(^|[,>\s])textarea\b|\.field-select-trigger|\.primary-button|\.secondary-button|\.text-button/;
const CONTROL_EXEMPTIONS =
  /checkbox|::placeholder|:focus|:hover|\.workspace-row input|\.composer textarea|textarea\[readonly\]|counted/;

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
