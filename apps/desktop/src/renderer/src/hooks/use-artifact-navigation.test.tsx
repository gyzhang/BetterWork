// @vitest-environment jsdom

import type { ArtifactDetail, ArtifactVersionDetail } from '@betterwork/agent-protocol';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useArtifactNavigation } from './use-artifact-navigation';

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

const artifact = (id: string, title = `成果 ${id}`): ArtifactDetail => ({
  id,
  workspaceId: 'workspace-1',
  taskId: 'task-1',
  type: 'markdown',
  title,
  currentVersionId: `version-${id}`,
  versionNumber: 1,
  origin: 'assistant-run',
  sourceRunId: 'run-1',
  createdAt: 1,
  updatedAt: 1,
  content: `内容 ${title}`,
  contentHash: `hash-${id}`,
  evidence: [],
});

const version = (id: string, artifactId: string): ArtifactVersionDetail => ({
  id,
  artifactId,
  versionNumber: 2,
  origin: 'assistant-run',
  sourceRunId: 'run-1',
  createdAt: 2,
  type: 'markdown',
  content: `内容 ${id}`,
  contentHash: `hash-${id}`,
  evidence: [],
});

const installArtifactApi = (options: {
  get: (input: { id: string }) => Promise<ArtifactDetail | null>;
  getVersion?: (input: { id: string }) => Promise<ArtifactVersionDetail | null>;
}): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      artifacts: {
        get: options.get,
        getVersion: options.getVersion ?? vi.fn(async () => null),
      },
    },
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
});

describe('useArtifactNavigation', () => {
  it('keeps B selected when A→B requests resolve in reverse order', async () => {
    const first = deferred<ArtifactDetail | null>();
    const second = deferred<ArtifactDetail | null>();
    installArtifactApi({
      get: ({ id }) => (id === 'artifact-a' ? first.promise : second.promise),
    });
    const { result } = renderHook(() => useArtifactNavigation());

    const openA = result.current.openArtifact('artifact-a');
    const openB = result.current.openArtifact('artifact-b');
    await act(async () => {
      second.resolve(artifact('artifact-b'));
      await second.promise;
      await openB;
    });
    await act(async () => {
      first.resolve(artifact('artifact-a'));
      await first.promise;
      await openA;
    });

    expect(result.current.selectedArtifact?.id).toBe('artifact-b');
    expect(result.current.initialVersion).toBeUndefined();
  });

  it('uses request identity for A→B→A even when the first and last target match', async () => {
    const firstA = deferred<ArtifactDetail | null>();
    const middleB = deferred<ArtifactDetail | null>();
    const lastA = deferred<ArtifactDetail | null>();
    const requests = [firstA, middleB, lastA];
    let requestIndex = 0;
    installArtifactApi({ get: () => requests[requestIndex++]?.promise ?? Promise.resolve(null) });
    const { result } = renderHook(() => useArtifactNavigation());

    const firstRequest = result.current.openArtifact('artifact-a');
    const middleRequest = result.current.openArtifact('artifact-b');
    const lastRequest = result.current.openArtifact('artifact-a');
    await act(async () => {
      lastA.resolve(artifact('artifact-a', 'A 最新请求'));
      await lastA.promise;
      await lastRequest;
    });
    await act(async () => {
      firstA.resolve(artifact('artifact-a', 'A 旧请求'));
      middleB.resolve(artifact('artifact-b'));
      await Promise.all([firstA.promise, middleB.promise, firstRequest, middleRequest]);
    });

    expect(result.current.selectedArtifact?.title).toBe('A 最新请求');
  });

  it('ignores an earlier repeat-open response for the same Artifact', async () => {
    const first = deferred<ArtifactDetail | null>();
    const second = deferred<ArtifactDetail | null>();
    const get = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    installArtifactApi({ get });
    const { result } = renderHook(() => useArtifactNavigation());

    const earlier = result.current.openArtifact('artifact-a');
    const later = result.current.openArtifact('artifact-a');
    await act(async () => {
      second.resolve(artifact('artifact-a', '重复打开的后一次'));
      await second.promise;
      await later;
    });
    await act(async () => {
      first.resolve(artifact('artifact-a', '重复打开的前一次'));
      await first.promise;
      await earlier;
    });

    expect(result.current.selectedArtifact?.title).toBe('重复打开的后一次');
  });

  it('suppresses stale failures but leaves the current failure available to its outlet', async () => {
    const stale = deferred<ArtifactDetail | null>();
    installArtifactApi({
      get: ({ id }) =>
        id === 'artifact-stale' ? stale.promise : Promise.reject(new Error('当前读取失败')),
    });
    const { result } = renderHook(() => useArtifactNavigation());

    const staleRequest = result.current.openArtifact('artifact-stale');
    const currentRequest = result.current.openArtifact('artifact-current');
    await expect(currentRequest).rejects.toThrow('当前读取失败');
    await act(async () => stale.reject(new Error('旧读取失败')));
    await expect(staleRequest).resolves.toBe(false);
  });

  it('invalidates pending navigation when selection is cleared', async () => {
    const pending = deferred<ArtifactDetail | null>();
    installArtifactApi({ get: () => pending.promise });
    const { result } = renderHook(() => useArtifactNavigation());

    const request = result.current.openArtifact('artifact-a');
    act(() => result.current.clear());
    await act(async () => {
      pending.resolve(artifact('artifact-a'));
      await pending.promise;
      await request;
    });

    expect(result.current.selectedArtifact).toBeUndefined();
    expect(result.current.initialVersion).toBeUndefined();
  });

  it('opens an exact version and ignores an obsolete version lookup failure', async () => {
    const oldVersion = deferred<ArtifactVersionDetail | null>();
    const exactVersion = version('version-exact', 'artifact-exact');
    installArtifactApi({
      get: ({ id }) => Promise.resolve(artifact(id)),
      getVersion: ({ id }) =>
        id === 'version-old' ? oldVersion.promise : Promise.resolve(exactVersion),
    });
    const { result } = renderHook(() => useArtifactNavigation());

    const oldRequest = result.current.openVersion('version-old');
    const currentRequest = result.current.openVersion(exactVersion.id);
    await act(async () => {
      await currentRequest;
    });
    expect(result.current.selectedArtifact?.id).toBe(exactVersion.artifactId);
    expect(result.current.initialVersion).toEqual(exactVersion);

    await act(async () => oldVersion.reject(new Error('旧版本不存在')));
    await expect(oldRequest).resolves.toBe(false);
    expect(result.current.initialVersion).toEqual(exactVersion);
  });
});
