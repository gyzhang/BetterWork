import type { ModelProfileInput, ModelProfileSummary } from '@betterwork/agent-protocol';
import { type FormEvent, useCallback, useMemo, useState } from 'react';

import { reportAction, trackAction } from '../lib/async-action';
import { emptyModel, roleName } from '../lib/labels';

export type ModelFilter = ModelProfileSummary['role'] | 'all';

export interface ModelSettings {
  models: ModelProfileSummary[];
  filteredModels: ModelProfileSummary[];
  filter: ModelFilter;
  setFilter: (filter: ModelFilter) => void;
  defaultModelIds: Map<ModelProfileSummary['role'], string | undefined>;
  activeLanguageModel: ModelProfileSummary | undefined;
  message: string;
  /** 后台重新拉取模型清单；永不 reject。 */
  refresh: () => void;
  editorOpen: boolean;
  editorForm: ModelProfileInput;
  setEditorForm: (form: ModelProfileInput) => void;
  editorIsEditing: boolean;
  openEditor: (model?: ModelProfileSummary) => void;
  closeEditor: () => void;
  onSave: (event: FormEvent) => Promise<void>;
  onTest: () => Promise<void>;
  onToggle: (model: ModelProfileSummary) => void;
  onSetDefault: (model: ModelProfileSummary) => void;
  onDelete: (model: ModelProfileSummary) => void;
}

const ROLES = ['language', 'vision', 'embedding'] as const;

/**
 * 模型配置的界面状态与动作。
 *
 * 两条来自 docs/10 §11.4 的约束在这里落地：新建后不自动宣称连接成功
 * （connectionStatus 由主进程在真实探测后才写），API Key 始终掩码
 * （编辑表单的 apiKey 一律从空串开始，留空表示沿用已保存的凭据）。
 */
export function useModelSettings(): ModelSettings {
  const [models, setModels] = useState<ModelProfileSummary[]>([]);
  const [filter, setFilter] = useState<ModelFilter>('all');
  const [message, setMessage] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorForm, setEditorForm] = useState<ModelProfileInput>(emptyModel);
  const [editingModelId, setEditingModelId] = useState<string>();

  const refresh = useCallback((): void => {
    trackAction(window.betterwork.models.list().then(setModels), '刷新模型配置');
  }, []);

  const filteredModels = models.filter((model) => filter === 'all' || model.role === filter);
  const activeLanguageModel = models.find((model) => model.role === 'language' && model.enabled);
  const defaultModelIds = useMemo(
    () =>
      new Map(
        ROLES.map((role) => [
          role,
          models.find((model) => model.role === role && model.enabled)?.id,
        ]),
      ),
    [models],
  );

  const openEditor = (model?: ModelProfileSummary): void => {
    setMessage('');
    if (model) {
      setEditingModelId(model.id);
      setEditorForm({
        name: model.name,
        provider: model.provider,
        baseUrl: model.baseUrl,
        model: model.model,
        role: model.role,
        apiKey: '',
        maxContextTokens: model.maxContextTokens,
        maxOutputTokens: model.maxOutputTokens,
        temperature: model.temperature,
        enabled: model.enabled,
        priority: model.priority,
      });
    } else {
      setEditingModelId(undefined);
      setEditorForm(emptyModel);
    }
    setEditorOpen(true);
  };

  const closeEditor = (): void => setEditorOpen(false);

  const editorPayload = (): ModelProfileInput & { id?: string } => ({
    ...editorForm,
    ...(editingModelId ? { id: editingModelId } : {}),
  });

  const onSave = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      await window.betterwork.models.save(editorPayload());
      refresh();
      setEditorOpen(false);
      setMessage(editingModelId ? '模型配置已更新。' : '模型已添加，现在可以用于任务。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请检查配置。');
    }
  };

  const onTest = async (): Promise<void> => {
    try {
      const result = await window.betterwork.models.test(editorPayload());
      setMessage(result.message);
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '连接测试失败。');
    }
  };

  const onToggle = (model: ModelProfileSummary): void => {
    reportAction(
      window.betterwork.models
        .setEnabled({ id: model.id, enabled: !model.enabled })
        .then(() => refresh()),
      setMessage,
      '切换启用状态失败，请重试。',
    );
  };

  const onSetDefault = (model: ModelProfileSummary): void => {
    reportAction(
      window.betterwork.models.setDefault({ id: model.id }).then((result) => {
        setMessage(
          result.updated
            ? `${model.name} 已设为${roleName[model.role]}默认模型。`
            : '仅已启用模型可以设为默认。',
        );
        refresh();
      }),
      setMessage,
      '设置默认模型失败，请重试。',
    );
  };

  const onDelete = (model: ModelProfileSummary): void => {
    reportAction(
      window.betterwork.models.delete({ id: model.id }).then(() => refresh()),
      setMessage,
      '删除模型失败，请重试。',
    );
  };

  return {
    models,
    filteredModels,
    filter,
    setFilter,
    defaultModelIds,
    activeLanguageModel,
    message,
    refresh,
    editorOpen,
    editorForm,
    setEditorForm,
    editorIsEditing: Boolean(editingModelId),
    openEditor,
    closeEditor,
    onSave,
    onTest,
    onToggle,
    onSetDefault,
    onDelete,
  };
}
