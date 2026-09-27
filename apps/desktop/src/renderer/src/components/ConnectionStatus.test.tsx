// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ConnectionStatus } from './ConnectionStatus';

afterEach(() => {
  cleanup();
});

const toneOf = (status: Parameters<typeof ConnectionStatus>[0]['status']): string | null => {
  const { container } = render(<ConnectionStatus status={status} label="状态文字" />);
  const badge = container.querySelector('.badge');
  const tone = badge?.getAttribute('data-tone') ?? null;
  cleanup();
  return tone;
};

describe('ConnectionStatus', () => {
  it('输出的是 Badge，而不是按状态改字色的领域类', () => {
    const { container } = render(<ConnectionStatus status="connected" label="连接成功" />);

    const badge = container.querySelector('.badge') as HTMLElement;
    expect(badge.textContent).toBe('连接成功');
    expect(badge.getAttribute('data-shape')).toBe('tag');
    expect(container.querySelector('.connection-status')).toBeNull();
  });

  it('两种状态枚举共用一张档位表：成好＝success，失败＝danger', () => {
    expect(toneOf('connected')).toBe('success');
    expect(toneOf('ready')).toBe('success');
    expect(toneOf('failed')).toBe('danger');
  });

  it('进行中与未验证不被画成错误，各自留品牌色与描边档', () => {
    expect(toneOf('connecting')).toBe('brand');
    expect(toneOf('untested')).toBe('outline');
    expect(toneOf('unconfigured')).toBe('outline');
    expect(toneOf('disconnected')).toBe('neutral');
  });
});
