// @vitest-environment jsdom

import type { ArtifactThumbnail } from '@betterwork/agent-protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useArtifactThumbnails } from './use-artifact-thumbnails';

const thumbnailOf = (index: number): ArtifactThumbnail => ({
  slideIndex: index,
  dataUrl: `data:image/png;base64,thumbnail-${index}`,
});

const getThumbnails = vi.fn<
  (input: { artifactId: string; versionId: string }) => Promise<{
    thumbnails: ArtifactThumbnail[];
    error?: string;
  }>
>();

const install = (): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      artifacts: { getThumbnails },
    },
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
  getThumbnails.mockReset();
  vi.restoreAllMocks();
});

describe('useArtifactThumbnails', () => {
  it('artifactId 或 versionId 缺失时不发请求', async () => {
    install();

    renderHook(() => useArtifactThumbnails({ artifactId: undefined, versionId: 'v-1' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(getThumbnails).not.toHaveBeenCalled();
  });

  it('两个 id 都提供时拉取缩略图', async () => {
    getThumbnails.mockResolvedValue({
      thumbnails: [thumbnailOf(0), thumbnailOf(1)],
    });
    install();

    const { result } = renderHook(() =>
      useArtifactThumbnails({ artifactId: 'art-1', versionId: 'v-1' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.items).toHaveLength(2);
    expect(result.current.error).toBeUndefined();
  });

  it('后端返回 error 时透传给界面', async () => {
    getThumbnails.mockResolvedValue({
      thumbnails: [],
      error: 'LibreOffice 未安装',
    });
    install();

    const { result } = renderHook(() =>
      useArtifactThumbnails({ artifactId: 'art-1', versionId: 'v-1' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('LibreOffice 未安装');
  });

  it('IPC 传输失败时 error 由 reportAction 的回调写入', async () => {
    getThumbnails.mockRejectedValue(new Error('channel rejected'));
    install();

    const { result } = renderHook(() =>
      useArtifactThumbnails({ artifactId: 'art-1', versionId: 'v-1' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('channel rejected');
  });

  it('切换版本时旧响应不覆盖新选择', async () => {
    let resolveFirst: ((value: { thumbnails: ArtifactThumbnail[] }) => void) | undefined;
    const firstPromise = new Promise<{ thumbnails: ArtifactThumbnail[] }>((resolve) => {
      resolveFirst = resolve;
    });
    getThumbnails.mockImplementationOnce(() => firstPromise);
    getThumbnails.mockResolvedValueOnce({ thumbnails: [thumbnailOf(99)] });
    install();

    const { result, rerender } = renderHook(
      ({ versionId }: { versionId: string }) =>
        useArtifactThumbnails({ artifactId: 'art-1', versionId }),
      { initialProps: { versionId: 'v-1' } },
    );

    rerender({ versionId: 'v-2' });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]?.slideIndex).toBe(99);

    act(() => {
      resolveFirst?.({ thumbnails: [thumbnailOf(0)] });
    });
    expect(result.current.items[0]?.slideIndex, '迟到响应不覆盖新版本').toBe(99);
  });
});
