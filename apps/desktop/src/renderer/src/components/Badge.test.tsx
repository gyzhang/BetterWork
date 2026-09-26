// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Badge } from './Badge';

afterEach(() => {
  cleanup();
});

describe('Badge 基座', () => {
  it('语义只通过 data 属性表达，外观全在 .badge 一处', () => {
    const { container } = render(
      <Badge tone="warning" shape="tag">
        需复核
      </Badge>,
    );

    const badge = container.querySelector('.badge') as HTMLElement;
    expect(badge.dataset['tone']).toBe('warning');
    expect(badge.dataset['shape']).toBe('tag');
    expect(badge.textContent).toBe('需复核');
  });

  it('默认是中性胶囊，不带多余类名', () => {
    const { container } = render(<Badge>已就绪</Badge>);

    const badge = container.querySelector('.badge') as HTMLElement;
    expect(badge.getAttribute('class')).toBe('badge');
    expect(badge.dataset['tone']).toBe('neutral');
    expect(badge.dataset['shape']).toBe('pill');
  });
});
