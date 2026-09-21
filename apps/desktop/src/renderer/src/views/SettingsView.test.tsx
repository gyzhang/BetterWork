// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModelEditor } from '../components/ModelEditorSheet';
import { TransientToast } from '../components/TransientToast';
import { useModelSettings } from '../hooks/use-model-settings';
import { trackAction } from '../lib/async-action';
import { SearchSettings } from './SettingsView';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'betterwork');
});

/** 复刻 App 对模型设置的装配：编辑器内联错误 + 页面级瞬时 toast。 */
function ModelHarness(): React.JSX.Element {
  const settings = useModelSettings();
  return (
    <>
      <button onClick={() => settings.openEditor()}>打开编辑器</button>
      {settings.editorOpen && (
        <ModelEditor
          form={settings.editorForm}
          setForm={settings.setEditorForm}
          editing={settings.editorIsEditing}
          error={settings.error}
          onClose={settings.closeEditor}
          onSave={settings.onSave}
          onTest={() => trackAction(settings.onTest(), '测试模型连接')}
        />
      )}
      {settings.toast && <TransientToast {...settings.toast} onDismiss={settings.dismissToast} />}
    </>
  );
}

describe('模型设置反馈路由（docs/10 §11.5.1）', () => {
  it('连接成功走右下角瞬时 toast，不留常驻内联横幅', async () => {
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        models: {
          list: vi.fn(async () => []),
          test: vi.fn(async () => ({ ok: true, message: '模型连接成功' })),
        },
      },
    });

    render(<ModelHarness />);
    screen.getByRole('button', { name: '打开编辑器' }).click();
    (await screen.findByRole('button', { name: '测试连接' })).click();

    const toast = await screen.findByRole('status');
    expect(within(toast).getByText('模型连接成功')).toBeTruthy();
    expect(document.querySelector('.inline-message:not(.error)')).toBeNull();
  });

  it('连接失败走表单内联错误，不弹 toast', async () => {
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        models: {
          list: vi.fn(async () => []),
          test: vi.fn(async () => {
            throw new Error('连接被拒绝');
          }),
        },
      },
    });

    render(<ModelHarness />);
    screen.getByRole('button', { name: '打开编辑器' }).click();
    (await screen.findByRole('button', { name: '测试连接' })).click();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('连接被拒绝');
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.querySelector('.inline-message:not(.error)')).toBeNull();
  });
});

describe('搜索设置反馈路由（docs/10 §11.5.1）', () => {
  it('连接成功走瞬时 toast，不留常驻内联横幅', async () => {
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        searchEngines: {
          list: vi.fn(async () => []),
          test: vi.fn(async () => ({ ok: true, message: '搜索服务连接成功' })),
        },
      },
    });

    render(<SearchSettings />);
    screen.getByRole('button', { name: '测试连接' }).click();

    const toast = await screen.findByRole('status');
    expect(within(toast).getByText('搜索服务连接成功')).toBeTruthy();
    expect(document.querySelector('.inline-message:not(.error)')).toBeNull();
  });
});
