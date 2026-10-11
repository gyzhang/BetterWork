import { describe, expect, it } from 'vitest';

import {
  cssPaths,
  declarationsOf,
  jsxOpenTag,
  locate,
  pathsUnder,
  productionPathsUnder,
  read,
} from '../coding-standard-support';

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
 * 勾选行（复选框与文字同排）不是「标签 + 控件」结构，保留自己的排版；
 * 新增条目要说明为什么它不算表单字段，否则应改用 Field。
 */
const CHECKBOX_ROW_LABEL_SELECTORS: { readonly match: string; readonly reason: string }[] = [
  { match: '.skill-trust-box label', reason: 'Skill 信任确认行：框在左、说明在右' },
];

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
      let resolved = actual;
      for (let depth = 0; depth < 4; depth += 1)
        resolved = resolved.replace(
          /var\((--[a-z0-9-]+)\)/gu,
          (reference, name: string) => root.get(name) ?? reference,
        );
      if (normalize(documented) !== resolved) {
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
