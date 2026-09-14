import type { MemoryRecord } from '@betterwork/agent-protocol';
import { useState } from 'react';

import type { MemoriesState } from '../hooks/use-memories';
import { trackAction } from '../lib/async-action';

const statusLabel: Record<MemoryRecord['status'], string> = {
  candidate: '待确认',
  confirmed: '已确认',
  superseded: '已被替代',
  expired: '已过期',
  deleted: '已删除',
};

const scopeLabel = (memory: MemoryRecord): string => {
  switch (memory.scope.kind) {
    case 'user':
      return '用户';
    case 'workspace':
      return `工作空间 · ${memory.scope.workspaceId}`;
    case 'expert':
      return `专家 · ${memory.scope.expertId}`;
    case 'expert-workspace':
      return `专家 · ${memory.scope.expertId} · 工作空间 · ${memory.scope.workspaceId}`;
  }
};

export function MemoryPage({ state }: { state: MemoriesState }): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string>();
  const [editingContent, setEditingContent] = useState('');
  const visible = state.memories.filter((memory) => memory.status !== 'deleted');

  const beginEdit = (memory: MemoryRecord): void => {
    setEditingId(memory.id);
    setEditingContent(memory.content);
  };

  return (
    <section className="settings-section memory-settings">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">记忆</p>
          <h2>让长期经验可查看、可确认、可撤回</h2>
          <p>只有已确认的记忆会在新任务中作为背景使用。候选记忆不会自动进入模型上下文。</p>
        </div>
        <button className="secondary-button" onClick={state.refresh}>
          刷新
        </button>
      </div>
      {state.error && <p className="inline-message error">{state.error}</p>}
      <div className="memory-create-form">
        <label>
          记住一条用户偏好或工作方法
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="例如：经营月报先核对财务规则，再比较环比变化。"
            rows={3}
          />
        </label>
        <button
          className="primary-button"
          disabled={!draft.trim()}
          onClick={() =>
            trackAction(
              state
                .create({
                  scope: { kind: 'user' },
                  kind: 'procedural',
                  content: draft.trim(),
                  sourceType: 'user-explicit',
                  status: 'confirmed',
                })
                .then(() => setDraft('')),
              '保存记忆',
            )
          }
        >
          记住
        </button>
      </div>
      {state.loading ? (
        <div className="setting-placeholder">正在加载记忆…</div>
      ) : visible.length === 0 ? (
        <div className="setting-placeholder">
          <strong>还没有长期记忆</strong>
          <p>在这里记录稳定的偏好和工作方法，下一次任务会按作用域复用。</p>
        </div>
      ) : (
        <div className="memory-list">
          {visible.map((memory) => (
            <article className={`memory-row memory-${memory.status}`} key={memory.id}>
              <div className="memory-main">
                <div className="memory-meta">
                  <span className="current-badge">{statusLabel[memory.status]}</span>
                  <span>{memory.kind}</span>
                  <span>{scopeLabel(memory)}</span>
                </div>
                {editingId === memory.id ? (
                  <textarea
                    value={editingContent}
                    onChange={(event) => setEditingContent(event.target.value)}
                    rows={3}
                  />
                ) : (
                  <p>{memory.content}</p>
                )}
                <small>
                  来源：{memory.sourceType} · 修订 v{memory.revision} · 置信度 {memory.confidence}
                </small>
              </div>
              <div className="memory-actions">
                {memory.status === 'candidate' && (
                  <button
                    onClick={() => trackAction(state.setStatus(memory, 'confirmed'), '确认记忆')}
                  >
                    确认
                  </button>
                )}
                {editingId === memory.id ? (
                  <>
                    <button
                      onClick={() =>
                        trackAction(
                          state
                            .updateContent(memory, editingContent.trim())
                            .then(() => setEditingId(undefined)),
                          '保存记忆修改',
                        )
                      }
                      disabled={!editingContent.trim()}
                    >
                      保存
                    </button>
                    <button onClick={() => setEditingId(undefined)}>取消</button>
                  </>
                ) : (
                  <button onClick={() => beginEdit(memory)}>编辑</button>
                )}
                {memory.status !== 'deleted' && memory.status !== 'superseded' && (
                  <button
                    className="danger-text"
                    onClick={() => trackAction(state.setStatus(memory, 'deleted'), '删除记忆')}
                  >
                    删除
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
