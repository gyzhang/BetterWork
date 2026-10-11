// @vitest-environment jsdom

import type { DependencyOptions } from '@betterwork/agent-protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRuntimeComponents } from './use-runtime-components';

const distributionOf = (
  id: string,
  platform: { os: 'darwin' | 'win32' | 'linux'; arch: 'arm64' | 'x64'; abi: string } = {
    os: 'darwin',
    arch: 'arm64',
    abi: 'cp312',
  },
) => ({
  id,
  version: '3.12.0',
  platform,
  license: 'PSF',
  installed: true,
});

const listOptions = vi.fn<() => Promise<DependencyOptions>>();

const install = (options: DependencyOptions): void => {
  listOptions.mockResolvedValue(options);
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: { dependencies: { listOptions } },
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
  listOptions.mockReset();
  vi.restoreAllMocks();
});

describe('useRuntimeComponents', () => {
  it('挂载时拉取并按平台过滤：只留 darwin/arm64', async () => {
    install({
      distributions: [
        distributionOf('mac-arm', { os: 'darwin', arch: 'arm64', abi: 'cp312' }),
        distributionOf('linux-x64', { os: 'linux', arch: 'x64', abi: 'cp312' }),
        distributionOf('mac-x64', { os: 'darwin', arch: 'x64', abi: 'cp312' }),
      ],
      lockIds: [],
      snapshots: [],
      environments: [],
    });

    const { result } = renderHook(() => useRuntimeComponents());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.distributions).toHaveLength(1);
    expect(result.current.distributions[0]?.id).toBe('mac-arm');
    expect(result.current.error).toBe('');
  });

  it('拉取失败时写入 error 并停止 loading', async () => {
    listOptions.mockRejectedValue(new Error('channel rejected'));
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: { dependencies: { listOptions } },
    });

    const { result } = renderHook(() => useRuntimeComponents());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('channel rejected');
    expect(result.current.distributions).toHaveLength(0);
  });

  it('refresh 重新拉取', async () => {
    install({ distributions: [], lockIds: [], snapshots: [], environments: [] });

    const { result } = renderHook(() => useRuntimeComponents());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listOptions).toHaveBeenCalledTimes(1);

    act(() => result.current.refresh());
    await waitFor(() => expect(listOptions).toHaveBeenCalledTimes(2));
  });
});
