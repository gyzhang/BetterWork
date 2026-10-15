import { describe, expect, it } from 'vitest';

import {
  cssPaths,
  declarationsOf,
  locate,
  parsePixels,
  productionPathsUnder,
  read,
  resolvePixels,
  SKELETON_CLASSES,
} from '../coding-standard-support';

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
      '时长只用 --motion-instant / --motion-expand / --motion-overlay / --motion-narration（docs/12 §8）',
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

  it('首帧窗口背景与青玉浅色 Canvas Token 保持一致', () => {
    const styles = cssPaths().find((relative) => relative.endsWith('styles.css'));
    expect(styles, '找不到 renderer 的 styles.css').toBeDefined();
    const jadeLight = declarationsOf(styles ?? '').filter(
      (declaration) =>
        declaration.selector.includes("data-theme='light'") &&
        declaration.selector.includes("data-scheme='jade'"),
    );
    const canvas = jadeLight.find((declaration) => declaration.property === '--canvas')?.value;
    expect(canvas, '青玉浅色 Variant 缺少 --canvas').toBeDefined();

    const hexLiterals = (source: string): string[] =>
      [...source.matchAll(/#([0-9a-fA-F]{6})\b/g)].map(
        (match) => `#${(match[1] ?? '').toLowerCase()}`,
      );

    expect(
      hexLiterals(read('apps/desktop/src/main/window.ts')),
      'INITIAL_WINDOW_THEME 背景色与青玉浅色 --canvas 不一致，冷启动会闪一下错误底色',
    ).toEqual([canvas]);
    expect(
      [...new Set(hexLiterals(read('apps/desktop/src/renderer/src/appearance.ts')))],
      'getWindowTheme 背景回退值与青玉浅色 --canvas 不一致',
    ).toEqual([canvas]);
  });
});

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

  /** `gap` 与 `margin` 共用六档原子 Token；位置语义只能引用已登记别名。 */
  it('组件间距只用六档 Token', () => {
    const SCALE = [4, 8, 12, 16, 24, 32] as const;
    const primitiveTokens = new Set(SCALE.map((size) => `--space-${size}`));
    const semanticTokens = new Set(['--card-gap', '--content-start-gap', '--nav-item-gap']);
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
    for (const size of SCALE) {
      const values = declarations
        .filter(
          (declaration) =>
            declaration.selector === ':root' && declaration.property === `--space-${size}`,
        )
        .map((declaration) => declaration.value);
      if (values.length !== 1 || values[0] !== `${size}px`)
        offenders.push(`--space-${size} 必须在 :root 唯一定义为 ${size}px`);
    }
    for (const declaration of declarations) {
      if (declaration.property.startsWith('--space-') && declaration.selector !== ':root')
        offenders.push(locate(declaration, styles ?? ''));
    }
    for (const alias of ['--card-gap', '--content-start-gap']) {
      const values = declarations
        .filter((declaration) => declaration.selector === ':root' && declaration.property === alias)
        .map((declaration) => declaration.value);
      if (values.length !== 1 || values[0] !== 'var(--space-12)')
        offenders.push(`${alias} 必须引用 --space-12，不另存 12px`);
    }
    for (const declaration of declarations) {
      if (!SPACING_PROPERTIES.includes(declaration.property)) continue;
      const refs = [...declaration.value.matchAll(/var\((--[a-z0-9-]+)/gu)].map(
        (match) => match[1] ?? '',
      );
      const onlyKnownTokens = refs.every(
        (token) => primitiveTokens.has(token) || semanticTokens.has(token),
      );
      const normalized = declaration.value
        .replace(/var\(--nav-item-gap,\s*var\(--space-12\)\)/gu, 'token')
        .replace(/var\(--[a-z0-9-]+\)/gu, 'token');
      if (!onlyKnownTokens || !/^(?:0|auto|token)(?:\s+(?:0|auto|token))*$/u.test(normalized))
        offenders.push(locate(declaration, styles ?? ''));
    }
    expect(
      offenders,
      'gap／margin 的非零缝只准引用 4／8／12／16／24／32 六档 Token；不直接写像素或临时变量（docs/10 §9.8）',
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
