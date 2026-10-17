import { describe, expect, it } from 'vitest';

import {
  assertRetiredClassesAbsent,
  cssPaths,
  declarationsOf,
  jsxOpenTag,
  locate,
  parsePixels,
  pathsUnder,
  productionPathsUnder,
  read,
} from '../coding-standard-support';

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
   * 「一种几何，六个出口」这句话必须能被计数（ADR-0035 后果第 2 条）。
   *
   * ADR-0034 写下「聚焦环只剩一处出口」时它并不成立，因为从来没人核过清单与存量是否等量。
   * 新增一个吃环的表面必须在这里写明它是谁、为什么落不到全局那条元素规则上——`summary` 就是
   * 一个走不通的例子：它被「样式表不再点名 details／summary 元素」挡在外面，所以环由
   * `.disclosure-label` 这个类承载；可聚焦的 `tabpanel` 由 `.tab-panel` 承载。
   */
  it('焦点环的出口只有登记的那几处', () => {
    const RING_OUTLETS: readonly string[] = [
      // 宽表滚动区是可聚焦的 div，复用全局控件环，不新增一套环几何（docs/10 §8.3）。
      'button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, .markdown-table:focus-visible',
      '.disclosure-label:focus-visible',
      '.scroll-region:focus-visible',
      '.single-select-picker-option:has(input:focus-visible)',
      '.tab-panel:focus-visible',
      '.composer:has(textarea:focus-visible)',
      // Run 诊断树与时间轴按条目键盘访问，复用统一焦点环几何。
      '.run-execution-tree-entry:focus-visible, .run-diagnostic-timeline-item:focus-visible',
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
      { match: /^\.welcome h2$/, reason: '首屏任务问题标题的字号与紧凑排版' },
      {
        match: /^\.markdown-preview h[1-6]/,
        reason: '用户成果正文的文档排版，受 §9 的 Artifact 不套主题约束，不是 UI 小节头',
      },
      {
        match: /^\.message\.assistant \.markdown-preview h[1-6]$/,
        reason: '同上：对话里的 Markdown 成果排版',
      },
      {
        match:
          /^\.process-narration-entry \.markdown-preview h[1-3](,\s*\.process-narration-entry \.markdown-preview h[1-3])*$/,
        reason: '过程旁白中的模型消息正文沿用 Markdown 标题排版',
      },
      {
        match:
          /^(?:@media \(prefers-reduced-motion: reduce\) )?(?:\.process-narration-preview\.is-streaming,\s*)?\.process-narration-entry\[data-streaming='true'\] \.markdown-preview :is\(p, h1, h2, h3, li, blockquote, pre\)$/,
        reason: '活跃过程旁白的 Markdown 正文使用流式状态色',
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
