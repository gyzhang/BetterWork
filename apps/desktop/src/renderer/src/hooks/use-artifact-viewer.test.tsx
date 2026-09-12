// @vitest-environment jsdom

import type { ArtifactDetail, ArtifactVersionSummary } from '@betterwork/agent-protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useArtifactViewer } from './use-artifact-viewer';

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

const deferred = <Value,>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((fulfill) => {
    resolve = fulfill;
  });
  if (!resolve) throw new Error('Deferred promise did not initialize');
  return { promise, resolve };
};

const artifact = (id: string): ArtifactDetail => ({
  id,
  workspaceId: 'workspace-1',
  taskId: 'task-1',
  type: 'markdown',
  title: `成果 ${id}`,
  currentVersionId: `version-${id}`,
  versionNumber: 1,
  origin: 'assistant-run',
  sourceRunId: 'run-1',
  createdAt: 1,
  updatedAt: 1,
  content: `内容 ${id}`,
  contentHash: `hash-${id}`,
  evidence: [],
});

const version = (id: string, artifactId: string): ArtifactVersionSummary => ({
  type: 'markdown',
  id,
  artifactId,
  versionNumber: 1,
  origin: 'assistant-run',
  sourceRunId: 'run-1',
  createdAt: 1,
});

const installArtifactApi = (options: {
  listVersions: (input: { artifactId: string }) => Promise<ArtifactVersionSummary[]>;
}): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      artifacts: {
        listVersions: options.listVersions,
        getVersion: vi.fn(async () => null),
      },
    },
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
});

describe('useArtifactViewer', () => {
  it('ignores an older version-list response after the selected Artifact changes', async () => {
    const first = deferred<ArtifactVersionSummary[]>();
    const second = deferred<ArtifactVersionSummary[]>();
    installArtifactApi({
      listVersions: ({ artifactId }) => (artifactId === 'first' ? first.promise : second.promise),
    });
    const { result, rerender } = renderHook(({ selected }) => useArtifactViewer(selected), {
      initialProps: { selected: artifact('first') },
    });

    rerender({ selected: artifact('second') });
    await act(async () => {
      second.resolve([version('version-second', 'second')]);
      await second.promise;
    });
    await waitFor(() =>
      expect(result.current.versions).toEqual([version('version-second', 'second')]),
    );

    await act(async () => {
      first.resolve([version('version-first', 'first')]);
      await first.promise;
    });
    expect(result.current.versions).toEqual([version('version-second', 'second')]);
  });

  it('keeps visibleVersion referentially stable while the selected Artifact is unchanged', () => {
    // 回归：`toVersionDetail` 每次调用都新建对象。未 memo 时引用每次都变，调用方把
    // visibleVersion 放进 useEffect 依赖数组就会无限重跑——表现为每次渲染都再发一次
    // 缩略图请求，在外层反复拉起转换进程。`react-hooks/exhaustive-deps` 查不出这种错误。
    const selected = artifact('stable');
    installArtifactApi({ listVersions: async () => [] });
    const { result, rerender } = renderHook(({ selected }) => useArtifactViewer(selected), {
      initialProps: { selected },
    });

    const initial = result.current.visibleVersion;
    expect(initial).toBeDefined();

    rerender({ selected });
    rerender({ selected });
    rerender({ selected });

    expect(result.current.visibleVersion).toBe(initial);
  });

  it('recomputes visibleVersion when the selected Artifact changes', () => {
    installArtifactApi({ listVersions: async () => [] });
    const { result, rerender } = renderHook(({ selected }) => useArtifactViewer(selected), {
      initialProps: { selected: artifact('first') },
    });

    const initial = result.current.visibleVersion;
    rerender({ selected: artifact('second') });

    expect(result.current.visibleVersion).not.toBe(initial);
    expect(result.current.visibleVersion?.artifactId).toBe('second');
  });
});
