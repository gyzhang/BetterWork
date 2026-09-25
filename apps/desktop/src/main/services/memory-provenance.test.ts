import { createHash } from 'node:crypto';

import type { MaterialReference, MemoryDependency } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import {
  buildDerivedProvenance,
  buildLegacyProvenance,
  buildUserInstructionProvenance,
  manualMemorySource,
  type MemoryRevisionFacts,
  promptHashOf,
  type ProvenanceReader,
  type ResolvedMemorySource,
  resolveMemorySourceSelector,
  type SourceDependencies,
} from './memory-provenance';

const sha = (value: string): string => createHash('sha256').update(value).digest('hex');

const material = (revisionId: string): MaterialReference => ({
  kind: 'knowledge-revision',
  knowledgeDocumentId: 'doc-1',
  knowledgeRevisionId: revisionId,
  contentHash: sha(revisionId),
  sourcePath: `/tmp/${revisionId}.md`,
});

const memoryDependency = (memoryId: string, revisionId: string): MemoryDependency => ({
  memoryId,
  revisionId,
  contentHash: sha(revisionId),
});

const revisionFacts = (
  memoryId: string,
  revisionId: string,
  over: Partial<MemoryRevisionFacts> = {},
): MemoryRevisionFacts => ({
  memoryId,
  revisionId,
  contentHash: sha(revisionId),
  usable: true,
  materialDependencies: [],
  memoryDependencies: [],
  ...over,
});

const ANSWER = '已按签约金额完成本期统计。';

const dependencies = (over: Partial<SourceDependencies> = {}): SourceDependencies => ({
  workspaceId: 'ws-1',
  materials: [material('kr-1')],
  memories: [],
  ...over,
});

/** 只登记测试显式声明的修订：未列出的修订一律「读不到」，用于验证缺链拒绝。 */
const revisions = (
  entries: Record<string, string>,
  extra: Record<string, Partial<MemoryRevisionFacts>> = {},
): ((revisionId: string) => MemoryRevisionFacts | undefined) => {
  return (revisionId) => {
    const memoryId = entries[revisionId];
    if (!memoryId) return undefined;
    return revisionFacts(memoryId, revisionId, extra[revisionId] ?? {});
  };
};

const reader = (over: Partial<ProvenanceReader> = {}): ProvenanceReader => ({
  runPrompt: () => '收入按回款金额统计，不使用签约金额。',
  runWorkspace: () => 'ws-1',
  runAssistantAnswer: () => ANSWER,
  runDependencies: () => dependencies(),
  checkpointField: (_id, field) => (field === 'feedback' ? '这里应改为不含税口径。' : '续约讨论'),
  checkpointDependencies: () => dependencies(),
  artifactVersion: () => ({
    artifactId: 'a-1',
    contentHash: sha('version'),
    readableText: '结论：收入按回款金额统计。',
  }),
  artifactVersionDependencies: () => dependencies(),
  memoryRevision: revisions({}),
  ...over,
});

const workspace = { workspaceId: 'ws-1' } as const;

const valueOf = (
  resolved: ReturnType<typeof resolveMemorySourceSelector>,
): ResolvedMemorySource => {
  if (!resolved.ok) throw new Error(`解析失败：${resolved.code} ${resolved.message}`);
  return resolved.value;
};

const code = (resolved: ReturnType<typeof resolveMemorySourceSelector>): string => {
  if (resolved.ok) throw new Error('本应拒绝，却解析成功。');
  return resolved.code;
};

describe('resolveMemorySourceSelector', () => {
  it('derives a run-user source from the stored prompt, not from the caller', () => {
    const resolved = valueOf(
      resolveMemorySourceSelector(
        { kind: 'run-user', runId: 'r-1', start: 0, end: 2 },
        reader(),
        workspace,
      ),
    );
    expect(resolved.source).toMatchObject({ kind: 'run-user', excerpt: '收入' });
    expect(resolved.authority).toBe('user-instruction');
    // 用户本人的发言不继承材料依赖。
    expect(resolved.materialDependencies).toEqual([]);
    expect(resolved.memoryDependencies).toEqual([]);
    if (resolved.source.kind !== 'run-user') throw new Error('来源类型不符。');
    expect(resolved.source.promptHash).toBe(promptHashOf('收入按回款金额统计，不使用签约金额。'));
  });

  it('rejects a run-user source whose workspace cannot be traced', () => {
    expect(
      code(
        resolveMemorySourceSelector(
          { kind: 'run-user', runId: 'r-1', start: 0, end: 2 },
          reader({ runWorkspace: () => undefined }),
          workspace,
        ),
      ),
    ).toBe('SOURCE_UNAVAILABLE');
  });

  it('rejects an excerpt range that runs past the real source text', () => {
    expect(
      code(
        resolveMemorySourceSelector(
          { kind: 'run-user', runId: 'r-1', start: 0, end: 9_999 },
          reader(),
          workspace,
        ),
      ),
    ).toBe('SOURCE_MISMATCH');
  });

  it('rejects an excerpt longer than the shared limit before building output', () => {
    const long = '口'.repeat(501);
    expect(
      code(
        resolveMemorySourceSelector(
          { kind: 'run-user', runId: 'r-1', start: 0, end: 501 },
          reader({ runPrompt: () => long }),
          workspace,
        ),
      ),
    ).toBe('SOURCE_MISMATCH');
    const exact = valueOf(
      resolveMemorySourceSelector(
        { kind: 'run-user', runId: 'r-1', start: 0, end: 500 },
        reader({ runPrompt: () => long }),
        workspace,
      ),
    );
    expect([...exact.source.excerpt]).toHaveLength(500);
  });

  it('indexes non-BMP excerpts by code points, not UTF-16 units', () => {
    const text = '分析𠮷祥项目';
    const exact = valueOf(
      resolveMemorySourceSelector(
        { kind: 'run-user', runId: 'r-1', start: 2, end: 4 },
        reader({ runPrompt: () => text }),
        workspace,
      ),
    );
    expect(exact.source.excerpt).toBe('𠮷祥');
  });

  it('rejects anything that is not the final tool-free answer of a completed run', () => {
    expect(
      code(
        resolveMemorySourceSelector(
          { kind: 'run-assistant', runId: 'r-1', eventId: 'e-9', start: 0, end: 3 },
          reader({ runAssistantAnswer: () => undefined }),
          workspace,
        ),
      ),
    ).toBe('SOURCE_UNAVAILABLE');
  });

  it('inherits the run materials and memory dependencies with exact references', () => {
    const exact = valueOf(
      resolveMemorySourceSelector(
        { kind: 'run-assistant', runId: 'r-1', eventId: 'e-7', start: 0, end: 3 },
        reader({
          runDependencies: () =>
            dependencies({
              materials: [material('kr-1'), material('kr-2'), material('kr-1')],
              memories: [memoryDependency('m-9', 'rev-9')],
            }),
          memoryRevision: revisions({ 'rev-9': 'm-9' }),
        }),
        workspace,
      ),
    );
    expect(exact.authority).toBe('derived');
    expect(exact.materialDependencies).toHaveLength(2);
    expect(exact.memoryDependencies).toEqual([memoryDependency('m-9', 'rev-9')]);
    if (exact.source.kind !== 'run-assistant') throw new Error('来源类型不符。');
    expect(exact.source.eventId).toBe('e-7');
    expect(exact.source.contentHash).toBe(sha(ANSWER));
  });

  it('expands transitive memory dependencies and dedupes repeated revisions', () => {
    const exact = valueOf(
      resolveMemorySourceSelector(
        { kind: 'run-assistant', runId: 'r-1', eventId: 'e-7', start: 0, end: 3 },
        reader({
          runDependencies: () =>
            dependencies({
              materials: [],
              memories: [memoryDependency('m-a', 'rev-a'), memoryDependency('m-b', 'rev-b')],
            }),
          memoryRevision: revisions(
            { 'rev-a': 'm-a', 'rev-b': 'm-b' },
            {
              'rev-a': {
                materialDependencies: [material('kr-inherited')],
                memoryDependencies: [memoryDependency('m-b', 'rev-b')],
              },
              'rev-b': { materialDependencies: [material('kr-inherited')] },
            },
          ),
        }),
        workspace,
      ),
    );
    expect(exact.memoryDependencies.map((item) => item.revisionId).sort()).toEqual([
      'rev-a',
      'rev-b',
    ]);
    // 两条依赖指向同一材料：并集去重，不重复计费。
    expect(exact.materialDependencies).toHaveLength(1);
  });

  it('refuses to treat a missing audit record as zero dependencies', () => {
    expect(
      code(
        resolveMemorySourceSelector(
          { kind: 'run-assistant', runId: 'r-1', eventId: 'e-7', start: 0, end: 3 },
          reader({ runDependencies: () => undefined }),
          workspace,
        ),
      ),
    ).toBe('SOURCE_REVIEW_REQUIRED');
  });

  it('accepts a genuinely empty dependency set from a complete snapshot', () => {
    const exact = valueOf(
      resolveMemorySourceSelector(
        { kind: 'run-assistant', runId: 'r-1', eventId: 'e-7', start: 0, end: 3 },
        reader({ runDependencies: () => dependencies({ materials: [], memories: [] }) }),
        workspace,
      ),
    );
    expect(exact.materialDependencies).toEqual([]);
    expect(exact.memoryDependencies).toEqual([]);
  });

  it('rejects a source whose run belongs to another workspace or a global scope', () => {
    expect(
      code(
        resolveMemorySourceSelector(
          { kind: 'run-assistant', runId: 'r-1', eventId: 'e-7', start: 0, end: 3 },
          reader(),
          { workspaceId: 'ws-2' },
        ),
      ),
    ).toBe('SCOPE_MISMATCH');
    expect(
      code(
        resolveMemorySourceSelector(
          { kind: 'run-assistant', runId: 'r-1', eventId: 'e-7', start: 0, end: 3 },
          reader(),
          { workspaceId: undefined },
        ),
      ),
    ).toBe('SCOPE_MISMATCH');
  });

  it('refuses missing, hash-mismatched or no-longer-usable dependencies', () => {
    const base = { kind: 'run-assistant', runId: 'r-1', eventId: 'e-7', start: 0, end: 3 } as const;
    expect(
      code(
        resolveMemorySourceSelector(
          base,
          reader({
            runDependencies: () => dependencies({ memories: [memoryDependency('m-x', 'rev-x')] }),
            memoryRevision: () => undefined,
          }),
          workspace,
        ),
      ),
    ).toBe('SOURCE_REVIEW_REQUIRED');
    expect(
      code(
        resolveMemorySourceSelector(
          base,
          reader({
            runDependencies: () => dependencies({ memories: [memoryDependency('m-x', 'rev-x')] }),
            memoryRevision: () => revisionFacts('m-x', 'rev-x', { contentHash: sha('other') }),
          }),
          workspace,
        ),
      ),
    ).toBe('SOURCE_REVIEW_REQUIRED');
    expect(
      code(
        resolveMemorySourceSelector(
          base,
          reader({
            runDependencies: () => dependencies({ memories: [memoryDependency('m-x', 'rev-x')] }),
            memoryRevision: () => revisionFacts('m-x', 'rev-x', { usable: false }),
          }),
          workspace,
        ),
      ),
    ).toBe('SOURCE_REVIEW_REQUIRED');
  });

  it('rejects a dependency cycle instead of looping forever', () => {
    expect(
      code(
        resolveMemorySourceSelector(
          { kind: 'run-assistant', runId: 'r-1', eventId: 'e-7', start: 0, end: 3 },
          reader({
            runDependencies: () => dependencies({ memories: [memoryDependency('m-a', 'rev-a')] }),
            memoryRevision: (revisionId) =>
              revisionId === 'rev-a'
                ? revisionFacts('m-a', 'rev-a', {
                    memoryDependencies: [memoryDependency('m-b', 'rev-b')],
                  })
                : revisionFacts('m-b', 'rev-b', {
                    memoryDependencies: [memoryDependency('m-a', 'rev-a')],
                  }),
          }),
          workspace,
        ),
      ),
    ).toBe('SOURCE_DEPENDENCY_CYCLE');
  });

  it('rejects exceeding the memory dependency limit rather than truncating', () => {
    const memories = Array.from({ length: 101 }, (_unused, index) =>
      memoryDependency(`m-${index}`, `rev-${index}`),
    );
    expect(
      code(
        resolveMemorySourceSelector(
          { kind: 'run-assistant', runId: 'r-1', eventId: 'e-7', start: 0, end: 3 },
          reader({
            runDependencies: () => dependencies({ memories }),
            memoryRevision: (revisionId) =>
              revisionFacts(revisionId.replace('rev-', 'm-'), revisionId),
          }),
          workspace,
        ),
      ),
    ).toBe('SOURCE_DEPENDENCY_LIMIT');
  });

  /** 契约 §11.1：空区间在 Schema 里是合法形状（只判顺序），下限 1 码点由 Main 把关。 */
  it('rejects an empty excerpt interval', () => {
    expect(
      code(
        resolveMemorySourceSelector(
          { kind: 'run-user', runId: 'r-1', start: 3, end: 3 },
          reader(),
          workspace,
        ),
      ),
    ).toBe('SOURCE_MISMATCH');
  });

  it('rejects exceeding the material dependency limit rather than truncating', () => {
    const materials = Array.from({ length: 201 }, (_unused, index) => material(`kr-${index}`));
    expect(
      code(
        resolveMemorySourceSelector(
          { kind: 'run-assistant', runId: 'r-1', eventId: 'e-7', start: 0, end: 3 },
          reader({ runDependencies: () => dependencies({ materials }) }),
          workspace,
        ),
      ),
    ).toBe('SOURCE_DEPENDENCY_LIMIT');
  });

  it('inherits checkpoint dependencies only when the node can prove them', () => {
    const base = {
      kind: 'checkpoint',
      checkpointId: 'c-1',
      field: 'feedback',
      start: 0,
      end: 4,
    } as const;
    const exact = valueOf(
      resolveMemorySourceSelector(
        base,
        reader({
          checkpointDependencies: () =>
            dependencies({
              materials: [material('kr-node')],
              memories: [memoryDependency('m-c', 'rev-c')],
            }),
          memoryRevision: revisions({ 'rev-c': 'm-c' }),
        }),
        workspace,
      ),
    );
    expect(exact.materialDependencies).toEqual([material('kr-node')]);
    expect(exact.memoryDependencies).toEqual([memoryDependency('m-c', 'rev-c')]);
    expect(
      code(
        resolveMemorySourceSelector(
          base,
          reader({ checkpointDependencies: () => undefined }),
          workspace,
        ),
      ),
    ).toBe('SOURCE_REVIEW_REQUIRED');
  });

  it('inherits artifact version dependencies and refuses a broken chain', () => {
    const base = {
      kind: 'artifact-version',
      artifactVersionId: 'av-2',
      locator: 'v-2#1',
      selectedText: '结论：收入按回款金额统计。',
    } as const;
    const exact = valueOf(
      resolveMemorySourceSelector(
        base,
        reader({
          artifactVersionDependencies: () =>
            dependencies({
              materials: [material('kr-artifact')],
              memories: [memoryDependency('m-a', 'rev-a')],
            }),
          memoryRevision: revisions({ 'rev-a': 'm-a' }),
        }),
        workspace,
      ),
    );
    expect(exact.materialDependencies).toEqual([material('kr-artifact')]);
    expect(exact.memoryDependencies).toEqual([memoryDependency('m-a', 'rev-a')]);
    expect(
      code(
        resolveMemorySourceSelector(
          base,
          reader({ artifactVersionDependencies: () => undefined }),
          workspace,
        ),
      ),
    ).toBe('SOURCE_REVIEW_REQUIRED');
  });
});

describe('provenance builders', () => {
  it('keeps a manual user instruction as the only empty-dependency shape', () => {
    const operationId = '11111111-1111-4111-8111-111111111111';
    const provenance = buildUserInstructionProvenance({
      capturedAt: 1,
      operationId,
      content: '金额按万元保留两位。',
      genericDeclaration: false,
    });
    if (provenance.verification !== 'verified') throw new Error('人工口径应当已核验。');
    expect(provenance.authority).toBe('user-instruction');
    expect(provenance.materialDependencies).toEqual([]);
    expect(provenance.memoryDependencies).toEqual([]);
    expect(manualMemorySource(operationId, '金额按万元保留两位。').start).toBe(0);
  });

  it('carries resolved dependencies into derived provenance', () => {
    const provenance = buildDerivedProvenance({
      capturedAt: 1,
      sources: [
        {
          kind: 'run-assistant',
          runId: 'r-1',
          eventId: 'e-7',
          contentHash: sha(ANSWER),
          excerpt: '已按签约',
          excerptHash: sha('已按签约'),
          start: 0,
          end: 4,
        },
      ],
      materialDependencies: [material('kr-1')],
      memoryDependencies: [memoryDependency('m-9', 'rev-9')],
      originWorkspaceId: 'ws-1',
    });
    if (provenance.verification !== 'verified') throw new Error('派生来源应当已核验。');
    expect(provenance.memoryDependencies).toEqual([memoryDependency('m-9', 'rev-9')]);
    expect(provenance.originWorkspaceId).toBe('ws-1');
  });

  it('keeps legacy rows unverified without inventing dependencies', () => {
    const provenance = buildLegacyProvenance({ sourceType: 'conversation', sourceId: 'm-legacy' });
    expect(provenance.verification).toBe('legacy-unverified');
  });
});
