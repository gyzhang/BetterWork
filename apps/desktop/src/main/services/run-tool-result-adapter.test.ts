import { createHash, randomUUID } from 'node:crypto';

import type { MaterialReference, McpToolBinding } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { auditMaterialFacts, createMaterialFactLedger } from './material-fact-policy';
import { RunToolResultAdapter } from './run-tool-result-adapter';

const stores: AppStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');

const setup = (options: { snapshot?: boolean; binding?: McpToolBinding } = {}) => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  const workspace = store.workspaces.getOrCreate('/tmp/c3-fixture', 'C3');
  const created = store.tasks.create(workspace.id, 'C3', 'result adapters');
  const taskId = created.task.id;
  const runId = randomUUID();
  store.runs.create({
    id: runId,
    taskId,
    sessionId: created.sessionId,
    prompt: 'input',
    status: 'running',
    createdAt: 1,
  });
  const input = store.inputSnapshots.createPreparing({
    workspaceId: workspace.id,
    sourcePath: '/tmp/c3-fixture/input.md',
    contentHash: 'input-hash',
    byteSize: 10,
    format: 'md',
    fileKey: 'input.md',
    createdAt: 1,
  });
  store.inputSnapshots.markReady(input.id, 1);
  const textMaterial: MaterialReference = {
    kind: 'workspace-input-snapshot',
    workspaceId: workspace.id,
    snapshotId: input.id,
    contentHash: input.contentHash,
    format: input.format,
    fileKey: input.fileKey,
  };
  const artifact = store.artifacts.saveMarkdown({
    taskId,
    origin: 'user-edit',
    title: 'input',
    content: '30元',
  });
  const detail = store.artifacts.getVersionDetail(artifact.currentVersionId);
  if (!detail || detail.type !== 'markdown') throw new Error('fixture Artifact must be Markdown');
  const artifactMaterial: MaterialReference = {
    kind: 'artifact-version',
    originWorkspaceId: workspace.id,
    artifactId: artifact.id,
    artifactVersionId: artifact.currentVersionId,
    contentHash: detail.contentHash,
  };
  if (options.snapshot !== false) {
    store.runContextSnapshots.create({
      runId,
      taskId,
      workspaceId: workspace.id,
      contextSegmentId: 'segment',
      materials: [textMaterial, artifactMaterial].map((reference) => ({
        reference,
        purpose: 'current-input',
        addedFrom: 'workspace-candidate',
      })),
      createdAt: 1,
    });
  }
  const materialFacts = createMaterialFactLedger({
    materialScope: true,
    selectedMaterialCount: 2,
    prompt: '',
  });
  const markdownWrites = new Map<string, string>();
  const adapter = new RunToolResultAdapter({ store, getMcpBinding: () => options.binding });
  const apply = (toolName: string | undefined, output: unknown): void =>
    adapter.apply({ runId, taskId, toolName, output, materialFacts, markdownWrites });
  return {
    store,
    runId,
    taskId,
    textMaterial,
    artifactMaterial,
    materialFacts,
    markdownWrites,
    apply,
  };
};

describe('Run tool result adapters', () => {
  it('uses one parsed text result for facts and a matching read footprint', () => {
    const fixture = setup();
    let contentReads = 0;
    fixture.apply('read_text_file', {
      path: '/tmp/c3-fixture/input.md',
      material: fixture.textMaterial,
      contentHash: 'input-hash',
      get content() {
        contentReads += 1;
        return '30元。';
      },
    });
    expect(contentReads).toBe(1);
    expect(auditMaterialFacts(fixture.materialFacts, '30元。')).toBeUndefined();
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([
      expect.objectContaining({
        material: fixture.textMaterial,
        operation: 'read',
        locator: '/tmp/c3-fixture/input.md',
        excerptHash: hash('30元。'),
      }),
    ]);
  });

  it('retains normalized source-path fallback when text has no exact material', () => {
    const fixture = setup();
    fixture.apply('read_text_file', { path: '/tmp/c3-fixture/a/../input.md', content: '30元' });
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([
      expect.objectContaining({ material: fixture.textMaterial, contentHash: 'input-hash' }),
    ]);
  });

  it.each([
    { sections: [] },
    {
      sections: [
        { locator: 'page:1', content: '30元' },
        { locator: 'page:2', content: '40元' },
      ],
    },
  ])('preserves text parse locators and returned sections %j', ({ sections }) => {
    const fixture = setup();
    fixture.apply('read_text_file', {
      path: 'irrelevant',
      material: fixture.textMaterial,
      contentHash: 'input-hash',
      content: '未返回999元',
      sections,
    });
    const reads = fixture.store.materialReads.listByRun(fixture.runId);
    expect(reads.map((read) => [read.operation, read.locator, read.excerptHash])).toEqual(
      sections.length === 0
        ? [['parse', 'document', hash('')]]
        : sections.map((section) => ['parse', section.locator, hash(section.content)]),
    );
    expect(auditMaterialFacts(fixture.materialFacts, '999元')).toContain('数字（999）');
  });

  it('does not add facts or reads for run work files', () => {
    const fixture = setup();
    fixture.apply('read_text_file', {
      path: 'work/report.md',
      content: '30元',
      scope: 'run-work-file',
    });
    expect(fixture.materialFacts.materialReadCount).toBe(0);
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([]);
  });

  it('retains text hash and material matching restrictions', () => {
    const fixture = setup();
    fixture.apply('read_text_file', {
      path: 'p',
      material: fixture.textMaterial,
      contentHash: 'changed',
      content: '30元',
    });
    fixture.apply('read_text_file', {
      path: '/tmp/c3-fixture/input.md',
      material: { ...fixture.textMaterial, snapshotId: randomUUID() },
      content: '40元',
    });
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([]);
    expect(fixture.materialFacts.materialReadCount).toBe(2);
  });

  it('keeps unscoped legacy text facts without fabricating a read footprint', () => {
    const fixture = setup({ snapshot: false });
    fixture.apply('read_text_file', { path: 'p', content: '30元' });
    expect(auditMaterialFacts(fixture.materialFacts, '30元')).toBeUndefined();
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([]);
  });

  it('matches Artifact ID, version and hash together', () => {
    const fixture = setup();
    const material = fixture.artifactMaterial;
    if (material.kind !== 'artifact-version') throw new Error('fixture kind');
    const output = {
      artifactId: material.artifactId,
      versionId: material.artifactVersionId,
      contentHash: material.contentHash,
      content: '30元',
    };
    fixture.apply('read_artifact', { ...output, artifactId: 'other' });
    fixture.apply('read_artifact', { ...output, versionId: 'other' });
    fixture.apply('read_artifact', { ...output, contentHash: 'other' });
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([]);
    fixture.apply('read_artifact', output);
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([
      expect.objectContaining({
        material,
        operation: 'read',
        locator: `artifact-version:${material.artifactVersionId}`,
        excerptHash: hash('30元'),
      }),
    ]);
  });

  it('keeps Office cell/address metadata out of the fact pool and hashes the original section', () => {
    const fixture = setup();
    const content = { cells: [{ address: 'A999', locator: 'row:888', value: '30元' }] };
    fixture.apply('read_office_material', {
      material: fixture.textMaterial,
      format: 'csv',
      sections: [{ locator: 'Sheet1', content }],
      contentHash: 'input-hash',
    });
    expect(auditMaterialFacts(fixture.materialFacts, '30元')).toBeUndefined();
    expect(fixture.materialFacts.rawNumbers.has(999)).toBe(false);
    expect(fixture.materialFacts.rawNumbers.has(888)).toBe(false);
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([
      expect.objectContaining({
        operation: 'parse',
        locator: 'Sheet1',
        excerptHash: hash(JSON.stringify(content)),
      }),
    ]);
  });

  it('retains an empty Office parse footprint', () => {
    const fixture = setup();
    fixture.apply('read_office_material', {
      material: fixture.textMaterial,
      format: 'csv',
      sections: [],
      contentHash: 'input-hash',
    });
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([
      expect.objectContaining({
        operation: 'parse',
        locator: 'document',
        excerptHash: hash('Office 材料未产生可读取片段。'),
      }),
    ]);
  });

  it('reuses audited Knowledge evidence and only records returned text as facts', () => {
    const fixture = setup();
    fixture.store.evidence.saveLocal({
      taskId: fixture.taskId,
      runId: fixture.runId,
      sourceUri: '/source',
      title: 'source',
      locator: 'l',
      excerpt: '30元',
      contentHash: 'h',
    });
    const evidenceId = fixture.store.evidence.listByTask(fixture.taskId)[0]!.id;
    fixture.apply('knowledge_search', {
      results: [
        {
          title: '999元',
          sourcePath: '/888',
          locator: '777',
          excerpt: '30元',
          contentHash: 'h',
          evidenceId,
        },
      ],
    });
    fixture.apply('read_knowledge', { parts: [{ evidenceId, text: '40元', hidden: '666元' }] });
    fixture.apply('read_knowledge', { parts: [{ evidenceId, text: '40元' }] });
    expect(fixture.store.evidence.listByTask(fixture.taskId)).toHaveLength(1);
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([]);
    expect(auditMaterialFacts(fixture.materialFacts, '30元；40元')).toBeUndefined();
    expect(fixture.materialFacts.rawNumbers.has(999)).toBe(false);
    expect(fixture.materialFacts.rawNumbers.has(666)).toBe(false);
  });

  it('rejects a Knowledge evidence ID from another Run', () => {
    const fixture = setup();
    const otherRunId = randomUUID();
    const run = fixture.store.runs.list()[0]!;
    fixture.store.runs.create({
      id: otherRunId,
      taskId: fixture.taskId,
      sessionId: run.sessionId,
      prompt: 'other',
      status: 'running',
      createdAt: 1,
    });
    fixture.store.evidence.saveLocal({
      taskId: fixture.taskId,
      runId: otherRunId,
      sourceUri: '/source',
      title: 'source',
      locator: 'l',
      excerpt: '30元',
      contentHash: 'h',
    });
    const evidenceId = fixture.store.evidence.listByTask(fixture.taskId)[0]!.id;
    expect(() =>
      fixture.apply('read_knowledge', { parts: [{ evidenceId, text: '30元' }] }),
    ).toThrow('Knowledge evidence does not belong to this run');
    expect(fixture.store.evidence.listByTask(fixture.taskId)).toHaveLength(1);
  });

  it('retains web search and fetch locators, excerpts and their distinct hash inputs', () => {
    const fixture = setup();
    fixture.apply('web_search', {
      results: [
        { title: 't', url: '', snippet: 'skip' },
        { title: 't', url: 'https://example.test/search', snippet: '30元', site: '' },
      ],
    });
    const content = '正文'.repeat(1_200);
    fixture.apply('web_fetch', {
      url: 'https://example.test/page',
      title: 't',
      content,
      contentType: 'text/html',
      status: 200,
    });
    expect(fixture.store.evidence.listByTask(fixture.taskId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUri: 'https://example.test/search',
          locator: '网页',
          excerpt: '30元',
          contentHash: hash('https://example.test/search\n30元'),
        }),
        expect.objectContaining({
          sourceUri: 'https://example.test/page',
          locator: 'text/html · HTTP 200',
          excerpt: content.slice(0, 2_000),
          contentHash: hash(`https://example.test/page\n${content}`),
        }),
      ]),
    );
    expect(fixture.materialFacts.materialReadCount).toBe(0);
  });

  it.each([{}, { connectionRevisionId: 'revision', contractHash: 'a'.repeat(64) }])(
    'retains MCP binding provenance and excerpt hashing %j',
    (revision) => {
      const fixture = setup({
        binding: { connectionId: 'connection', toolId: 'tool', ...revision },
      });
      const output = { result: '30元'.repeat(1_000) };
      const excerpt = JSON.stringify(output).slice(0, 2_000);
      fixture.apply('mcp_tool', output);
      expect(fixture.store.evidence.listByTask(fixture.taskId)).toEqual([
        expect.objectContaining({
          sourceType: 'mcp-tool',
          sourceUri: 'mcp:connection/tool',
          excerpt,
          locator: `MCP 工具结果；配置修订 ${revision.connectionRevisionId ?? 'legacy'}；合同 ${revision.contractHash ?? 'legacy'}`,
          contentHash: hash(`mcp:connection/tool\n${excerpt}`),
        }),
      ]);
      expect(fixture.materialFacts.materialReadCount).toBe(0);
    },
  );

  it('ignores unbound MCP results and follows the existing serialization fallback', () => {
    const unbound = setup();
    unbound.apply('mcp_unknown', { result: '30元' });
    expect(unbound.store.evidence.listByTask(unbound.taskId)).toEqual([]);
    const bound = setup({ binding: { connectionId: 'c', toolId: 't' } });
    bound.apply('mcp_t', 'raw result');
    expect(bound.store.evidence.listByTask(bound.taskId)[0]?.excerpt).toBe('raw result');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    bound.apply('mcp_t', circular);
    expect(bound.store.evidence.listByTask(bound.taskId)[0]?.excerpt).toBe('raw result');
    const fallback = setup({ binding: { connectionId: 'c', toolId: 'circular' } });
    fallback.apply('mcp_circular', circular);
    expect(fallback.store.evidence.listByTask(fallback.taskId)[0]?.excerpt).toContain(
      'MCP 工具结果无法序列化',
    );
  });

  it('tracks only Markdown writes and keeps deterministic calculations distinct from material reads', () => {
    const fixture = setup();
    fixture.apply('task_write_file', { path: 'report.MD', contentHash: 'h1' });
    fixture.apply('task_write_file', { path: 'image.svg', contentHash: 'h2' });
    fixture.apply('task_write_file', { path: 'report.MD', contentHash: 'h3' });
    expect([...fixture.markdownWrites]).toEqual([['report.MD', 'h3']]);
    fixture.apply('analyze_business_metrics', {
      period: '本期',
      metrics: [{ metric: '收入', current: 30, warnings: [] }],
      message: '完成',
    });
    expect(fixture.materialFacts.rawNumbers.has(30)).toBe(true);
    expect(fixture.materialFacts.materialReadCount).toBe(0);
  });

  it.each([
    'read_text_file',
    'read_office_material',
    'web_search',
    'task_write_file',
    'analyze_business_metrics',
    'unknown',
  ])('adds no facts, footprints, evidence or writes for a malformed %s result', (toolName) => {
    const fixture = setup();
    expect(() => fixture.apply(toolName, { content: '敏感正文30元' })).toThrow('工具结果契约错误');
    expect(fixture.materialFacts.rawNumbers.size).toBe(0);
    expect(fixture.materialFacts.materialReadCount).toBe(0);
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([]);
    expect(fixture.store.evidence.listByTask(fixture.taskId)).toEqual([]);
    expect(fixture.markdownWrites.size).toBe(0);
  });
});
