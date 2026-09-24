import type {
  CreateMemoryRequest,
  MemoryEditPatch,
  MemoryFacet,
  MemoryLegacySourceReview,
  MemoryScope,
  MemorySourceSelector,
  MemoryViewItem,
} from '@betterwork/agent-protocol';
import {
  countCodePoints,
  MEMORY_CONTENT_MAX_CODE_POINTS,
  MEMORY_TOPIC_KEY_MAX_CODE_POINTS,
} from '@betterwork/agent-protocol';
import { useState } from 'react';

import { newMemoryOperationId } from '../hooks/use-memories';
import { trackAction } from '../lib/async-action';
import {
  facetLabel,
  fromDateInputValue,
  memoryScopeLabel,
  toDateInputValue,
} from '../lib/memory-labels';
import { FieldSelect } from './FieldSelect';

/**
 * 人工保存与编辑并确认的可编辑表单（产品设计 §3.1、§3.2、§3.4）。
 *
 * 四条硬约束：
 * - 正文按 **code point** 计数并当场显示余额，不用 UTF-16 长度自欺（契约 §5.1）；
 * - 工作空间事实不得直接改成全局记忆，提升全局必须重新表述并声明通用性（§3.1）；
 * - 「作为我的工作口径重新保存」显示与原记忆的差别，并走新的人工来源，
 *   绝不在后台静默解除资料依赖（§3.2）；
 * - 提交失败（尤其修订冲突）时**草稿原样保留**，由调用方决定何时关闭。
 *
 * 提交走哪条命令由治理动作表决定（契约 §5.4）：候选确认走 `set-status`＋`confirmPatch`，
 * 已确认记录的编辑走 `update`，过期记录必须 `reconfirm` 并同时改有效期。
 *
 * §5.3 的审计线索已打通：重新表述提交 `fromMemoryRevisionId`，Main 校验后原样写进回执。
 */

export const memoryFacetOrder: readonly MemoryFacet[] = [
  'goal',
  'constraint',
  'decision',
  'fact',
  'method',
  'preference',
  'experience',
];

/** 表单字段；日期已折算成 epoch milliseconds，`undefined` 表示未设置。 */
export interface MemoryEditorFields {
  content: string;
  facet: MemoryFacet;
  topicKey: string;
  validFrom: number | undefined;
  validUntil: number | undefined;
  scope: MemoryScope;
}

export type MemoryEditorSubmission =
  | { kind: 'create'; request: CreateMemoryRequest }
  | {
      kind: 'update';
      memoryId: string;
      expectedRevision: number;
      operationId: string;
      patch: MemoryEditPatch;
      /** legacy 记录的来源复核；其余记录为 undefined。 */
      legacySourceReview: MemoryLegacySourceReview | undefined;
    }
  | {
      kind: 'confirm';
      memoryId: string;
      expectedRevision: number;
      operationId: string;
      action: 'confirm' | 'reconfirm';
      /** 无改动时省略：契约要求 patch 至少一个字段，空对象会被拒。 */
      confirmPatch: MemoryEditPatch | undefined;
    };

export interface MemoryEditorProps {
  /** 可提交的适用范围，由调用方按当前工作空间与专家裁剪；首项即默认值。 */
  scopes: MemoryScope[];
  /** 编辑并确认候选时传入；省略即为新建。 */
  memory?: MemoryViewItem;
  /** §3.2 重新表述路径：显示差异并强制走人工来源。 */
  restateFrom?: MemoryViewItem;
  /** 预填正文只能来自用户选中的片段（§3.1）。 */
  initialContent?: string;
  /** 选中片段对应的来源选择器；人工表单没有它时正文自身即来源。 */
  sourceSelector?: MemorySourceSelector;
  /** 来源说明文案，例如「来自本次你的发言」。 */
  sourceNote?: string;
  /** 提交按钮文案。 */
  submitLabel?: string;
  /**
   * 编辑并确认走哪个治理动作：候选是 `confirm`，已过期的记录必须 `reconfirm`，
   * 而 `reconfirm` 要求同时修改有效期（契约 §5.4）。
   */
  confirmAction?: 'confirm' | 'reconfirm';
  /**
   * legacy 记录的来源复核结果，只随 `update` 提交（契约 §5.4）。
   * 界面无法为历史记录造精确选择器，因此复核入口只有「按我的工作口径保留」一条路。
   */
  legacySourceReview?: MemoryLegacySourceReview;
  /** 适用范围下拉框里工作空间/专家的名称回显；省略时回退到 ID。 */
  workspaceName?: string;
  expertName?: string;
  /** 返回 `true` 表示 Main 已接受，表单随即关闭；`false` 时草稿原样保留。 */
  onSubmit: (submission: MemoryEditorSubmission) => Promise<boolean>;
  onCancel: () => void;
}

const isGlobalScope = (scope: MemoryScope): boolean =>
  scope.kind === 'user' || scope.kind === 'expert';

/**
 * 把表单字段翻成契约 §9.1 的 patch：日期与议题只用 `set`/`clear`，
 * 省略即表示保留，不用 `undefined` 猜「清空」。
 */
export const buildMemoryEditPatch = (
  fields: MemoryEditorFields,
  memory: MemoryViewItem,
): MemoryEditPatch => {
  const patch: MemoryEditPatch = {};
  const content = fields.content.trim();
  if (content && content !== memory.content) patch.content = content;
  if (fields.facet !== memory.facet) patch.facet = fields.facet;
  if (fields.scope.kind !== memory.scope.kind) patch.scope = fields.scope;
  const topic = fields.topicKey.trim();
  if (topic && topic !== memory.topicKey) patch.topicKey = { action: 'set', value: topic };
  if (!topic && memory.topicKey !== undefined) patch.topicKey = { action: 'clear' };
  if (fields.validFrom !== memory.validFrom) {
    patch.validFrom =
      fields.validFrom === undefined
        ? { action: 'clear' }
        : { action: 'set', value: fields.validFrom };
  }
  if (fields.validUntil !== memory.validUntil) {
    patch.validUntil =
      fields.validUntil === undefined
        ? { action: 'clear' }
        : { action: 'set', value: fields.validUntil };
  }
  return patch;
};

/** patch 是否没有任何字段变化；契约要求至少一个字段，空对象一定被 Main 拒。 */
export const isMemoryEditPatchEmpty = (patch: MemoryEditPatch): boolean =>
  Object.keys(patch).length === 0;

/** 过期记录只有「明确修改有效期 + 重新确认」一条路（产品设计 §3.4）。 */
export const reconfirmProblems = (
  fields: MemoryEditorFields,
  memory: MemoryViewItem | undefined,
): string[] => {
  if (!memory) return [];
  const patch = buildMemoryEditPatch(fields, memory);
  const validityChanged = patch.validFrom !== undefined || patch.validUntil !== undefined;
  return validityChanged ? [] : ['这条记录已过期：必须明确修改有效期后才能重新确认。'];
};

/** 表单提交哪条命令：由记录当前状态与动作表推出，不让调用方各写一遍。 */
export const memoryEditorSubmitTarget = (
  memory: MemoryViewItem | undefined,
  confirmAction: 'confirm' | 'reconfirm',
): 'create' | 'confirm' | 'update' => {
  if (!memory) return 'create';
  if (memory.status === 'candidate') return 'confirm';
  if (confirmAction === 'reconfirm') return 'confirm';
  return 'update';
};

const initialGenericDeclaration = (memory: MemoryViewItem | undefined): boolean => {
  if (!memory || memory.provenance.verification !== 'verified') return false;
  return memory.provenance.genericDeclaration === true;
};

export function MemoryEditor({
  scopes,
  memory,
  restateFrom,
  initialContent,
  sourceSelector,
  sourceNote,
  submitLabel,
  confirmAction = 'confirm',
  legacySourceReview,
  workspaceName,
  expertName,
  onSubmit,
  onCancel,
}: MemoryEditorProps): React.JSX.Element {
  const [content, setContent] = useState(memory?.content ?? initialContent ?? '');
  const [facet, setFacet] = useState<MemoryFacet>(memory?.facet ?? 'method');
  const [topicKey, setTopicKey] = useState(memory?.topicKey ?? '');
  const [validFrom, setValidFrom] = useState(toDateInputValue(memory?.validFrom));
  const [validUntil, setValidUntil] = useState(toDateInputValue(memory?.validUntil));
  const [scope, setScope] = useState<MemoryScope>(memory?.scope ?? scopes[0] ?? { kind: 'user' });
  const [genericDeclaration, setGenericDeclaration] = useState(initialGenericDeclaration(memory));
  const [submitting, setSubmitting] = useState(false);
  // 一次打开表单一个幂等键：重复点击与失败重试都复用同一个 operationId，
  // 因此不会堆积多余修订（契约 §5.6）——同内容重复提交由 Main 判 `unchanged`。
  const [operationId] = useState(newMemoryOperationId);

  const contentPoints = countCodePoints(content.trim());
  const topicPoints = countCodePoints(topicKey.trim());
  const from = fromDateInputValue(validFrom);
  const until = fromDateInputValue(validUntil);
  const fields: MemoryEditorFields = {
    content,
    facet,
    topicKey,
    validFrom: from,
    validUntil: until,
    scope,
  };
  const restating = restateFrom !== undefined;
  const globalTarget = isGlobalScope(scope);
  const target = memoryEditorSubmitTarget(memory, confirmAction);
  const patch = memory === undefined ? undefined : buildMemoryEditPatch(fields, memory);
  const unchanged = patch !== undefined && isMemoryEditPatchEmpty(patch);

  const problems: string[] = [];
  if (!content.trim()) problems.push('请填写要长期复用的内容。');
  if (contentPoints > MEMORY_CONTENT_MAX_CODE_POINTS)
    problems.push(`正文最多 ${MEMORY_CONTENT_MAX_CODE_POINTS} 个字符，当前 ${contentPoints} 个。`);
  if (topicPoints > MEMORY_TOPIC_KEY_MAX_CODE_POINTS)
    problems.push(`议题标识最多 ${MEMORY_TOPIC_KEY_MAX_CODE_POINTS} 个字符。`);
  if (from !== undefined && until !== undefined && until <= from)
    problems.push('失效日期必须晚于生效日期。');
  if (restating && restateFrom !== undefined && content.trim() === restateFrom.content)
    problems.push('作为工作口径重新保存需要重新表述，不能原样复制资料结论。');
  if (globalTarget && !genericDeclaration)
    problems.push('保存为全局记忆前，请确认这是一条通用要求并勾选声明。');
  if (memory !== undefined && !isGlobalScope(memory.scope) && globalTarget && !restating)
    problems.push('工作空间事实不能直接改成全局记忆，请改用「作为我的工作口径重新保存」。');
  if (target === 'confirm' && confirmAction === 'reconfirm') {
    problems.push(...reconfirmProblems(fields, memory));
  }
  if (target === 'update' && unchanged && legacySourceReview === undefined) {
    problems.push('没有字段变化：请修改内容、分类、适用范围或有效期后再保存。');
  }

  const submit = (): void => {
    if (problems.length > 0 || submitting) return;
    setSubmitting(true);
    const request: CreateMemoryRequest = {
      operationId,
      content: fields.content.trim(),
      facet: fields.facet,
      scope: fields.scope,
      ...(fields.topicKey.trim() ? { topicKey: fields.topicKey.trim() } : {}),
      ...(from === undefined ? {} : { validFrom: from }),
      ...(until === undefined ? {} : { validUntil: until }),
      // 重新表述路径的来源就是用户此刻提交的人工表单，不沿用资料选择器（§3.2）。
      ...(restating || sourceSelector === undefined ? {} : { sourceSelector }),
      // §5.3：人工表单没有选择片段时，正文自身就是来源——必须声明为用户口径，
      // 否则工作空间范围的保存会被服务判成「缺来源」。只有带选择器时才走资料派生。
      asUserInstruction: sourceSelector === undefined || restating,
      ...(globalTarget && genericDeclaration ? { genericDeclaration: true } : {}),
      // §5.3：重新表述留下的审计线索只指回被重述的那条修订，不声明任何资料依赖已核实。
      ...(restateFrom === undefined ? {} : { fromMemoryRevisionId: restateFrom.revisionId }),
    };
    let submission: MemoryEditorSubmission;
    if (memory && target === 'update') {
      // 只复核来源、正文一字不改时用分类原值当 patch 载体（契约要求至少一个字段）。
      const carried: MemoryEditPatch = patch && !unchanged ? patch : { facet: memory.facet };
      submission = {
        kind: 'update',
        memoryId: memory.id,
        expectedRevision: memory.revision,
        operationId,
        patch: carried,
        legacySourceReview,
      };
    } else if (memory) {
      submission = {
        kind: 'confirm',
        memoryId: memory.id,
        expectedRevision: memory.revision,
        operationId,
        action: confirmAction,
        confirmPatch: patch && !unchanged ? patch : undefined,
      };
    } else {
      submission = { kind: 'create', request };
    }
    trackAction(
      onSubmit(submission).then((accepted) => {
        // 失败时保留草稿与幂等键，让用户改完再交；成功后由调用方卸载本组件。
        if (!accepted) setSubmitting(false);
      }),
      '提交记忆表单',
    );
  };

  return (
    <div className="memory-editor">
      <label className="memory-editor-field">
        <span>要长期复用的内容</span>
        <textarea
          value={content}
          rows={4}
          aria-label="记忆正文"
          onChange={(event) => setContent(event.target.value)}
          placeholder="例如：收入按回款金额统计，不使用签约金额。"
        />
        <small className={contentPoints > MEMORY_CONTENT_MAX_CODE_POINTS ? 'over' : ''}>
          {contentPoints} / {MEMORY_CONTENT_MAX_CODE_POINTS}
        </small>
      </label>
      {restating && restateFrom && (
        <div className="memory-editor-diff">
          <strong>与原记忆的差别</strong>
          <div className="memory-editor-diff-row">
            <span>原记忆（资料派生）</span>
            <p>{restateFrom.content}</p>
          </div>
          <div className="memory-editor-diff-row">
            <span>作为我的工作口径</span>
            <p>{content.trim() || '（尚未填写）'}</p>
          </div>
          <small>
            重新保存会新建一条人工来源的记忆，不解除原资料的读取依赖，也不代表原资料事实已核实。
          </small>
        </div>
      )}
      <div className="memory-editor-grid">
        <label>
          <span>分类</span>
          <FieldSelect
            ariaLabel="记忆分类"
            value={facet}
            options={memoryFacetOrder.map((f) => ({ id: f, label: facetLabel[f] }))}
            onChange={(id) => setFacet(id as MemoryFacet)}
          />
        </label>
        <label>
          <span>适用范围</span>
          <FieldSelect
            ariaLabel="记忆适用范围"
            value={scope.kind}
            options={scopes.map((option) => ({
              id: option.kind,
              label: memoryScopeLabel(option, workspaceName, expertName),
            }))}
            onChange={(kind) => {
              const next = scopes.find((option) => option.kind === kind);
              if (next) setScope(next);
            }}
          />
        </label>
        <label>
          <span>议题（可选）</span>
          <span className="memory-editor-counted">
            <input
              aria-label="议题标识"
              value={topicKey}
              placeholder="例如：收入口径"
              onChange={(event) => setTopicKey(event.target.value)}
            />
            <small className={topicPoints > MEMORY_TOPIC_KEY_MAX_CODE_POINTS ? 'over' : ''}>
              {topicPoints} / {MEMORY_TOPIC_KEY_MAX_CODE_POINTS}
            </small>
          </span>
        </label>
        <label>
          <span>生效日期（可选）</span>
          <input
            aria-label="生效日期"
            type="date"
            value={validFrom}
            onChange={(event) => setValidFrom(event.target.value)}
          />
        </label>
        <label>
          <span>失效日期（可选）</span>
          <input
            aria-label="失效日期"
            type="date"
            value={validUntil}
            onChange={(event) => setValidUntil(event.target.value)}
          />
        </label>
      </div>
      <p className="memory-editor-note">
        有效期缺省即长期有效；到期只派生「已过期」，不会自动删除记录。
      </p>
      {sourceNote && <p className="memory-editor-note">来源：{sourceNote}</p>}
      {globalTarget && (
        <label className="memory-editor-declaration">
          <input
            type="checkbox"
            aria-label="声明为通用要求"
            checked={genericDeclaration}
            onChange={(event) => setGenericDeclaration(event.target.checked)}
          />
          <span>这是我的通用工作要求，与具体工作空间或资料无关</span>
        </label>
      )}
      {problems.length > 0 && (
        <ul className="inline-message error memory-editor-problems">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <div className="memory-editor-footer">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={submitting}>
          取消
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={submit}
          disabled={problems.length > 0 || submitting}
        >
          {submitting ? '正在提交…' : (submitLabel ?? '保存')}
        </button>
      </div>
    </div>
  );
}
