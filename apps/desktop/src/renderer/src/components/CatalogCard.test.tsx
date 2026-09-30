// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CatalogCard, CatalogRow, type EntryFacts } from './CatalogCard';

afterEach(cleanup);

function facts(overrides: Partial<EntryFacts> = {}): EntryFacts {
  return {
    mark: <b>研</b>,
    name: '研究顾问',
    byline: '财务组 · v3',
    description: '把材料交给它，它会给出结论与依据。',
    notes: <span>用途标签</span>,
    actions: <button type="button">详情</button>,
    ...overrides,
  };
}

describe('CatalogCard 卡片档', () => {
  it('把一份事实摆成「身份＋名称＋署名＋说明＋标签行＋页脚」', () => {
    const { container } = render(<CatalogCard facts={facts()} />);
    expect(container.querySelector('.card-title')?.textContent).toBe('研究顾问');
    expect(container.querySelector('.card-byline')?.textContent).toBe('财务组 · v3');
    expect(container.querySelector('.card-description')?.textContent).toBe(
      '把材料交给它，它会给出结论与依据。',
    );
    expect(container.querySelector('.card-footer')?.textContent).toContain('详情');
    expect(container.querySelector('.card')?.textContent).toContain('用途标签');
  });

  it('身份块只由配对件套一枚 CardMark，且它是装饰不是内容', () => {
    const { container } = render(<CatalogCard facts={facts()} />);
    const marks = container.querySelectorAll('.card-mark');
    expect(marks).toHaveLength(1);
    expect(marks[0]?.getAttribute('aria-hidden')).toBe('true');
    expect(marks[0]?.parentElement?.className).toBe('card-head');
    expect(container.querySelector('.card-title')?.textContent).toBe('研究顾问');
  });

  it('主动作贴在右上角并由基座挂上悬停显形的钩子；不给 onOpen 就不产出可点区', () => {
    const { container } = render(
      <CatalogCard facts={facts({ primary: <button type="button">召唤</button> })} />,
    );
    const top = container.querySelector('.card-top');
    expect(top?.lastElementChild?.className).toBe('card-primary');
    expect(top?.lastElementChild?.textContent).toBe('召唤');
    expect(top?.querySelector('.card-head')).not.toBeNull();
    expect(container.querySelector('button.card-main')).toBeNull();
  });

  it('onOpen 从外层进来，不在事实里：给了才有整片可点区', () => {
    const { container } = render(<CatalogCard facts={facts()} onOpen={() => undefined} />);
    expect(container.querySelector('button.card-main')).not.toBeNull();
  });
});

describe('CatalogRow 列表档', () => {
  it('同一份事实的署名与说明都在，不再只住在一档里', () => {
    const { container } = render(<CatalogRow facts={facts()} />);
    expect(container.querySelector('.list-row-title')?.textContent).toBe('研究顾问');
    expect(container.querySelector('.list-row-detail')?.textContent).toBe(
      '把材料交给它，它会给出结论与依据。',
    );
    expect(container.querySelector('.list-row-meta')?.textContent).toBe('财务组 · v3');
    expect(container.querySelector('.list-row-actions')?.textContent).toContain('详情');
    expect(container.querySelector('.list-row-main')?.textContent).toContain('用途标签');
  });

  it('行档不产出整行按钮：右槽站着动作，整行再可点就是按钮套按钮', () => {
    const { container } = render(<CatalogRow facts={facts()} />);
    const row = container.querySelector('.list-row');
    expect(row?.tagName).toBe('ARTICLE');
    expect(row?.getAttribute('data-variant')).toBe('card');
    expect(container.querySelector('button.list-row')).toBeNull();
  });

  it('主动作排在就地动作之前，与卡片档的「主行动更靠前更醒目」同序', () => {
    const { container } = render(
      <CatalogRow facts={facts({ primary: <button type="button">召唤</button> })} />,
    );
    const actions = container.querySelector('.list-row-actions');
    expect(actions?.firstElementChild?.textContent).toBe('召唤');
    expect(actions?.lastElementChild?.textContent).toBe('详情');
  });

  it('身份块同样只由配对件套 CardMark，与卡片档共用一块底', () => {
    const { container } = render(<CatalogRow facts={facts()} />);
    const marks = container.querySelectorAll('.card-mark');
    expect(marks).toHaveLength(1);
    expect(marks[0]?.getAttribute('aria-hidden')).toBe('true');
  });

  it('行档的说明挂在 Tooltip 锚点上：只给一行，全文仍留在 DOM 里', () => {
    const { container } = render(<CatalogRow facts={facts()} />);
    const anchor = container.querySelector('.list-row-detail .tooltip-anchor');
    expect(anchor?.className).toContain('entry-row-description');
    expect(anchor?.textContent).toBe('把材料交给它，它会给出结论与依据。');
  });
});
