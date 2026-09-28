import type { ModelProfileInput } from '@betterwork/agent-protocol';
import type { FormEvent } from 'react';

import { CloseIcon } from '../icons';
import { trackAction } from '../lib/async-action';
import { ActionBar } from './ActionBar';
import { Button } from './Button';
import { Field } from './Field';
import { FieldSelect } from './FieldSelect';
import { IconButton } from './IconButton';
import { Modal } from './Modal';

const ROLE_OPTIONS = [
  { id: 'language', label: '语言模型' },
  { id: 'vision', label: '视觉模型' },
  { id: 'embedding', label: '嵌入模型' },
] as const;

export interface ModelEditorProps {
  form: ModelProfileInput;
  setForm: (input: ModelProfileInput) => void;
  editing: boolean;
  error: string;
  onClose: () => void;
  onSave: (event: FormEvent) => Promise<void>;
  onTest: () => void;
}
export function ModelEditor({
  form,
  setForm,
  editing,
  error,
  onClose,
  onSave,
  onTest,
}: ModelEditorProps): React.JSX.Element {
  return (
    <Modal
      variant="sheet"
      className="model-sheet"
      label={editing ? '编辑模型' : '添加模型'}
      onClose={onClose}
    >
      <header>
        <div>
          <p className="eyebrow">模型配置</p>
          <h2>{editing ? '编辑模型' : '添加模型'}</h2>
        </div>
        <IconButton label="关闭" icon={CloseIcon} onClick={onClose} />
      </header>
      <form onSubmit={(event) => trackAction(onSave(event), '保存模型配置')}>
        <Field label="显示名称">
          <input
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="例如：公司主力模型"
          />
        </Field>
        <div className="form-grid">
          <Field label="模型角色">
            <FieldSelect
              value={form.role}
              onChange={(role) => setForm({ ...form, role: role as ModelProfileInput['role'] })}
              options={ROLE_OPTIONS}
            />
          </Field>
          <Field label="Provider">
            <input
              required
              value={form.provider}
              onChange={(event) => setForm({ ...form, provider: event.target.value })}
              placeholder="openai-compatible"
            />
          </Field>
        </div>
        <Field label="模型名称">
          <input
            required
            value={form.model}
            onChange={(event) => setForm({ ...form, model: event.target.value })}
            placeholder="模型服务中的 model id"
          />
        </Field>
        <Field label="API 地址">
          <input
            required
            type="url"
            value={form.baseUrl}
            onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
            placeholder="https://example.com/v1"
          />
        </Field>
        <Field label="API Key">
          <input
            type="password"
            value={form.apiKey}
            onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
            placeholder={editing ? '留空则保持原有凭据' : '可留空'}
          />
        </Field>
        <details>
          <summary>高级参数</summary>
          <div className="form-grid">
            <Field label="上下文 Token">
              <input
                type="number"
                min="1"
                value={form.maxContextTokens}
                onChange={(event) =>
                  setForm({ ...form, maxContextTokens: Number(event.target.value) })
                }
              />
            </Field>
            <Field label="最大输出 Token">
              <input
                type="number"
                min="1"
                value={form.maxOutputTokens}
                onChange={(event) =>
                  setForm({ ...form, maxOutputTokens: Number(event.target.value) })
                }
              />
            </Field>
          </div>
        </details>
        {error && (
          <p className="inline-message error" role="alert">
            {error}
          </p>
        )}
        <ActionBar label="保存模型配置">
          <Button variant="secondary" size="md" type="button" onClick={onTest}>
            测试连接
          </Button>
          <Button variant="primary" size="md" type="submit">
            {editing ? '保存修改' : '添加模型'}
          </Button>
        </ActionBar>
      </form>
    </Modal>
  );
}
