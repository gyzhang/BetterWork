import { createHash } from 'node:crypto';

import type { MaterialReference } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import {
  assertNoDependencyCycle,
  buildDerivedProvenance,
  buildLegacyProvenance,
  buildUserInstructionProvenance,
  manualMemorySource,
  memoryDependencyOf,
  promptHashOf,
  type ProvenanceReader,
  resolveMemorySourceSelector,
} from './memory-provenance';

const sha = (value: string): string => createHash('sha256').update(value).digest('hex');

const material = (revisionId: string): MaterialReference => ({
  kind: 'knowledge-revision',
  knowledgeDocumentId: 'doc-1',
  knowledgeRevisionId: revisionId,
  contentHash: sha(revisionId),
  sourcePath: `/tmp/${revisionId}.md`,
});

const reader = (over: Partial<ProvenanceReader> = {}): ProvenanceReader => ({
  runPrompt: () => '收入按回款金额统计，不使用签约金额。',
  runAssistantEventContent: () => '已按签约金额完成本期统计。',
  runMaterialReferences: () => [material('kr-1')],
  checkpointField: (_id, field) => (field === 'feedback' ? '这里应改为不含税口径。' : '续约讨论'),
  artifactVersion: () => ({
    artifactId: 'a-1',
    contentHash: sha('version'),
    readableText: '结论：收入按回款金额统计。',
  }),
  ...over,
});

describe('resolveMemorySourceSelector', () => {
  it('derives a run-user source from the stored prompt, not from the caller', () => {
    const resolved = resolveMemorySourceSelector(
      { kind: 'run-user', runId: 'r-1', start: 0, end: 2 },
      reader(),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.source).toMatchObject({ kind: 'run-user', excerpt: '收入' });
    expect(resolved.value.authority).toBe('user-instruction');
    // 用户本人的发言不继承材料依赖。
    expect(resolved.value.materialDependencies).toEqual([]);
    if (resolved.value.source.kind !== 'run-user') throw new Error('来源类型不符。');
    expect(resolved.value.source.promptHash).toBe(
      promptHashOf('收入按回款金额统计，不使用签约金额。'),
    );
  });

  it('rejects an excerpt range that runs past the real source text', () => {
    const resolved = resolveMemorySourceSelector(
      { kind: 'run-user', runId: 'r-1', start: 0, end: 9_999 },
      reader(),
    );
    expect(resolved).toMatchObject({ ok: false, code: 'SOURCE_MISMATCH' });
  });

  it('rejects a reversed or empty range', () => {
    expect(
      resolveMemorySourceSelector({ kind: 'run-user', runId: 'r-1', start: 5, end: 3 }, reader()),
    ).toMatchObject({ ok: false });
    expect(
      resolveMemorySourceSelector({ kind: 'run-user', runId: 'r-1', start: 2, end: 2 }, reader()),
    ).toMatchObject({ ok: false });
  });

  it('refuses to invent a source for a run that does not exist', () => {
    const resolved = resolveMemorySourceSelector(
      { kind: 'run-user', runId: 'missing', start: 0, end: 2 },
      reader({ runPrompt: () => undefined }),
    );
    expect(resolved).toMatchObject({ ok: false, code: 'SOURCE_UNAVAILABLE' });
  });

  it('requires the assistant event id to be one actually recorded for that run', () => {
    expect(
      resolveMemorySourceSelector(
        { kind: 'run-assistant', runId: 'r-1', eventId: 'forged', start: 0, end: 3 },
        reader({ runAssistantEventContent: () => undefined }),
      ),
    ).toMatchObject({ ok: false, code: 'SOURCE_UNAVAILABLE' });
  });

  it('hashes the whole assistant body and inherits that run material dependencies', () => {
    const content = '已按签约金额完成本期统计。';
    const resolved = resolveMemorySourceSelector(
      { kind: 'run-assistant', runId: 'r-1', eventId: 'e-1', start: 0, end: 3 },
      reader(),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.authority).toBe('derived');
    if (resolved.value.source.kind !== 'run-assistant') throw new Error('来源类型不符。');
    expect(resolved.value.source.contentHash).toBe(sha(content));
    expect(resolved.value.materialDependencies).toHaveLength(1);
  });

  it('ignores checkpoint status and updated time when hashing the field body', () => {
    const resolved = resolveMemorySourceSelector(
      { kind: 'checkpoint', checkpointId: 'c-1', field: 'feedback', start: 0, end: 4 },
      reader(),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    if (resolved.value.source.kind !== 'checkpoint') throw new Error('来源类型不符。');
    expect(resolved.value.source.contentHash).toBe(sha('这里应改为不含税口径。'));
    expect(resolved.value.source.excerpt).toBe('这里应改');
  });

  it('verifies artifact excerpts against the readable managed version', () => {
    const selector = {
      kind: 'artifact-version' as const,
      artifactVersionId: 'v-1',
      locator: '第 1 段',
      selectedText: '收入按回款金额统计',
    };
    const resolved = resolveMemorySourceSelector(selector, reader());
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.source.start).toBe(3);
    expect(resolved.value.source.end).toBe(3 + '收入按回款金额统计'.length);
    expect(resolved.value.source.excerptHash).toBe(sha(selector.selectedText));
  });

  it('rejects text that is not in that version', () => {
    expect(
      resolveMemorySourceSelector(
        {
          kind: 'artifact-version',
          artifactVersionId: 'v-1',
          locator: '第 1 段',
          selectedText: '签约金额口径',
        },
        reader(),
      ),
    ).toMatchObject({ ok: false, code: 'SOURCE_MISMATCH' });
  });

  it('falls back to manual sourcing for formats it cannot locate precisely', () => {
    expect(
      resolveMemorySourceSelector(
        {
          kind: 'artifact-version',
          artifactVersionId: 'v-1',
          locator: '第 3 页',
          selectedText: '任意文本',
        },
        reader({
          artifactVersion: () => ({
            artifactId: 'a-1',
            contentHash: 'h',
            readableText: undefined,
          }),
        }),
      ),
    ).toMatchObject({ ok: false, code: 'SOURCE_UNAVAILABLE' });
  });

  it('counts the artifact offset in code points, not UTF-16 units', () => {
    const resolved = resolveMemorySourceSelector(
      {
        kind: 'artifact-version',
        artifactVersionId: 'v-1',
        locator: '第 1 段',
        selectedText: '🎯目标',
      },
      reader({
        artifactVersion: () => ({ artifactId: 'a', contentHash: 'h', readableText: '📊🎯目标' }),
      }),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.source.start).toBe(1);
    expect(resolved.value.source.end).toBe(4);
  });
});

describe('provenance builders', () => {
  it('builds a self-contained user instruction with empty dependencies', () => {
    const provenance = buildUserInstructionProvenance({
      capturedAt: 100,
      operationId: '11111111-1111-4111-8111-111111111111',
      content: '先列异常和待决策事项。',
    });
    expect(provenance.verification).toBe('verified');
    if (provenance.verification !== 'verified') return;
    expect(provenance.authority).toBe('user-instruction');
    expect(provenance.materialDependencies).toEqual([]);
    expect(provenance.memoryDependencies).toEqual([]);
    expect(provenance.sources[0]?.kind).toBe('manual');
  });

  it('marks legacy rows unverified without fabricating a source or capture time', () => {
    const provenance = buildLegacyProvenance({ sourceType: 'conversation', sourceId: 'r-old' });
    expect(provenance.verification).toBe('legacy-unverified');
    if (provenance.verification !== 'legacy-unverified') return;
    expect(provenance.sourceId).toBe('r-old');
    expect('capturedAt' in provenance).toBe(false);
    expect('sources' in provenance).toBe(false);
  });

  it('refuses a derived provenance whose memory dependency points at itself', () => {
    const dependency = memoryDependencyOf({
      id: 'm-1',
      revisionId: 'rev-1',
      contentHash: sha('x'),
    });
    expect(() => assertNoDependencyCycle([dependency], 'm-1')).toThrow(RangeError);
    expect(() => assertNoDependencyCycle([dependency], 'm-2')).not.toThrow();
  });

  it('keeps a derived provenance schema-valid', () => {
    const source = manualMemorySource('11111111-1111-4111-8111-111111111111', '不含税口径');
    const provenance = buildDerivedProvenance({
      capturedAt: 200,
      sources: [source],
      materialDependencies: [material('kr-1')],
      memoryDependencies: [],
      originWorkspaceId: 'ws-1',
    });
    expect(provenance.verification).toBe('verified');
    if (provenance.verification !== 'verified') return;
    expect(provenance.authority).toBe('derived');
    expect(provenance.originWorkspaceId).toBe('ws-1');
  });
});
