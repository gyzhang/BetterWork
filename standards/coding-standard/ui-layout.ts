import { describe, expect, it } from 'vitest';

import {
  assertRetiredClassesAbsent,
  classesOf,
  cssPaths,
  declarationsOf,
  locate,
  pathsUnder,
  productionPathsUnder,
  read,
  resolvePixels,
  RETIRED_UTILITY_CLASSES,
} from '../coding-standard-support';
import { type CssDeclaration } from '../ui-governance';

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

/**
 * 清单条目里「就是一个类名」的那一部分（`.chip-button(?![-\w])` → `chip-button`）。
 * 复合选择器（`.card-actions button`）不是 className，取不到就返回 `undefined`；
 * 没有 `(?![-\w])` 收尾的条目也跳过——它本来就会命中同类名前缀，不能当精确名字用。
 */
function singleRetiredClassName(pattern: RegExp): string | undefined {
  const match = /^\\\.([a-z][\w-]*)\(\?!/.exec(pattern.source);
  return match?.[1];
}

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
    selector: ".empty-context[data-placement='start']",
    property: 'padding',
    reason: '上下文页签空态的首块与其他段落共用 16px 水平内缩',
  },
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
    pixels: 8,
    reason: '同上：动作组横向内距使用 `--space-8`',
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

  it('页头与页签到首块内容只留 12px 入口缝', () => {
    const valueOf = (selector: string, property: string): string[] =>
      declarations
        .filter(
          (declaration) => declaration.selector === selector && declaration.property === property,
        )
        .map((declaration) => declaration.value);
    expect(valueOf(':root', '--content-start-gap')).toEqual(['var(--space-12)']);
    expect(valueOf(':root', '--surface-padding-page')).toEqual(['var(--content-start-gap) 0 48px']);
    for (const [selector, property, expected] of [
      ['.page-body', 'padding', 'var(--surface-padding-page)'],
      ['.workspace', 'padding-top', 'var(--content-start-gap)'],
      ['.context-content', 'padding-top', 'var(--content-start-gap)'],
      ['.memory-settings', 'gap', 'var(--content-start-gap)'],
      [
        ".modal-panel[data-variant='sheet'].schedule-source-sheet",
        'gap',
        'var(--content-start-gap)',
      ],
      ['.memory-settings .page-toolbar', 'margin-bottom', '0'],
      ['.discussion-checkpoints', 'margin', '0 auto var(--space-12)'],
      ['.message-flow', 'padding', '0 0 12px'],
      ['.context-section', 'padding', '0 16px 12px'],
      ['.activity-list', 'padding', '0 16px 12px'],
      ['.brief-panel', 'padding', '0 16px 16px'],
      [".empty-context[data-placement='start']", 'padding', '0 16px 12px'],
    ] as const) {
      expect(valueOf(selector, property), `${selector} 的入口间距偏离了 docs/10 §8.3`).toEqual([
        expected,
      ]);
    }
    const bodyModifiers = new Set<string>();
    for (const relative of productionPathsUnder('apps/desktop/src/renderer/')) {
      if (!relative.endsWith('.tsx')) continue;
      for (const match of read(relative).matchAll(/className="([^"]*\bpage-body\b[^"]*)"/gu)) {
        for (const name of (match[1] ?? '').split(/\s+/u)) {
          if (name && name !== 'page-body') bodyModifiers.add(`.${name}`);
        }
      }
    }
    const offenders = declarations
      .filter((declaration) =>
        ['padding', 'padding-top', 'padding-block-start', 'margin-top'].includes(
          declaration.property,
        ),
      )
      .filter((declaration) =>
        declaration.selector.split(',').some((part) => bodyModifiers.has(part.trim())),
      )
      .filter(
        (declaration) =>
          declaration.selector !== '.message-flow' ||
          declaration.property !== 'padding' ||
          declaration.value !== '0 0 12px',
      )
      .map((declaration) => locate(declaration, styles ?? ''));
    expect(offenders, '页面正文变体不得另补顶部间距，入口缝只由骨架拥有').toEqual([]);
  });

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
    {
      match: '.popover-menu.workspace-selector-menu',
      reason: '工作空间选择器的领域菜单宽度，受视口约束且不构成页面版心',
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
