// @vitest-environment jsdom

import type { ModelProfileInput } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModelEditor } from './ModelEditorSheet';

const formOf = (overrides: Partial<ModelProfileInput> = {}): ModelProfileInput => ({
  name: '测试模型',
  provider: 'openai-compatible',
  model: 'gpt-4',
  baseUrl: 'https://api.example.com/v1',
  apiKey: '',
  roles: ['language'],
  maxContextTokens: 32768,
  maxOutputTokens: 4096,
  temperature: 0.3,
  enabled: true,
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe('ModelEditor', () => {
  it('新增模式显示「添加模型」标题', () => {
    render(
      <ModelEditor
        form={formOf()}
        setForm={vi.fn()}
        editing={false}
        error=""
        onClose={vi.fn()}
        onSave={async () => undefined}
        onTest={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: '添加模型' })).toBeTruthy();
  });

  it('编辑模式显示「编辑模型」标题', () => {
    render(
      <ModelEditor
        form={formOf()}
        setForm={vi.fn()}
        editing={true}
        error=""
        onClose={vi.fn()}
        onSave={async () => undefined}
        onTest={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: '编辑模型' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存修改' })).toBeTruthy();
  });

  it('显示表单字段', () => {
    render(
      <ModelEditor
        form={formOf({ name: '公司主力模型' })}
        setForm={vi.fn()}
        editing={false}
        error=""
        onClose={vi.fn()}
        onSave={async () => undefined}
        onTest={vi.fn()}
      />,
    );

    expect(screen.getByText('显示名称')).toBeTruthy();
    expect(screen.getByText('模型角色')).toBeTruthy();
    expect(screen.getByText('Provider')).toBeTruthy();
    expect(screen.getByText('模型名称')).toBeTruthy();
    expect(screen.getByText('API 地址')).toBeTruthy();
    expect(screen.getByText('API Key')).toBeTruthy();
    expect(screen.getByDisplayValue('公司主力模型')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: '语言模型' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: '视觉模型' })).toBeTruthy();
  });

  it('支持同一配置选择多个角色，并保留至少一个角色', () => {
    const setForm = vi.fn();
    render(
      <ModelEditor
        form={formOf()}
        setForm={setForm}
        editing={false}
        error=""
        onClose={vi.fn()}
        onSave={async () => undefined}
        onTest={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: '视觉模型' }));
    expect(setForm).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ['language', 'vision'] }),
    );
    expect(screen.getByRole('checkbox', { name: '语言模型' }).hasAttribute('disabled')).toBe(true);
  });

  it('修改名称调用 setForm', () => {
    const setForm = vi.fn();
    render(
      <ModelEditor
        form={formOf({ name: '' })}
        setForm={setForm}
        editing={false}
        error=""
        onClose={vi.fn()}
        onSave={async () => undefined}
        onTest={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText('例如：公司主力模型');
    fireEvent.change(input, { target: { value: '新模型' } });
    expect(setForm).toHaveBeenCalled();
  });

  it('显示错误信息', () => {
    render(
      <ModelEditor
        form={formOf()}
        setForm={vi.fn()}
        editing={false}
        error="API 地址无效"
        onClose={vi.fn()}
        onSave={async () => undefined}
        onTest={vi.fn()}
      />,
    );

    expect(screen.getByText('API 地址无效')).toBeTruthy();
  });

  it('点击测试连接调用 onTest', () => {
    const onTest = vi.fn();
    render(
      <ModelEditor
        form={formOf()}
        setForm={vi.fn()}
        editing={false}
        error=""
        onClose={vi.fn()}
        onSave={async () => undefined}
        onTest={onTest}
      />,
    );

    fireEvent.click(screen.getByText('测试连接'));
    expect(onTest).toHaveBeenCalled();
  });

  it('点击关闭调用 onClose', () => {
    const onClose = vi.fn();
    render(
      <ModelEditor
        form={formOf()}
        setForm={vi.fn()}
        editing={false}
        error=""
        onClose={onClose}
        onSave={async () => undefined}
        onTest={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onClose).toHaveBeenCalled();
  });

  it('新增模式显示「添加模型」按钮', () => {
    render(
      <ModelEditor
        form={formOf()}
        setForm={vi.fn()}
        editing={false}
        error=""
        onClose={vi.fn()}
        onSave={async () => undefined}
        onTest={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '添加模型' })).toBeTruthy();
  });

  it('编辑模式显示「保存修改」按钮', () => {
    render(
      <ModelEditor
        form={formOf()}
        setForm={vi.fn()}
        editing={true}
        error=""
        onClose={vi.fn()}
        onSave={async () => undefined}
        onTest={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '保存修改' })).toBeTruthy();
  });
});
