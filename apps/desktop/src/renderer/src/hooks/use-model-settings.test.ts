// @vitest-environment jsdom

import type { ModelProfileSummary } from '@betterwork/agent-protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type FormEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useModelSettings } from './use-model-settings';

/**
 * 模型配置的 IPC 收口（docs/12 §5 的 Renderer 小节、§8 的判据）。
 *
 * 这个 hook 是全仓少数**两种收口形状并存**的地方，而且并存是有意的：
 * 编辑器里的 `onSave`／`onTest` 手写 `try/catch` 把失败交给 `error`（表单还开着，
 * 错误必须留得住，用户才改得了配置）；列表行内的 `onToggle`／`onSetDefault`／`onDelete`
 * 走 `reportAction` 把失败交给局部浮层（一行动作，读完就该走）。
 *
 * 所以这里钉的不是「调了哪个 helper」，而是三条不变量：
 * **成功只播报一次**、**失败必须到达一个真实存在的出口**、**同一次结果不得占用两个通道**
 * ——最后一条正是账本记为「静态测不到」的那条。
 */

const modelOf = (overrides: Partial<ModelProfileSummary> = {}): ModelProfileSummary => ({
  id: 'model-1',
  name: '内部大模型',
  provider: 'openai-compatible',
  baseUrl: 'https://llm.internal/v1',
  model: 'qwen-max',
  role: 'language',
  apiKeyConfigured: true,
  enabled: true,
  priority: 0,
  connectionStatus: 'untested',
  maxContextTokens: 32768,
  maxOutputTokens: 4096,
  temperature: 0.3,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const list = vi.fn<() => Promise<ModelProfileSummary[]>>();
const save = vi.fn<(input: never) => Promise<{ id: string }>>();
const testConnection = vi.fn<(input: never) => Promise<{ ok: boolean; message: string }>>();
const setEnabled =
  vi.fn<(input: { id: string; enabled: boolean }) => Promise<{ updated: boolean }>>();
const setDefault = vi.fn<(input: { id: string }) => Promise<{ updated: boolean }>>();
const remove = vi.fn<(input: { id: string }) => Promise<{ deleted: boolean }>>();

const install = (): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      models: {
        list,
        save,
        test: testConnection,
        setEnabled,
        setDefault,
        delete: remove,
      },
    },
  });
};

const submit = { preventDefault: (): void => undefined } as unknown as FormEvent<HTMLFormElement>;

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
  for (const mock of [list, save, testConnection, setEnabled, setDefault, remove]) mock.mockReset();
  vi.restoreAllMocks();
});

describe('useModelSettings 的 IPC 收口', () => {
  it('后台刷新失败只记录到控制台，不长出错误状态也不弹浮层', async () => {
    install();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    list.mockRejectedValue(new Error('channel rejected'));
    const { result } = renderHook(() => useModelSettings());

    act(() => result.current.refresh());

    await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(error.mock.calls[0]?.[0]).toBe('刷新模型配置 failed');
    expect(result.current.error, '「只记录」那一类不得同时占内联出口').toBe('');
    expect(result.current.toast).toBeUndefined();
  });

  it('编辑器里保存失败时错误留在表单上，浮层不响，编辑器不关', async () => {
    install();
    save.mockRejectedValue(new Error('baseUrl 不可达'));
    const { result } = renderHook(() => useModelSettings());
    act(() => result.current.openEditor());

    await act(async () => {
      await result.current.onSave(submit);
    });

    expect(result.current.error).toBe('baseUrl 不可达');
    expect(result.current.toast, '同一次失败不得既进内联又进浮层').toBeUndefined();
    expect(result.current.editorOpen, '错误要留得住，用户才改得了配置').toBe(true);
  });

  it('保存成功只播报一次，并关掉编辑器、重新拉一遍清单', async () => {
    install();
    save.mockResolvedValue({ id: 'model-1' });
    list.mockResolvedValue([modelOf()]);
    const { result } = renderHook(() => useModelSettings());
    act(() => result.current.openEditor());

    await act(async () => {
      await result.current.onSave(submit);
    });

    expect(result.current.toast).toEqual({
      tone: 'success',
      message: '模型已添加，现在可以用于任务。',
    });
    expect(result.current.error).toBe('');
    expect(result.current.editorOpen).toBe(false);
    expect(
      list,
      '成功后要重新拉清单，connectionStatus 由主进程真实探测后才写',
    ).toHaveBeenCalledTimes(1);
  });

  it('连接测试失败留在表单错误里，不当成一次成功播报', async () => {
    install();
    testConnection.mockRejectedValue(new Error('401 未授权'));
    const { result } = renderHook(() => useModelSettings());

    await act(async () => {
      await result.current.onTest();
    });

    expect(result.current.error).toBe('401 未授权');
    expect(result.current.toast).toBeUndefined();
  });

  it('行内切换启用失败走浮层，不写进表单错误', async () => {
    install();
    setEnabled.mockRejectedValue(new Error('写入失败'));
    const { result } = renderHook(() => useModelSettings());

    act(() => result.current.onToggle(modelOf()));
    await waitFor(() => expect(result.current.toast).toBeDefined());

    expect(result.current.toast).toEqual({ tone: 'error', message: '写入失败' });
    expect(result.current.error, '同一次失败只占一个通道').toBe('');
  });

  it('「仅已启用模型可以设为默认」是拒绝不是失败：走浮层，不进错误状态也不进控制台', async () => {
    install();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    setDefault.mockResolvedValue({ updated: false });
    list.mockResolvedValue([]);
    const { result } = renderHook(() => useModelSettings());

    act(() => result.current.onSetDefault(modelOf({ enabled: false })));
    await waitFor(() => expect(result.current.toast).toBeDefined());

    expect(result.current.toast).toEqual({
      tone: 'error',
      message: '仅已启用模型可以设为默认。',
    });
    expect(result.current.error).toBe('');
    expect(error, '业务拒绝是一次正常返回，不该在控制台里装成异常').not.toHaveBeenCalled();
  });

  it('删除失败走浮层，成功则重新拉清单', async () => {
    install();
    remove.mockRejectedValueOnce(new Error('仍被引用'));
    const { result } = renderHook(() => useModelSettings());

    act(() => result.current.onDelete(modelOf()));
    await waitFor(() => expect(result.current.toast).toBeDefined());
    expect(result.current.toast).toEqual({ tone: 'error', message: '仍被引用' });
    expect(result.current.error).toBe('');

    remove.mockResolvedValueOnce({ deleted: true });
    list.mockResolvedValue([]);
    act(() => result.current.onDelete(modelOf()));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  });
});
