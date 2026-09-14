import type { CreateMemoryRequest, MemoryRecord } from '@betterwork/agent-protocol';
import { useCallback, useEffect, useState } from 'react';

import { trackAction } from '../lib/async-action';

export interface MemoriesState {
  memories: MemoryRecord[];
  loading: boolean;
  error: string;
  refresh: () => void;
  create: (input: CreateMemoryRequest) => Promise<void>;
  updateContent: (memory: MemoryRecord, content: string) => Promise<void>;
  setStatus: (memory: MemoryRecord, status: MemoryRecord['status']) => Promise<void>;
}

export function useMemories(): MemoriesState {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback((): void => {
    setLoading(true);
    trackAction(
      window.betterwork.memories.list({}).then((items) => {
        setMemories(items);
        setError('');
        setLoading(false);
      }),
      '刷新记忆列表',
    );
  }, []);

  useEffect(() => refresh(), [refresh]);

  const create = useCallback(async (input: CreateMemoryRequest): Promise<void> => {
    const result = await window.betterwork.memories.create(input);
    setMemories((current) => [result.memory, ...current]);
  }, []);

  const updateContent = useCallback(
    async (memory: MemoryRecord, content: string): Promise<void> => {
      const result = await window.betterwork.memories.update({
        id: memory.id,
        expectedRevision: memory.revision,
        content,
      });
      setMemories((current) =>
        current.map((item) => (item.id === result.memory.id ? result.memory : item)),
      );
    },
    [],
  );

  const setStatus = useCallback(
    async (memory: MemoryRecord, status: MemoryRecord['status']): Promise<void> => {
      const result = await window.betterwork.memories.setStatus({
        id: memory.id,
        expectedRevision: memory.revision,
        status,
      });
      setMemories((current) =>
        current.map((item) => (item.id === result.memory.id ? result.memory : item)),
      );
    },
    [],
  );

  return {
    memories,
    loading,
    error,
    refresh,
    create: async (input) => {
      try {
        await create(input);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : '保存记忆失败，请重试。');
        throw caughtError;
      }
    },
    updateContent: async (memory, content) => {
      try {
        await updateContent(memory, content);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : '修改记忆失败，请重试。');
        throw caughtError;
      }
    },
    setStatus: async (memory, status) => {
      try {
        await setStatus(memory, status);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : '更新记忆状态失败，请重试。');
        throw caughtError;
      }
    },
  };
}
