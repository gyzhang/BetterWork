// @vitest-environment jsdom

import type { ArtifactVersionDetail, EvidenceSummary } from '@betterwork/agent-protocol';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useArtifactSourceSelection } from './use-artifact-source-selection';

const knowledgeEvidence = (id: string, operation: 'search' | 'read'): EvidenceSummary => ({
  id,
  taskId: 'task-1',
  runId: 'run-1',
  sourceType: 'local-file',
  sourceUri: '/notes/经营口径.md',
  title: `经营口径 · ${id}`,
  locator: '修订 rev-1',
  excerpt: '收入按回款口径统计。',
  contentHash: `hash-${id}`,
  capturedAt: 1,
  knowledgeSource: {
    reference: {
      kind: 'knowledge-revision',
      knowledgeDocumentId: 'doc-1',
      knowledgeRevisionId: 'rev-1',
      contentHash: 'content-1',
      sourcePath: '/notes/经营口径.md',
    },
    textHash: `text-${id}`,
    span: { sectionOrdinal: 1, start: 0, end: 120 },
    operation,
  },
});

const legacyEvidence = (id: string): EvidenceSummary => ({
  id,
  taskId: 'task-1',
  runId: 'run-1',
  sourceType: 'local-file',
  sourceUri: '/notes/历史资料.md',
  title: `历史资料 ${id}`,
  locator: '本地资料 · 历史范围未记录',
  excerpt: '旧数据没有区间定位。',
  contentHash: `hash-${id}`,
  capturedAt: 1,
});

/**
 * 版本对象必须是稳定引用：Hook 以版本身份重置选择状态，
 * 每次渲染新建对象会让重置效果自激。生产链路里 `visibleVersion` 由 useArtifactViewer memo。
 */
const versionDetail = (evidence: EvidenceSummary[]): ArtifactVersionDetail => ({
  type: 'markdown',
  id: 'version-2',
  artifactId: 'artifact-1',
  versionNumber: 2,
  origin: 'user-edit',
  sourceRunId: 'run-1',
  createdAt: 2,
  sourceDeclarationKind: 'model',
  content: '# 复盘',
  contentHash: 'hash-2',
  evidence,
  inputRelations: [
    {
      outputVersionId: 'version-1',
      input: { kind: 'evidence', evidenceId: 'evidence-read' },
      relation: 'data',
      createdAt: 1,
    },
  ],
});

const renderSelection = (evidence: EvidenceSummary[]) => {
  const version = versionDetail(evidence);
  return renderHook(() => useArtifactSourceSelection(version));
};

describe('useArtifactSourceSelection', () => {
  it('只把带精确定位的运行访问记录列为候选', () => {
    const { result } = renderSelection([
      knowledgeEvidence('evidence-read', 'read'),
      knowledgeEvidence('evidence-search', 'search'),
      legacyEvidence('evidence-legacy'),
    ]);

    expect(result.current.candidates.map((candidate) => candidate.evidenceId)).toEqual([
      'evidence-read',
      'evidence-search',
    ]);
    expect(result.current.candidates.at(0)?.operationLabel).toBe('正文依据');
    expect(result.current.candidates.at(1)?.operationLabel).toBe('摘要依据');
  });

  it('未改动时不提交该字段，交给宿主按继承矩阵处理', () => {
    const { result } = renderSelection([knowledgeEvidence('evidence-read', 'read')]);

    expect(result.current.touched).toBe(false);
    expect(result.current.buildInputRelations()).toBeUndefined();
  });

  it('重新勾选后提交用户级证据声明', () => {
    const { result } = renderSelection([
      knowledgeEvidence('evidence-read', 'read'),
      knowledgeEvidence('evidence-search', 'search'),
    ]);

    act(() => result.current.toggle('evidence-search'));
    act(() => result.current.setRelation('evidence-search', 'rule'));

    expect(result.current.touched).toBe(true);
    expect(result.current.buildInputRelations()).toEqual([
      { input: { kind: 'evidence', evidenceId: 'evidence-read' }, relation: 'data' },
      { input: { kind: 'evidence', evidenceId: 'evidence-search' }, relation: 'rule' },
    ]);
  });

  it('取消全部勾选表示主动清除采用声明', () => {
    const { result } = renderSelection([knowledgeEvidence('evidence-read', 'read')]);

    expect(result.current.isSelected('evidence-read')).toBe(true);
    act(() => result.current.toggle('evidence-read'));

    expect(result.current.buildInputRelations()).toEqual([]);
  });

  it('改为沿用上一版会撤销本次声明并回到前版勾选', () => {
    const { result } = renderSelection([
      knowledgeEvidence('evidence-read', 'read'),
      knowledgeEvidence('evidence-search', 'search'),
    ]);

    act(() => result.current.toggle('evidence-search'));
    act(() => result.current.inheritPrevious());

    expect(result.current.touched).toBe(false);
    expect(result.current.isSelected('evidence-search')).toBe(false);
    expect(result.current.isSelected('evidence-read')).toBe(true);
    expect(result.current.buildInputRelations()).toBeUndefined();
  });
});
