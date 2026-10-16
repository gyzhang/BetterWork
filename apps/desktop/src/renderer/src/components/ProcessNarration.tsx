import { memo, type Ref } from 'react';

import type { AssistantNarration } from '../lib/work-message';
import { MarkdownPreview } from '../markdown-preview';
import { Disclosure } from './Disclosure';

interface ProcessNarrationProps {
  narrations: AssistantNarration[];
  active: boolean;
  terminal: boolean;
  anchorRef?: Ref<HTMLDivElement> | undefined;
}

interface ProcessNarrationEntryProps {
  content: string;
  messageStreaming: boolean;
  index: number;
  streaming: boolean;
}

const ProcessNarrationEntry = memo(function ProcessNarrationEntry({
  content,
  messageStreaming,
  index,
  streaming,
}: ProcessNarrationEntryProps): React.JSX.Element {
  return (
    <div
      className="process-narration-entry"
      data-streaming={streaming}
      role="listitem"
      aria-label={`过程旁白，第 ${index + 1} 条`}
    >
      <MarkdownPreview content={content} variant="message" chartsFinal={!messageStreaming} />
    </div>
  );
});

export function ProcessNarration({
  narrations,
  active,
  terminal,
  anchorRef,
}: ProcessNarrationProps): React.JSX.Element | null {
  const current = narrations.at(-1);
  if (!current) return null;

  const currentStreaming = active && !terminal && current.streaming;
  return (
    <div className="process-narration-anchor" ref={anchorRef}>
      <Disclosure
        className="process-narration"
        defaultOpen={false}
        label={
          <>
            <span className="process-narration-title">
              过程旁白 · {narrations.length} 条{currentStreaming ? ' · 正在回复' : ''}
            </span>
            <span className={`process-narration-preview${currentStreaming ? ' is-streaming' : ''}`}>
              {current.content}
            </span>
          </>
        }
      >
        <div className="process-narration-list" role="list" aria-label="过程旁白记录">
          {narrations.map((narration, index) => (
            <ProcessNarrationEntry
              key={narration.messageId}
              content={narration.content}
              messageStreaming={narration.streaming}
              index={index}
              streaming={active && !terminal && narration.streaming}
            />
          ))}
        </div>
      </Disclosure>
    </div>
  );
}
