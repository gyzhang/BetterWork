// @vitest-environment jsdom

import type { SearchEngineSummary } from '@betterwork/agent-protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSearchEngineSettings } from './use-search-engine-settings';

const engineOf = (overrides: Partial<SearchEngineSummary> = {}): SearchEngineSummary => ({
  provider: 'baidu_qianfan',
  apiKeyConfigured: true,
  enabled: true,
  webTopK: 10,
  connectionStatus: 'connected',
  updatedAt: 1,
  ...overrides,
});

const listEngines = vi.fn<() => Promise<SearchEngineSummary[]>>();
const saveEngine = vi.fn<(input: never) => Promise<void>>();
const testEngine = vi.fn<(input: never) => Promise<{ ok: boolean; message: string }>>();

const install = (): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      searchEngines: { list: listEngines, save: saveEngine, test: testEngine },
    },
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
  listEngines.mockReset();
  saveEngine.mockReset();
  testEngine.mockReset();
  vi.restoreAllMocks();
});

describe('useSearchEngineSettings', () => {
  it('挂载时拉取搜索引擎列表', async () => {
    listEngines.mockResolvedValue([engineOf()]);
    install();

    const { result } = renderHook(() => useSearchEngineSettings());

    await waitFor(() => expect(result.current.configured?.provider).toBe('baidu_qianfan'));
  });

  it('save 成功后清空 apiKey 并播报成功', async () => {
    listEngines.mockResolvedValue([engineOf()]);
    saveEngine.mockResolvedValue(undefined);
    install();

    const { result } = renderHook(() => useSearchEngineSettings());
    await waitFor(() => expect(listEngines).toHaveBeenCalled());

    act(() => result.current.setApiKey('my-secret-key'));
    expect(result.current.apiKey).toBe('my-secret-key');

    await act(async () => {
      await result.current.save();
    });

    expect(result.current.apiKey, '保存后 apiKey 清空，不留密钥在界面').toBe('');
    expect(result.current.toast?.tone).toBe('success');
    expect(result.current.error).toBe('');
  });

  it('save 失败时错误留在 error，不清空 apiKey', async () => {
    listEngines.mockResolvedValue([]);
    saveEngine.mockRejectedValue(new Error('apiKey 无效'));
    install();

    const { result } = renderHook(() => useSearchEngineSettings());
    await waitFor(() => expect(listEngines).toHaveBeenCalled());

    act(() => result.current.setApiKey('bad-key'));

    await act(async () => {
      await result.current.save();
    });

    expect(result.current.error).toBe('apiKey 无效');
    expect(result.current.apiKey).toBe('bad-key');
    expect(result.current.toast).toBeUndefined();
  });

  it('test 成功时播报测试消息', async () => {
    listEngines.mockResolvedValue([]);
    testEngine.mockResolvedValue({ ok: true, message: '连接正常' });
    install();

    const { result } = renderHook(() => useSearchEngineSettings());
    await waitFor(() => expect(listEngines).toHaveBeenCalled());

    await act(async () => {
      await result.current.test();
    });

    expect(result.current.busy).toBe(false);
    expect(result.current.toast?.message).toBe('连接正常');
  });

  it('test 失败时写入 error 并解除 busy', async () => {
    listEngines.mockResolvedValue([]);
    testEngine.mockRejectedValue(new Error('401 未授权'));
    install();

    const { result } = renderHook(() => useSearchEngineSettings());
    await waitFor(() => expect(listEngines).toHaveBeenCalled());

    await act(async () => {
      await result.current.test();
    });

    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBe('401 未授权');
  });

  it('presents a resolved connection failure inline, preserving the key and clearing success', async () => {
    listEngines.mockResolvedValue([]);
    testEngine
      .mockResolvedValueOnce({ ok: true, message: 'Connected' })
      .mockResolvedValueOnce({ ok: false, message: 'HTTP 401' });
    install();
    const { result } = renderHook(() => useSearchEngineSettings());
    await waitFor(() => expect(listEngines).toHaveBeenCalledTimes(1));
    act(() => result.current.setApiKey('audit-input'));
    await act(async () => {
      await result.current.test();
    });
    expect(result.current.toast?.tone).toBe('success');
    await act(async () => {
      await result.current.test();
    });
    expect(result.current.error).toBe('HTTP 401');
    expect(result.current.toast).toBeUndefined();
    expect(result.current.apiKey).toBe('audit-input');
    expect(result.current.busy).toBe(false);
    expect(listEngines).toHaveBeenCalledTimes(3);
  });

  it('webTopK 受范围限制', () => {
    listEngines.mockResolvedValue([]);
    install();

    const { result } = renderHook(() => useSearchEngineSettings());

    act(() => result.current.setWebTopK(0));
    expect(result.current.webTopK).toBe(1);

    act(() => result.current.setWebTopK(100));
    expect(result.current.webTopK).toBe(20);
  });

  it('dismissToast 清除浮层', async () => {
    listEngines.mockResolvedValue([]);
    saveEngine.mockResolvedValue(undefined);
    install();

    const { result } = renderHook(() => useSearchEngineSettings());
    await waitFor(() => expect(listEngines).toHaveBeenCalled());

    await act(async () => {
      await result.current.save();
    });
    expect(result.current.toast).toBeDefined();

    act(() => result.current.dismissToast());
    expect(result.current.toast).toBeUndefined();
  });
});
