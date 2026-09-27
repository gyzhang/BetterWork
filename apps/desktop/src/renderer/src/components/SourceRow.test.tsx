// @vitest-environment jsdom

import type { EvidenceSummary, KnowledgeEvidenceSource } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { evidenceSourceKindLabel, SourceRow } from './SourceRow';

const HASH = 'sha256:0000000000000000';

const knowledgeSource = (
  operation: KnowledgeEvidenceSource['operation'],
): KnowledgeEvidenceSource => ({
  reference: {
    kind: 'knowledge-revision',
    knowledgeDocumentId: 'doc-1',
    knowledgeRevisionId: 'revision-12345678',
    contentHash: HASH,
    sourcePath: '/vault/季度经营计划.md',
  },
  textHash: HASH,
  span: { sectionOrdinal: 1, start: 20, end: 40 },
  operation,
});

const evidenceOf = (overrides: Partial<EvidenceSummary>): EvidenceSummary => ({
  id: 'e1',
  taskId: 't1',
  runId: 'r1',
  sourceType: 'local-file',
  sourceUri: '/vault/季度经营计划.md',
  title: '季度经营计划.md',
  locator: 'plan.md:12',
  excerpt: '本季把资源集中到三条产品线。',
  contentHash: HASH,
  capturedAt: 0,
  ...overrides,
});

const local = evidenceOf({});
const web = evidenceOf({ sourceType: 'web-page' });
const mcp = evidenceOf({ sourceType: 'mcp-tool' });
const withKnowledge = (operation: KnowledgeEvidenceSource['operation']): EvidenceSummary =>
  evidenceOf({ knowledgeSource: knowledgeSource(operation) });

afterEach(() => {
  cleanup();
});

describe('SourceRow 基座', () => {
  it('来源类型只有一套口径：本地资料按访问方式细分', () => {
    expect(evidenceSourceKindLabel(web)).toBe('网页来源');
    expect(evidenceSourceKindLabel(mcp)).toBe('MCP 工具');
    expect(evidenceSourceKindLabel(local)).toBe('本地资料 · 历史范围未记录');
    expect(evidenceSourceKindLabel(withKnowledge('search'))).toBe('摘要来源');
    expect(evidenceSourceKindLabel(withKnowledge('read'))).toBe('正文来源');
  });

  it('行内容是「定位符 · 类型」，领域附加信息拼在同一行后面', () => {
    const { container } = render(<SourceRow item={local} metaExtra=" · 第 2 段 20–40 字" />);

    expect(container.querySelector('.list-row-title')?.textContent).toBe('季度经营计划.md');
    expect(container.querySelector('.list-row-meta')?.textContent).toBe(
      'plan.md:12 · 本地资料 · 历史范围未记录 · 第 2 段 20–40 字',
    );
  });

  it('摘要默认不出现，只有面板那种宽行要求 showExcerpt', () => {
    const plain = render(<SourceRow item={local} />);
    expect(plain.container.querySelector('.list-row-detail')).toBeNull();
    plain.unmount();

    const withExcerpt = render(<SourceRow item={local} showExcerpt />);
    expect(withExcerpt.container.querySelector('.list-row-detail')?.textContent).toBe(
      '本季把资源集中到三条产品线。',
    );
  });

  it('只有本地资料给「原文」入口，网页与 MCP 的来源就是那次调用本身', () => {
    const onOpenSource = vi.fn();
    for (const item of [web, mcp]) {
      const { container, unmount } = render(<SourceRow item={item} onOpenSource={onOpenSource} />);
      expect(container.querySelector('button')).toBeNull();
      unmount();
    }

    const { container } = render(<SourceRow item={local} onOpenSource={onOpenSource} />);
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toBe('原文');
    fireEvent.click(button);
    expect(onOpenSource).toHaveBeenCalledOnce();
  });

  it('领域动作留在页面手里，与「原文」并排进右槽', () => {
    const { container } = render(
      <SourceRow
        item={local}
        actions={<button type="button">查看区间</button>}
        onOpenSource={vi.fn()}
      />,
    );

    const labels = [...container.querySelectorAll('.list-row-actions button')].map(
      (button) => button.textContent,
    );
    expect(labels).toEqual(['查看区间', '原文']);
  });
});
