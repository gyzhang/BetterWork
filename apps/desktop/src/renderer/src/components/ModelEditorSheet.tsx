import type { FormEvent } from 'react';
import type { ModelProfileInput } from '@betterwork/agent-protocol';
import { CloseIcon } from '../icons';
import { trackAction } from '../lib/async-action';

export interface ModelEditorProps {
  form: ModelProfileInput;
  setForm: (input: ModelProfileInput) => void;
  editing: boolean;
  message: string;
  onClose: () => void;
  onSave: (event: FormEvent) => Promise<void>;
  onTest: () => void;
}
export function ModelEditor({
  form,
  setForm,
  editing,
  message,
  onClose,
  onSave,
  onTest,
}: ModelEditorProps): React.JSX.Element {
  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <aside
        className="model-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? '编辑模型' : '添加模型'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">模型配置</p>
            <h2>{editing ? '编辑模型' : '添加模型'}</h2>
          </div>
          <button aria-label="关闭" onClick={onClose}>
            <CloseIcon size={14} />
          </button>
        </header>
        <form onSubmit={(event) => trackAction(onSave(event), '保存模型配置')}>
          <label>
            显示名称
            <input
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="例如：公司主力模型"
            />
          </label>
          <div className="form-grid">
            <label>
              模型角色
              <select
                value={form.role}
                onChange={(event) =>
                  setForm({ ...form, role: event.target.value as ModelProfileInput['role'] })
                }
              >
                <option value="language">语言模型</option>
                <option value="vision">视觉模型</option>
                <option value="embedding">嵌入模型</option>
              </select>
            </label>
            <label>
              Provider
              <input
                required
                value={form.provider}
                onChange={(event) => setForm({ ...form, provider: event.target.value })}
                placeholder="openai-compatible"
              />
            </label>
          </div>
          <label>
            模型名称
            <input
              required
              value={form.model}
              onChange={(event) => setForm({ ...form, model: event.target.value })}
              placeholder="模型服务中的 model id"
            />
          </label>
          <label>
            API 地址
            <input
              required
              type="url"
              value={form.baseUrl}
              onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
              placeholder="https://example.com/v1"
            />
          </label>
          <label>
            API Key
            <input
              type="password"
              value={form.apiKey}
              onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
              placeholder={editing ? '留空则保持原有凭据' : '可留空'}
            />
          </label>
          <details>
            <summary>高级参数</summary>
            <div className="form-grid">
              <label>
                上下文 Token
                <input
                  type="number"
                  min="1"
                  value={form.maxContextTokens}
                  onChange={(event) =>
                    setForm({ ...form, maxContextTokens: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                最大输出 Token
                <input
                  type="number"
                  min="1"
                  value={form.maxOutputTokens}
                  onChange={(event) =>
                    setForm({ ...form, maxOutputTokens: Number(event.target.value) })
                  }
                />
              </label>
            </div>
          </details>
          {message && <p className="inline-message">{message}</p>}
          <footer>
            <button type="button" className="secondary-button" onClick={onTest}>
              测试连接
            </button>
            <button type="submit" className="primary-button">
              {editing ? '保存修改' : '添加模型'}
            </button>
          </footer>
        </form>
      </aside>
    </div>
  );
}
