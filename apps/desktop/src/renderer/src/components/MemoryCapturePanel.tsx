import type { MemoryScope } from '@betterwork/agent-protocol';

import type { ExcerptRange } from '../lib/memory-capture';
import { MemoryCaptureSource } from './MemoryCaptureSource';
import { MemoryEditor, type MemoryEditorSubmission } from './MemoryEditor';

/** 一次「记住这段经验」的草稿：这条回答的哪个区间、正文改写成什么、适用到哪儿。 */
export interface MemoryCaptureDraft {
  runId: string;
  eventId: string;
  raw: string;
  initialContent: string;
  range: ExcerptRange | undefined;
}

export interface MemoryCapturePanelProps {
  capture: MemoryCaptureDraft;
  /** 可提交的适用范围，由页面按当前工作空间与专家裁剪。 */
  scopes: MemoryScope[];
  error: string;
  onRangeChange: (range: ExcerptRange | undefined) => void;
  onSubmit: (submission: MemoryEditorSubmission) => Promise<boolean>;
  onClose: () => void;
}

/**
 * 回答捕获面板：只读原文＋选区＋记忆正文。
 *
 * 「区间 → 来源选择器」这段推导原来写在消息流里，而消息流已经够挤了：
 * 它是这条回答的**呈现细节**，不是页面的编排，所以跟着面板一起搬。
 * 契约 §11.1 的口径不变——正文只能来自用户当场选中的片段。
 */
export function MemoryCapturePanel({
  capture,
  scopes,
  error,
  onRangeChange,
  onSubmit,
  onClose,
}: MemoryCapturePanelProps): React.JSX.Element {
  return (
    <div className="memory-capture">
      <p className="memory-capture-hint">
        来源摘录取自这条回答的原文；正文可以另行改写，改写不会解除来源与依赖。
      </p>
      <MemoryCaptureSource raw={capture.raw} range={capture.range} onRangeChange={onRangeChange} />
      <MemoryEditor
        scopes={scopes}
        initialContent={capture.initialContent}
        requireSource
        sourceNote="保留来源：Main 会重查这条回答与它依赖的材料、记忆"
        submitLabel="保留来源并记住"
        {...(capture.range
          ? {
              sourceSelector: {
                kind: 'run-assistant' as const,
                runId: capture.runId,
                eventId: capture.eventId,
                start: capture.range.start,
                end: capture.range.end,
              },
            }
          : {})}
        onSubmit={onSubmit}
        onCancel={onClose}
      />
      {error && (
        <p className="inline-message error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
