import type { ArtifactThumbnail } from '@betterwork/agent-protocol';
import { useEffect, useRef, useState } from 'react';

import { reportAction } from '../lib/async-action';

export interface ArtifactThumbnails {
  items: ArtifactThumbnail[];
  loading: boolean;
  error: string | undefined;
}

/**
 * 演示文稿按版本生成幻灯片预览。
 *
 * 依赖刻意收在两个 id 上而不是对象上：请求的身份就是「哪个成果的哪个版本」，
 * 用原始值既避免了对象引用变化引发的重跑，也让依赖表达的正是业务语义。
 * 切换版本时旧响应必须丢弃，否则会把上一版本的画面贴到当前版本上。
 */
export function useArtifactThumbnails(input: {
  artifactId: string | undefined;
  versionId: string | undefined;
}): ArtifactThumbnails {
  const { artifactId, versionId } = input;
  const [items, setItems] = useState<ArtifactThumbnail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const requestRef = useRef(0);

  useEffect(() => {
    if (!artifactId || !versionId) {
      setItems([]);
      setError(undefined);
      setLoading(false);
      return;
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const isCurrent = (): boolean => requestRef.current === requestId;
    setLoading(true);
    setError(undefined);
    reportAction(
      window.betterwork.artifacts.getThumbnails({ artifactId, versionId }).then(
        (result) => {
          if (!isCurrent()) return;
          setItems(result.thumbnails);
          setError(result.error);
          setLoading(false);
        },
        (reason: unknown) => {
          if (isCurrent()) setLoading(false);
          throw reason;
        },
      ),
      (message) => {
        if (isCurrent()) setError(message);
      },
      '幻灯片预览生成失败，可通过「打开」用系统应用查看。',
    );
  }, [artifactId, versionId]);

  return { items, loading, error };
}
