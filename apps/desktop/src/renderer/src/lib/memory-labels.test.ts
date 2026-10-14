import type { MemorySourceRef, MemoryViewItem } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import {
  formatValidityDate,
  formatValidityRange,
  fromDateInputValue,
  isActiveMemoryJob,
  isGlobalMemoryScope,
  isTerminalMemory,
  memoryProvenanceLabel,
  memoryRunPhaseLabel,
  memoryScopeLabel,
  sourceKindLabel,
  toDateInputValue,
} from './memory-labels';

const view = (
  status: MemoryViewItem['status'],
  authority: Extract<
    MemoryViewItem['provenance'],
    { verification: 'verified' }
  >['authority'] = 'user-instruction',
  kinds: MemorySourceRef['kind'][] = [],
  verification: MemoryViewItem['provenance']['verification'] = 'verified',
): MemoryViewItem =>
  ({
    status,
    provenance: { authority, verification, sources: kinds.map((kind) => ({ kind })) },
  }) as unknown as MemoryViewItem;

describe('memory scope and provenance presentation', () => {
  it.each([
    [{ kind: 'user' }, '所有工作', '所有工作', true],
    [{ kind: 'workspace', workspaceId: 'ws' }, '工作空间 · ws', '工作空间 · 项目', false],
    [{ kind: 'expert', expertId: 'ex' }, '专家通用 · ex', '专家通用 · 分析师', true],
    [
      { kind: 'expert-workspace', workspaceId: 'ws', expertId: 'ex' },
      '专家与工作空间 · ex · ws',
      '专家与工作空间 · 分析师 · 项目',
      false,
    ],
  ] as const)('labels $0 without widening its scope', (scope, fallback, resolved, global) => {
    expect(memoryScopeLabel(scope)).toBe(fallback);
    expect(memoryScopeLabel(scope, '项目', '分析师')).toBe(resolved);
    expect(isGlobalMemoryScope(scope)).toBe(global);
  });

  it.each([
    ['manual', '人工填写'],
    ['run-user', '我的发言'],
    ['run-assistant', '助手回答'],
    ['checkpoint', '讨论节点'],
    ['artifact-version', '成果版本'],
  ] as const)('names the source %s precisely', (kind, label) => {
    expect(sourceKindLabel(kind)).toBe(label);
  });

  it('deduplicates source kinds while preserving the first-source order', () => {
    expect(
      memoryProvenanceLabel(
        view('confirmed', 'user-instruction', ['run-user', 'manual', 'run-user']),
      ),
    ).toBe('我明确制定的要求 · 我的发言、人工填写');
    expect(
      memoryProvenanceLabel(view('confirmed', 'derived', ['run-assistant', 'artifact-version'])),
    ).toBe('由资料或回答提炼 · 助手回答、成果版本');
  });

  it('keeps legacy provenance explicitly unverified', () => {
    expect(
      memoryProvenanceLabel(view('confirmed', 'user-instruction', ['manual'], 'legacy-unverified')),
    ).toBe('旧版来源，无法确认出处');
  });

  it('describes dispatch as an attempt rather than confirmed model receipt', () => {
    expect(memoryRunPhaseLabel).toEqual({
      selected: '已选入准备',
      'request-prepared': '已构造成请求上下文',
      'dispatch-attempted': '已尝试调用模型',
      legacy_unknown: '旧版记录，无法确认请求阶段',
    });
  });

  it.each([
    'queued',
    'running',
    'succeeded',
    'failed',
    'cancelled',
    'interrupted',
    'skipped',
  ] as const)('polls only active extraction jobs (%s)', (status) => {
    expect(isActiveMemoryJob(status)).toBe(status === 'queued' || status === 'running');
  });

  it.each(['candidate', 'confirmed', 'expired', 'superseded', 'deleted'] as const)(
    'recognizes immutable terminal memory status %s',
    (status) => {
      expect(isTerminalMemory(view(status))).toBe(['superseded', 'deleted'].includes(status));
    },
  );
});

describe('memory validity input boundaries', () => {
  const start = new Date(2020, 0, 2).getTime();
  const end = new Date(2020, 10, 12).getTime();
  it.each([
    [undefined, undefined, '长期有效'],
    [start, undefined, '2020-01-02 起'],
    [undefined, end, '2020-11-12 前'],
    [start, end, '2020-01-02 至 2020-11-12'],
  ])('preserves open validity endpoints %s / %s', (from, until, expected) => {
    expect(formatValidityRange(from, until)).toBe(expected);
  });

  it('round-trips a local calendar date and keeps unset distinct from epoch zero', () => {
    expect(formatValidityDate(start)).toBe('2020-01-02');
    expect(toDateInputValue(start)).toBe('2020-01-02');
    expect(fromDateInputValue('2020-01-02')).toBe(start);
    expect(toDateInputValue(undefined)).toBe('');
    expect(toDateInputValue(0)).not.toBe('');
  });

  it.each(['', '  ', 'not-a-date', '2020-13-40'])(
    'rejects empty or invalid date input %s',
    (input) => {
      expect(fromDateInputValue(input)).toBeUndefined();
    },
  );
});
