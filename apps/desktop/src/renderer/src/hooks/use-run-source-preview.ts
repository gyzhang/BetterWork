import type { RunSourcePreview } from '@betterwork/agent-protocol';
import { useCallback, useRef, useState } from 'react';

import { describeActionError } from '../lib/async-action';

export interface RunSourcePreviewState {
  /** 当前展开预览的证据 id；null 表示收起。 */
  selectedEvidenceId: string | null;
  loading: boolean;
  error: string;
  preview: RunSourcePreview | undefined;
  previewRunSource: (runId: string, evidenceId: string) => void;
  close: () => void;
}

/**
 * 按运行回看证据区间（契约 §3.1、§5）。来源是主进程 `previewRunSource`：
 * 精确来源只回看当时实际返回的 span，legacy 证据不伪造位置。
 *
 * 迟到响应按请求代号收口：换 Run、收起或再次点击后，旧请求的返回
 * 不允许覆盖当前选择——预览区展示的必须还是用户最后操作的那条证据。
 */
export function useRunSourcePreview(): RunSourcePreviewState {
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<RunSourcePreview>();
  const requestRef = useRef(0);

  const previewRunSource = useCallback((runId: string, evidenceId: string) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setSelectedEvidenceId(evidenceId);
    setPreview(undefined);
    setError('');
    setLoading(true);
    window.betterwork.knowledge
      .previewRunSource({ runId, evidenceId })
      .then((result) => {
        if (requestRef.current !== requestId) return;
        setPreview(result);
        setLoading(false);
      })
      .catch((failure: unknown) => {
        if (requestRef.current !== requestId) return;
        setError(describeActionError(failure, '无法回看该来源区间。'));
        setLoading(false);
      });
  }, []);

  const close = useCallback(() => {
    // 同号失效：在途请求返回时既不改内容也不改加载态。
    requestRef.current += 1;
    setSelectedEvidenceId(null);
    setPreview(undefined);
    setError('');
    setLoading(false);
  }, []);

  return { selectedEvidenceId, loading, error, preview, previewRunSource, close };
}
