// @vitest-environment jsdom

import type {
  ArtifactDetail,
  ArtifactVersionDetail,
  ArtifactVersionSummary,
} from '@betterwork/agent-protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useArtifactViewer } from './use-artifact-viewer';

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (error: Error) => void;
}

const deferred = <Value,>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  const promise = new Promise<Value>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  if (!resolve || !reject) throw new Error('Deferred promise did not initialize');
  return { promise, resolve, reject };
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
  getVersion?: (input: { id: string }) => Promise<ArtifactVersionDetail | null>;
}): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      artifacts: {
        listVersions: options.listVersions,
        getVersion: options.getVersion ?? vi.fn(async () => null),
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

  it('ignores an older version-list failure after the selected Artifact changes', async () => {
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
      first.reject(new Error('旧成果版本列表失败'));
      await expect(first.promise).rejects.toThrow('旧成果版本列表失败');
    });
    expect(result.current.versions).toEqual([version('version-second', 'second')]);
    expect(result.current.error).toBe('');
  });

  it('shows version history loading, failure, and retry state', async () => {
    const first = deferred<ArtifactVersionSummary[]>();
    const loadedVersion = version('version-loaded', 'artifact-a');
    const listVersions = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce([loadedVersion]);
    installArtifactApi({ listVersions });
    const selected = artifact('artifact-a');
    const { result } = renderHook(() => useArtifactViewer(selected));

    expect(result.current.versionsLoading).toBe(true);
    await act(async () => {
      first.reject(new Error('版本历史暂不可用'));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.versionsError).toBe('版本历史暂不可用'));
    expect(result.current.versionsLoading).toBe(false);

    act(() => result.current.retryVersions());
    await waitFor(() => expect(result.current.versions).toEqual([loadedVersion]));
    expect(result.current.versionsLoading).toBe(false);
    expect(result.current.versionsError).toBe('');
    expect(listVersions).toHaveBeenCalledTimes(2);
  });

  it('invalidates save feedback and busy state when the selected Artifact changes', () => {
    installArtifactApi({ listVersions: async () => [] });
    const { result, rerender } = renderHook(({ selected }) => useArtifactViewer(selected), {
      initialProps: { selected: artifact('artifact-a') },
    });

    let requestId: number | undefined;
    act(() => {
      requestId = result.current.beginSave();
    });
    expect(requestId).toEqual(expect.any(Number));
    expect(result.current.saving).toBe(true);
    expect(result.current.beginSave()).toBeUndefined();

    rerender({ selected: artifact('artifact-b') });

    expect(result.current.saving).toBe(false);
    expect(requestId).toBeDefined();
    if (requestId === undefined) throw new Error('Save request did not initialize');
    expect(result.current.isSaveCurrent(requestId)).toBe(false);
    expect(result.current.finishSave(requestId)).toBe(false);
  });

  it('silently ignores a late failure after a newer version selection succeeds', async () => {
    const selected = artifact('stable');
    const older = deferred<ArtifactVersionDetail | null>();
    const newer = deferred<ArtifactVersionDetail | null>();
    const detail: ArtifactVersionDetail = {
      id: 'version-newer',
      artifactId: selected.id,
      versionNumber: 2,
      origin: 'assistant-run',
      sourceRunId: 'run-1',
      createdAt: 2,
      type: 'markdown',
      content: '# 新版本',
      contentHash: 'hash-newer',
      evidence: [],
    };
    installArtifactApi({
      listVersions: async () => [],
      getVersion: ({ id }) => (id === 'version-older' ? older.promise : newer.promise),
    });
    const { result } = renderHook(() => useArtifactViewer(selected));

    const olderRequest = result.current.selectVersion(version('version-older', selected.id));
    const newerRequest = result.current.selectVersion(version('version-newer', selected.id));
    await act(async () => {
      newer.resolve(detail);
      await newer.promise;
      await newerRequest;
    });
    expect(result.current.visibleVersion?.id).toBe(detail.id);

    await act(async () => older.reject(new Error('旧版本读取失败')));
    await expect(olderRequest).resolves.toBeUndefined();
    expect(result.current.visibleVersion?.id).toBe(detail.id);
    expect(result.current.error).toBe('');
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

  it('opens the exact historical version supplied by a schedule receipt', async () => {
    const selected = artifact('scheduled-output');
    const exactVersion = {
      id: 'version-scheduled-period',
      artifactId: selected.id,
      versionNumber: 2,
      origin: 'assistant-run',
      sourceRunId: 'run-scheduled-period',
      createdAt: 2,
      type: 'markdown',
      content: '# 固定的本期版本',
      contentHash: 'hash-period',
      evidence: [],
    } satisfies ArtifactVersionDetail;
    installArtifactApi({ listVersions: async () => [] });
    const { result } = renderHook(() => useArtifactViewer(selected, exactVersion));

    await waitFor(() => expect(result.current.visibleVersion?.id).toBe(exactVersion.id));
    expect(result.current.visibleVersion).toEqual(exactVersion);
    expect(result.current.visibleVersion).toMatchObject({ content: '# 固定的本期版本' });
  });
});
