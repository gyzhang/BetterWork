import { MEMORY_SOURCE_EXCERPT_MAX_CODE_POINTS } from '@betterwork/agent-protocol';
import { useRef, useState } from 'react';

import {
  excerptFailureMessage,
  excerptOf,
  type ExcerptRange,
  excerptRangeFromTextarea,
} from '../lib/memory-capture';

/**
 * 回答捕获的原文选择区（改进 Spec §4.1）：来源摘录只能来自这条回答的原始正文，
 * 页面渲染选区定位不确定时在这里重选；未确认选区前父表单不得提交。
 */
export interface MemoryCaptureSourceProps {
  /** 该运行的最终回答原文（不是渲染后的 Markdown）。 */
  raw: string;
  /** 已确认的码点区间；undefined 表示尚未确认。 */
  range: ExcerptRange | undefined;
  onRangeChange: (range: ExcerptRange | undefined) => void;
}

export function MemoryCaptureSource({
  raw,
  range,
  onRangeChange,
}: MemoryCaptureSourceProps): React.JSX.Element {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState('');
  const excerpt = range === undefined ? undefined : excerptOf(raw, range);
  const confirmedPoints = range === undefined ? 0 : range.end - range.start;

  const confirm = (): void => {
    const field = fieldRef.current;
    if (!field) return;
    const result = excerptRangeFromTextarea(raw, field.selectionStart, field.selectionEnd);
    if ('failure' in result) {
      setError(excerptFailureMessage(result.failure));
      onRangeChange(undefined);
      return;
    }
    setError('');
    onRangeChange(result);
  };

  return (
    <div className="memory-capture-source">
      <label className="memory-capture-source-field">
        <span>回答原文（只读，可拖选或用键盘选择）</span>
        <textarea
          ref={fieldRef}
          rows={5}
          readOnly
          value={raw}
          aria-label="回答原文"
          onFocus={() => setError('')}
        />
      </label>
      <div className="memory-capture-source-actions">
        <button className="message-action" type="button" onClick={confirm}>
          确认选区
        </button>
        {excerpt !== undefined && (
          <button
            className="message-action"
            type="button"
            onClick={() => {
              onRangeChange(undefined);
              setError('');
            }}
          >
            重选
          </button>
        )}
      </div>
      {error !== '' && (
        <p className="inline-message error" role="alert">
          {error}
        </p>
      )}
      {excerpt === undefined ? (
        <p className="memory-capture-source-state">
          尚未确认来源摘录；仅接受原文连续 1–{MEMORY_SOURCE_EXCERPT_MAX_CODE_POINTS} 码点。
        </p>
      ) : (
        <p className="memory-capture-source-state">
          <strong>{`已确认 ${confirmedPoints} 码点（上限 ${MEMORY_SOURCE_EXCERPT_MAX_CODE_POINTS}）`}</strong>
          ：{excerpt}
        </p>
      )}
    </div>
  );
}
