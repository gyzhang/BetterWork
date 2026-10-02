import path from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import {
  componentCatalogIssues,
  fixedMaxWidthSelectors,
  inlineStyleIssues,
  pageCompositionIssues,
  parseCssDeclarations,
  surfaceShellSelectors,
  themeTokenIssues,
  type UiSource,
} from './ui-governance';

const root = 'apps/desktop/src/renderer/src/';
const view = `${root}views/ProbeView.tsx`;
const bases: UiSource[] = [
  {
    file: `${root}components/layout/PageHeader.tsx`,
    text: 'export function PageHeader() { return <header />; }',
  },
  {
    file: `${root}components/layout/ScrollRegion.tsx`,
    text: 'export function ScrollRegion({children}) { return <div>{children}</div>; }',
  },
];
const imports =
  "import { PageHeader } from '../components/layout/PageHeader'; import { ScrollRegion } from '../components/layout/ScrollRegion';";

describe('页面骨架的实际返回路径', () => {
  it('接受命名导入别名与跨文件包装的实际组合', () => {
    const sources = [
      ...bases,
      {
        file: `${root}components/ProbeShell.tsx`,
        text: "import { PageHeader as Header } from './layout/PageHeader'; import { ScrollRegion as Region } from './layout/ScrollRegion'; export function ProbeShell({children}) { return <><Header/><Region>{children}</Region></>; }",
      },
      {
        file: view,
        text: "import { ProbeShell as Shell } from '../components/ProbeShell'; export function ProbePage() { return <Shell>正文</Shell>; }",
      },
    ];
    expect(pageCompositionIssues(sources, [])).toEqual([]);
  });

  it.each([
    `${imports} export function ProbePage() { return <section>自造页面</section>; }`,
    `${imports} export const ProbePage = () => <section>箭头函数页面</section>;`,
    `${imports} export function ProbePage() { return <div onClick={() => <><PageHeader/><ScrollRegion/></>}>回调里的基座不算</div>; }`,
    `${imports} export function ProbePage({bad}) { return bad ? <div>另一分支</div> : <><PageHeader/><ScrollRegion/></>; }`,
    `${imports} function Shell({bad}) { if (bad) return <div>包装的另一分支</div>; return <><PageHeader/><ScrollRegion/></>; } export function ProbePage() { return <Shell/>; }`,
    `${imports} export function ProbePage({ready}) { return <>{ready && <PageHeader/>}<ScrollRegion/></>; }`,
    `${imports} export function ProbePage({bad}) { return <><PageHeader/>{bad ? <div/> : <ScrollRegion/>}</>; }`,
    `${imports} export function ProbePage() { return <div fake={<><PageHeader/><ScrollRegion/></>}/>; }`,
    `${imports} function Shell({ready}) { return ready ? <><PageHeader/><ScrollRegion/></> : null; } export function ProbePage() { return <Shell/>; }`,
  ])('拒绝未使用 import、事件回调伪使用和缺骨架分支：%s', (text) => {
    expect(pageCompositionIssues([...bases, { file: view, text }], [])).not.toEqual([]);
  });

  it('子树各条件分支均使用骨架时仍然通过', () => {
    const text = `${imports} export function ProbePage({ready}) { return <><PageHeader/>{ready ? <ScrollRegion>甲</ScrollRegion> : <ScrollRegion>乙</ScrollRegion>}</>; }`;
    expect(pageCompositionIssues([...bases, { file: view, text }], [])).toEqual([]);
  });

  it('登记的列表/空态选择逐分支核验，空态之外自造段落仍失败', () => {
    const empty = `${root}components/EmptyState.tsx`;
    const sources = [
      ...bases,
      { file: empty, text: 'export function EmptyNotice() { return <p/>; }' },
    ];
    const exception = {
      file: view,
      component: 'ProbePage',
      required: [`${root}components/layout/PageHeader.tsx#PageHeader`],
      alternatives: [
        [`${root}components/layout/ScrollRegion.tsx#ScrollRegion`, `${empty}#EmptyNotice`],
      ],
      reason: '内嵌列表或首读空态',
    };
    const text = `${imports} import {EmptyNotice} from '../components/EmptyState'; export function ProbePage({empty}) {return <><PageHeader/>{empty ? <EmptyNotice/> : <ScrollRegion/>}</>;}`;
    expect(pageCompositionIssues([...sources, { file: view, text }], [exception])).toEqual([]);
    expect(
      pageCompositionIssues(
        [...sources, { file: view, text: text.replace('<EmptyNotice/>', '<p>自造空态</p>') }],
        [exception],
      ),
    ).not.toEqual([]);
  });

  it('合法的 null 分支不要求生成页面，纯函数不冒充页面入口', () => {
    const text = `${imports} export function ProbePage({hidden}) { if (hidden) return null; return <><PageHeader/><ScrollRegion/></>; } export const optionsFor = () => ['a'];`;
    expect(pageCompositionIssues([...bases, { file: view, text }], [])).toEqual([]);
  });

  it('单独导出具名页面仍追踪其返回值，不允许不透明的导出绕过', () => {
    expect(
      pageCompositionIssues(
        [
          ...bases,
          {
            file: view,
            text: `${imports} function ProbePage() { return <><PageHeader/><ScrollRegion/></>; } export { ProbePage };`,
          },
        ],
        [],
      ),
    ).toEqual([]);
    expect(
      pageCompositionIssues(
        [
          ...bases,
          { file: view, text: 'const ProbePage = () => <div/>; export default ProbePage;' },
        ],
        [],
      ),
    ).not.toEqual([]);
    expect(
      pageCompositionIssues([...bases, { file: view, text: 'export default () => <div/>;' }], []),
    ).not.toEqual([]);
  });
});

describe('新名字与内联几何的绕过回归', () => {
  it('无末尾分号仍解析表面与限宽，字符串/函数内标点不切断声明', () => {
    const declarations = parseCssDeclarations(
      '.tile { background: var(--surface); border-radius: 8px; padding: 16px } .page { max-width: 720px } .label::after { content: "x;{y}"; background-image: url("data:image/svg+xml;a{}") }',
    );
    expect(surfaceShellSelectors(declarations)).toEqual(['.tile']);
    expect(fixedMaxWidthSelectors(declarations)).toEqual(['.page']);
    expect(declarations.find((item) => item.property === 'content')?.value).toBe('"x;{y}"');
    expect(declarations.at(-1)?.value).toBe('url("data:image/svg+xml;a{}")');
  });
  it('类名没有 card/badge 后缀仍检查外壳，分开声明也不能漏掉', () => {
    const css =
      '.tile { background: var(--surface); } .tile { border-radius: var(--radius-card); padding: 16px; } .flag { background-color: var(--brand-soft); border-radius: var(--radius-pill); padding-inline: 7px; }';
    expect(surfaceShellSelectors(parseCssDeclarations(css))).toEqual(['.flag', '.tile']);
  });

  it('新页面 max-width 也属于版心约束，媒体查询阈值不误当声明', () => {
    const css = '@media (max-width: 960px) { .probe-page { max-width: 720px; } }';
    expect(fixedMaxWidthSelectors(parseCssDeclarations(css))).toEqual(['.probe-page']);
  });

  it.each([
    '<div style={{lineHeight: 1.1, padding: 7, margin: 7, borderRadius: 5, height: 27}}/>',
    'const geometry = { padding: 7 }; <div style={geometry}/>',
    '<div style={dense ? {height: 27} : {height: 31}}/>',
    '<div style={{...geometry}}/>',
    '<div {...{style: {padding: 7}}}/>',
  ])('未登记对象、变量、条件和展开出口都失败：%s', (text) => {
    expect(inlineStyleIssues({ file: view, text }, [])).not.toEqual([]);
  });

  it('动态定位只豁免精确元素与表达式，加裸内距或另起元素仍失败', () => {
    const outlet = {
      file: view,
      tag: 'div',
      className: 'menu',
      attribute: 'style',
      expression: '{left: position.left, top: position.top}',
      reason: '测试动态定位',
    };
    expect(
      inlineStyleIssues(
        {
          file: view,
          text: '<div className="menu" style={{left: position.left, top: position.top}}/>',
        },
        [outlet],
      ),
    ).toEqual([]);
    expect(
      inlineStyleIssues(
        {
          file: view,
          text: '<div className="menu" style={{left: position.left, top: position.top, padding: 7}}/>',
        },
        [outlet],
      ),
    ).not.toEqual([]);
    expect(
      inlineStyleIssues(
        {
          file: view,
          text: '<span className="menu" style={{left: position.left, top: position.top}}/>',
        },
        [outlet],
      ),
    ).not.toEqual([]);
  });
});

describe('逐主题颜色契约', () => {
  const light =
    ":root[data-theme='light'][data-scheme='jade'], :root:not([data-theme]) { --brand: green; --danger-hover: red; }";
  const dark =
    ":root[data-theme='dark'][data-scheme='jade'] { --brand: green; --danger-hover: red; }";
  const check = (css: string): string[] =>
    themeTokenIssues(parseCssDeclarations(css), ['jade'], ['--brand', '--danger-hover']);

  it('兼容浅色的首帧选择器，不要求全局几何重复进入变体', () => {
    expect(check(`${light}${dark}:root { --control-height: 32px; }`)).toEqual([]);
  });

  it('删一套、所有套同时漏项、重复项和孤立新变体都会失败', () => {
    expect(check(light + dark.replace('--danger-hover: red;', ''))).not.toEqual([]);
    expect(check((light + dark).replaceAll('--danger-hover: red;', ''))).not.toEqual([]);
    expect(
      check(light + dark.replace('--brand: green;', '--brand: green; --brand: blue;')),
    ).not.toEqual([]);
    expect(
      check(light + dark + ":root[data-theme='dark'][data-scheme='other'] { --brand: green; }"),
    ).not.toEqual([]);
  });
});

describe('Renderer 交互语义的 ESLint 门禁', () => {
  const eslint = new ESLint();
  const filename = path.resolve(`${root}views/ArtifactView.tsx`);
  const restricted = async (jsx: string): Promise<string[]> => {
    const results = await eslint.lintText(
      `export function Probe(): React.JSX.Element { return ${jsx}; }`,
      { filePath: filename },
    );
    return results.flatMap((result) =>
      result.messages
        .filter((message) => message.ruleId === 'no-restricted-syntax')
        .map((message) => message.message),
    );
  };

  it('role/button + tabIndex + click 不能冒充原生按钮', async () => {
    expect(
      await restricted(
        '<div role="button" tabIndex={0} onClick={() => console.warn("click")}>打开</div>',
      ),
    ).not.toEqual([]);
  });

  it('新页面不能借 menuitem 声称自己已有父级键盘委托', async () => {
    expect(
      await restricted(
        '<div role="menuitem" tabIndex={0} onClick={() => console.warn("click")}>打开</div>',
      ),
    ).not.toEqual([]);
  });

  it('共享按钮的调用不被误报', async () => {
    expect(
      await restricted('<Button size="md" onClick={() => console.warn("click")}>打开</Button>'),
    ).toEqual([]);
  });

  it('字段说明必须独立于可访问名称，显式关联与选择组可用', async () => {
    expect(
      await restricted('<Field label="颜色" hint="说明"><SingleSelectPicker/></Field>'),
    ).not.toEqual([]);
    expect(await restricted('<Field group={false} label="颜色" hint="说明"/>')).not.toEqual([]);
    expect(await restricted('<Field group label="颜色" hint="说明"/>')).toEqual([]);
    expect(await restricted('<Field group={true} label="颜色" hint="说明"/>')).toEqual([]);
    expect(await restricted('<Field controlId="name" label="名称" hint="说明"/>')).toEqual([]);
  });
});

describe('真实组件台账', () => {
  const source = {
    file: `${root}components/Button.tsx`,
    text: 'export function Button() { return <button/>; }',
  };
  const catalog =
    '#### 10.1.2 当前组件台账\n| `Button` | `components/Button.tsx` | 动作 |\n#### 10.1.3 组合约束';
  it('实际导出与台账匹配，类型与纯函数不冒充组件', () => {
    expect(
      componentCatalogIssues(catalog, [
        source,
        {
          file: `${root}components/helpers.tsx`,
          text: 'export interface EntryFacts {} export const intoStack = () => null;',
        },
      ]),
    ).toEqual([]);
  });
  it.each([
    catalog.replace('`Button`', '`OldButton`'),
    catalog.replace('components/Button.tsx', 'components/OldButton.tsx'),
    catalog.replace('| `Button`', '| `Button`、`Button`'),
    catalog.replace('| `Button` | `components/Button.tsx` | 动作 |', ''),
    '没有台账',
  ])('过期名称、路径、重复/缺登记与空跑失败：%s', (markdown) => {
    expect(componentCatalogIssues(markdown, [source])).not.toEqual([]);
  });
  it('新增或更名的组件必须回写台账', () => {
    expect(
      componentCatalogIssues(catalog, [
        source,
        {
          file: `${root}components/NewControl.tsx`,
          text: 'export const NewControl = () => <div/>;',
        },
      ]),
    ).not.toEqual([]);
  });
});
