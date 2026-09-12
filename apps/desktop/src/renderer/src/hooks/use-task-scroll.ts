import { type RefObject, useEffect, useRef, useState } from 'react';

interface TaskScroll {
  containerRef: RefObject<HTMLDivElement | null>;
  latestReplyRef: RefObject<HTMLDivElement | null>;
  detached: boolean;
  onScroll: () => void;
  jumpToLatest: () => void;
}

/** 只滚动消息容器；上翻阅读后不再随事件抢走阅读位置。 */
export function useTaskScroll(
  taskId: string | undefined,
  content: unknown,
  runCount: number,
): TaskScroll {
  const containerRef = useRef<HTMLDivElement>(null);
  const latestReplyRef = useRef<HTMLDivElement>(null);
  const openedTaskRef = useRef<string | undefined>(undefined);
  const followRef = useRef(true);
  const [detached, setDetached] = useState(false);
  const onScroll = (): void => {
    const container = containerRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    followRef.current = atBottom;
    setDetached(!atBottom);
  };
  const jumpToLatest = (): void => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    followRef.current = true;
    setDetached(false);
  };
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!taskId) {
      openedTaskRef.current = undefined;
      followRef.current = true;
      setDetached(false);
      container.scrollTop = 0;
      return;
    }
    if (runCount === 0) return;
    if (openedTaskRef.current !== taskId) {
      openedTaskRef.current = taskId;
      const reply = latestReplyRef.current;
      if (reply) {
        container.scrollTop +=
          reply.getBoundingClientRect().top - container.getBoundingClientRect().top - 24;
        const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
        followRef.current = atBottom;
        setDetached(!atBottom);
        return;
      }
      followRef.current = true;
    }
    if (followRef.current) container.scrollTop = container.scrollHeight;
  }, [taskId, content, runCount]);
  return { containerRef, latestReplyRef, detached, onScroll, jumpToLatest };
}
