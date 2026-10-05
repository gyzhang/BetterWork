import type { ReactNode, Ref } from 'react';

import { MarkdownPreview } from '../markdown-preview';

/**
 * 消息块：一条发言的标签、正文与就地动作。
 *
 * 它是 §10.2 里最后一个还以 `<div className="message user">` 形式内联在 `App.tsx`
 * 的业务组件。内联的代价不只在重复：动作那一排住在气泡**外面**，只能靠
 * `.message-actions { margin: -10px 0 18px }` 把气泡的下缘追回来——一行负 margin
 * 记录的是「这两个块本来属于同一件事」这个没写下来的事实。动作收进槽位后，
 * 缝由 `.message` 自己的 grid gap 拥有，负 margin 随之删除。
 *
 * 发言者称呼由工作页传入，默认标签保留给独立使用此基座的场景。
 */
const AUTHOR_LABEL = { user: '你', assistant: '算台' } as const;

export interface MessageBlockProps {
  /** 发言者。正文排版由它决定：用户的原始提问按预格式呈现，算台的回复按 Markdown 渲染。 */
  author: keyof typeof AUTHOR_LABEL;
  /** 当前设置的对话称呼；省略时使用基座默认标签。 */
  authorName?: string | undefined;
  content: string;
  /** 这条消息自己的就地动作（记住这段经验／保存为成果），住在气泡下方同一块里。 */
  actions?: ReactNode | undefined;
  /** 最新一条回复的滚动锚点由页面持有（`useTaskScroll` 用它定位打开任务时的视口）。 */
  anchorRef?: Ref<HTMLDivElement> | undefined;
}

export function MessageBlock({
  author,
  authorName,
  content,
  actions,
  anchorRef,
}: MessageBlockProps): React.JSX.Element {
  return (
    <div className={`message ${author}`} ref={anchorRef}>
      <span>{authorName ?? AUTHOR_LABEL[author]}</span>
      {author === 'assistant' ? (
        <MarkdownPreview content={content} variant="message" />
      ) : (
        <p>{content}</p>
      )}
      {actions ? <div className="message-actions">{actions}</div> : undefined}
    </div>
  );
}
