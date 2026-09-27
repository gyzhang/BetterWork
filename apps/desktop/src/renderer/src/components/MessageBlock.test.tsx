// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MessageBlock } from './MessageBlock';

afterEach(() => {
  cleanup();
});

describe('MessageBlock 基座', () => {
  it('发言者标签只有一处口径：你／算台', () => {
    const user = render(<MessageBlock author="user" content="算一下这三条产品线的差值" />);
    expect(user.container.querySelector('.message.user > span')?.textContent).toBe('你');
    user.unmount();

    const assistant = render(<MessageBlock author="assistant" content="三条产品线的差值如下。" />);
    expect(assistant.container.querySelector('.message.assistant > span')?.textContent).toBe(
      '算台',
    );
  });

  it('用户的原始提问按预格式呈现，算台的回复按 Markdown 渲染', () => {
    const user = render(<MessageBlock author="user" content={'第一行\n第二行'} />);
    expect(user.container.querySelector('.message.user p')?.textContent).toBe('第一行\n第二行');
    user.unmount();

    const assistant = render(
      <MessageBlock author="assistant" content={'## 结论\n\n- 集中到三条产品线'} />,
    );
    // Markdown 渲染出的标题而不是原样文本，才说明正文真的过了渲染器。
    expect(assistant.container.querySelector('.message.assistant h2')?.textContent).toBe('结论');
    expect(assistant.container.querySelector('.message.assistant li')?.textContent).toBe(
      '集中到三条产品线',
    );
  });

  it('动作住在气泡下方同一块里；没有动作时那一行根本不存在', () => {
    const empty = render(<MessageBlock author="assistant" content="回复正文" />);
    expect(empty.container.querySelector('.message-actions')).toBeNull();
    empty.unmount();

    const { container } = render(
      <MessageBlock
        author="assistant"
        content="回复正文"
        actions={<button type="button">记住这段经验</button>}
      />,
    );
    const actions = container.querySelector('.message-actions');
    expect(actions?.textContent).toBe('记住这段经验');
    // 关键断言：动作是这条消息的后代，不是它的兄弟——气泡与动作之间的缝因此归消息块自己管。
    expect(actions?.parentElement?.className).toBe('message assistant');
  });
});
