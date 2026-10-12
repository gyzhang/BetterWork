import { createHash, randomUUID } from 'node:crypto';

import type { MaterialReference, McpToolBinding } from '@betterwork/agent-protocol';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';

import { parseOfficeBytes } from '../infrastructure/office-parser';
import { AppStore } from '../persistence';
import {
  auditMaterialFacts,
  createMaterialFactLedger,
  validateAndRecordBusinessMetricFacts,
} from './material-fact-policy';
import { RunToolResultAdapter } from './run-tool-result-adapter';

const stores: AppStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');

const setup = (
  options: {
    snapshot?: boolean;
    binding?: McpToolBinding;
    explicitBusinessAnalysis?: boolean;
  } = {},
) => {
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
    explicitBusinessAnalysis: options.explicitBusinessAnalysis ?? true,
    materialScope: true,
    selectedMaterialCount: 2,
    prompt: '',
  });
  const markdownWrites = new Map<string, string>();
  const adapter = new RunToolResultAdapter({ store, getMcpBinding: () => options.binding });
  let toolCallCount = 0;
  const apply = (toolName: string | undefined, output: unknown): void =>
    adapter.apply({
      runId,
      taskId,
      toolCallId: `tool-${++toolCallCount}`,
      toolName,
      output,
      materialFacts,
      markdownWrites,
    });
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

const applyParsedOffice = (
  fixture: ReturnType<typeof setup>,
  format: 'pptx' | 'xlsx' | 'csv',
  parsed: Awaited<ReturnType<typeof parseOfficeBytes>>,
): string[] => {
  const sourceIds = parsed.sections.map((_section, index) => `read-office:${index}`);
  fixture.apply('read_office_material', {
    material: { ...fixture.textMaterial, format },
    format,
    sections: parsed.sections.map((section, index) => ({
      ...section,
      sourceId: sourceIds[index],
    })),
    contentHash: 'input-hash',
  });
  return sourceIds;
};

const validateOfficeRevenue = (fixture: ReturnType<typeof setup>, sourceId: string): void => {
  validateAndRecordBusinessMetricFacts(fixture.materialFacts, {
    period: '2026-10',
    current: {
      收入: { value: 100, unit: '万元', period: '2026-10', sourceId },
    },
  });
};

describe('Run tool result adapters', () => {
  it('uses one parsed text result for facts and a matching read footprint', () => {
    const fixture = setup();
    let contentReads = 0;
    fixture.apply('read_text_file', {
      path: '/tmp/c3-fixture/input.md',
      material: fixture.textMaterial,
      sourceId: 'read-text:0',
      contentHash: 'input-hash',
      get content() {
        contentReads += 1;
        return '30元。';
      },
    });
    expect(contentReads).toBe(1);
    expect(fixture.materialFacts.sources.get('read-text:0')).toBe('30元。');
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
    fixture.apply('read_text_file', {
      path: '/tmp/c3-fixture/a/../input.md',
      sourceId: 'read-text:0',
      content: '30元',
    });
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([
      expect.objectContaining({ material: fixture.textMaterial, contentHash: 'input-hash' }),
    ]);
  });

  it.each([
    { sections: [] },
    {
      sections: [
        { locator: 'page:1', content: '30元', sourceId: 'read-text:0' },
        { locator: 'page:2', content: '40元', sourceId: 'read-text:1' },
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
    expect(fixture.materialFacts.sources.has('read-text:0')).toBe(sections.length > 0);
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
      sourceId: 'read-text:0',
      contentHash: 'changed',
      content: '30元',
    });
    fixture.apply('read_text_file', {
      path: '/tmp/c3-fixture/input.md',
      material: { ...fixture.textMaterial, snapshotId: randomUUID() },
      content: '40元',
    });
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([]);
    expect(fixture.materialFacts.materialReadCount).toBe(0);
  });

  it('keeps unscoped legacy text facts without fabricating a read footprint', () => {
    const fixture = setup({ snapshot: false });
    fixture.apply('read_text_file', { path: 'p', content: '30元' });
    expect(auditMaterialFacts(fixture.materialFacts, '30元')).toContain('没有成功读取任何材料');
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
      sourceId: 'read-artifact:0',
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

  it('retains Office cell addresses for facts and hashes the original section', () => {
    const fixture = setup();
    const content = { cells: [{ address: 'A999', locator: 'row:888', value: '30元' }] };
    fixture.apply('read_office_material', {
      material: fixture.textMaterial,
      format: 'csv',
      sections: [{ locator: 'Sheet1', kind: 'cells', content, sourceId: 'read-office:0' }],
      contentHash: 'input-hash',
    });
    const source = fixture.materialFacts.sources.get('read-office:0');
    expect(source).toContain('30元');
    expect(source).not.toContain('999');
    expect(source).not.toContain('888');
    expect(fixture.materialFacts.officeSources.get('read-office:0')).toEqual(
      expect.objectContaining({ locator: 'Sheet1', format: 'csv' }),
    );
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([
      expect.objectContaining({
        operation: 'parse',
        locator: 'Sheet1',
        excerptHash: hash(JSON.stringify(content)),
      }),
    ]);
  });

  it('validates a CSV fact using its explicit headers and one returned data row', async () => {
    const fixture = setup();
    const parsed = await parseOfficeBytes(
      'csv',
      Buffer.from('期间,指标,单位,数值\n2026-10,收入,万元,100\n', 'utf8'),
    );
    const [sourceId] = applyParsedOffice(fixture, 'csv', parsed);
    if (!sourceId) throw new Error('CSV section source missing');

    validateOfficeRevenue(fixture, sourceId);

    expect(fixture.materialFacts.facts).toContainEqual(
      expect.objectContaining({ metric: '收入', value: 100, unit: '万元', periods: ['2026-10'] }),
    );
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([
      expect.objectContaining({ operation: 'parse', locator: 'rows:1-2' }),
    ]);
  });

  it('validates an XLSX fact using a metric and unit in its header and a cached formula value', async () => {
    const fixture = setup();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('经营数据');
    sheet.addRow(['期间', '收入（万元）']);
    sheet.addRow(['2026-10', { formula: '50+50', result: 100 }]);
    const parsed = await parseOfficeBytes('xlsx', Buffer.from(await workbook.xlsx.writeBuffer()));
    const [sourceId] = applyParsedOffice(fixture, 'xlsx', parsed);
    if (!sourceId) throw new Error('XLSX section source missing');

    validateOfficeRevenue(fixture, sourceId);

    expect(fixture.materialFacts.facts).toContainEqual(
      expect.objectContaining({ metric: '收入', value: 100, unit: '万元', periods: ['2026-10'] }),
    );
    expect(fixture.materialFacts.officeSources.get(sourceId)?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: 'A1', valueType: 'text', value: '期间' }),
        expect.objectContaining({
          address: 'B2',
          formula: '50+50',
          valueType: 'formula',
          cachedValueType: 'number',
          value: 100,
        }),
      ]),
    );
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([
      expect.objectContaining({ operation: 'parse', locator: 'sheet:经营数据!A1:B2' }),
    ]);
  });

  it('keeps a budget basis declared in an XLSX metric header', async () => {
    const fixture = setup();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('预算');
    sheet.addRow(['期间', '预算收入（万元）']);
    sheet.addRow(['2026-10', 80]);
    const parsed = await parseOfficeBytes('xlsx', Buffer.from(await workbook.xlsx.writeBuffer()));
    const [sourceId] = applyParsedOffice(fixture, 'xlsx', parsed);
    if (!sourceId) throw new Error('XLSX section source missing');

    validateAndRecordBusinessMetricFacts(fixture.materialFacts, {
      period: '2026-10',
      current: {},
      budget: {
        收入: { value: 80, unit: '万元', period: '2026-10', sourceId },
      },
    });

    expect(fixture.materialFacts.facts).toContainEqual(
      expect.objectContaining({
        metric: '收入',
        value: 80,
        unit: '万元',
        periods: ['2026-10'],
        basis: 'budget',
      }),
    );
  });

  it('matches a date-typed XLSX period at day precision while retaining its source type', async () => {
    const fixture = setup();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('经营数据');
    sheet.addRow(['期间', '收入（万元）']);
    sheet.addRow([new Date(Date.UTC(2026, 9, 1)), 100]);
    const parsed = await parseOfficeBytes('xlsx', Buffer.from(await workbook.xlsx.writeBuffer()));
    const [sourceId] = applyParsedOffice(fixture, 'xlsx', parsed);
    if (!sourceId) throw new Error('XLSX section source missing');

    validateAndRecordBusinessMetricFacts(fixture.materialFacts, {
      period: '2026-10-01',
      current: {
        收入: { value: 100, unit: '万元', period: '2026-10-01', sourceId },
      },
    });

    expect(fixture.materialFacts.officeSources.get(sourceId)?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: 'A2',
          valueType: 'date',
          value: '2026-10-01T00:00:00.000Z',
        }),
      ]),
    );
    expect(fixture.materialFacts.facts).toContainEqual(
      expect.objectContaining({
        metric: '收入',
        value: 100,
        unit: '万元',
        periods: ['2026-10-01'],
      }),
    );
  });

  it('rejects a row basis that conflicts with its XLSX metric header', async () => {
    const fixture = setup();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('预算');
    sheet.addRow(['期间', '预算收入（万元）', '口径']);
    sheet.addRow(['2026-10', 80, '实际']);
    const parsed = await parseOfficeBytes('xlsx', Buffer.from(await workbook.xlsx.writeBuffer()));
    const [sourceId] = applyParsedOffice(fixture, 'xlsx', parsed);
    if (!sourceId) throw new Error('XLSX section source missing');

    expect(() =>
      validateAndRecordBusinessMetricFacts(fixture.materialFacts, {
        period: '2026-10',
        current: {},
        budget: {
          收入: { value: 80, unit: '万元', period: '2026-10', sourceId },
        },
      }),
    ).toThrow('来源未同时提供指标“收入”的数值、单位和期间');
  });

  it('rejects an unrecognized value in an explicit XLSX basis column', async () => {
    const fixture = setup();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('预算');
    sheet.addRow(['期间', '预算收入（万元）', '口径']);
    sheet.addRow(['2026-10', 80, '预测']);
    const parsed = await parseOfficeBytes('xlsx', Buffer.from(await workbook.xlsx.writeBuffer()));
    const [sourceId] = applyParsedOffice(fixture, 'xlsx', parsed);
    if (!sourceId) throw new Error('XLSX section source missing');

    expect(() =>
      validateAndRecordBusinessMetricFacts(fixture.materialFacts, {
        period: '2026-10',
        current: {},
        budget: {
          收入: { value: 80, unit: '万元', period: '2026-10', sourceId },
        },
      }),
    ).toThrow('来源未同时提供指标“收入”的数值、单位和期间');
  });

  it('uses the same PPTX table row for explicitly labeled business fields', async () => {
    const fixture = setup();
    const zip = new JSZip();
    zip.file(
      'ppt/presentation.xml',
      '<p:presentation xmlns:p="urn:p"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    );
    zip.file(
      'ppt/_rels/presentation.xml.rels',
      '<Relationships xmlns="urn:rels"><Relationship Id="rId1" Type="urn:slide" Target="slides/slide1.xml"/></Relationships>',
    );
    zip.file(
      'ppt/slides/slide1.xml',
      '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><a:tbl><a:tr><a:tc><a:t>期间</a:t></a:tc><a:tc><a:t>2026-10</a:t></a:tc><a:tc><a:t>指标</a:t></a:tc><a:tc><a:t>收入</a:t></a:tc><a:tc><a:t>单位</a:t></a:tc><a:tc><a:t>万元</a:t></a:tc><a:tc><a:t>数值</a:t></a:tc><a:tc><a:t>100</a:t></a:tc></a:tr></a:tbl></p:cSld></p:sld>',
    );
    const parsed = await parseOfficeBytes('pptx', await zip.generateAsync({ type: 'nodebuffer' }));
    const tableIndex = parsed.sections.findIndex((section) => section.kind === 'table');
    const sourceIds = applyParsedOffice(fixture, 'pptx', parsed);
    const sourceId = sourceIds[tableIndex];
    if (!sourceId) throw new Error('PPTX table source missing');

    validateOfficeRevenue(fixture, sourceId);

    expect(fixture.materialFacts.facts).toContainEqual(
      expect.objectContaining({ metric: '收入', value: 100, unit: '万元', periods: ['2026-10'] }),
    );
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toContainEqual(
      expect.objectContaining({ operation: 'parse', locator: 'slide:1/table:1' }),
    );
  });

  it('does not assemble PPTX fields across table rows', async () => {
    const fixture = setup();
    const zip = new JSZip();
    zip.file(
      'ppt/slides/slide1.xml',
      '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><a:tbl><a:tr><a:tc><a:t>期间</a:t></a:tc><a:tc><a:t>2026-10</a:t></a:tc><a:tc><a:t>指标</a:t></a:tc><a:tc><a:t>收入</a:t></a:tc><a:tc><a:t>单位</a:t></a:tc><a:tc><a:t>万元</a:t></a:tc></a:tr><a:tr><a:tc><a:t>数值</a:t></a:tc><a:tc><a:t>100</a:t></a:tc></a:tr></a:tbl></p:cSld></p:sld>',
    );
    const parsed = await parseOfficeBytes('pptx', await zip.generateAsync({ type: 'nodebuffer' }));
    const tableIndex = parsed.sections.findIndex((section) => section.kind === 'table');
    const sourceIds = applyParsedOffice(fixture, 'pptx', parsed);
    const sourceId = sourceIds[tableIndex];
    if (!sourceId) throw new Error('PPTX table source missing');

    expect(() => validateOfficeRevenue(fixture, sourceId)).toThrow(
      '来源未同时提供指标“收入”的数值、单位和期间',
    );
  });

  it('does not assemble a CSV fact across separate data rows', async () => {
    const fixture = setup();
    const parsed = await parseOfficeBytes(
      'csv',
      Buffer.from('期间,指标,单位,数值\n2026-10,收入,万元,\n,,,100\n', 'utf8'),
    );
    const [sourceId] = applyParsedOffice(fixture, 'csv', parsed);
    if (!sourceId) throw new Error('CSV section source missing');

    expect(() => validateOfficeRevenue(fixture, sourceId)).toThrow(
      '来源未同时提供指标“收入”的数值、单位和期间',
    );
  });

  it('rejects an XLSX formula without a cached value as a direct fact', async () => {
    const fixture = setup();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('经营数据');
    sheet.addRow(['期间', '收入（万元）']);
    sheet.addRow(['2026-10', { formula: '50+50' }]);
    const parsed = await parseOfficeBytes('xlsx', Buffer.from(await workbook.xlsx.writeBuffer()));
    const [sourceId] = applyParsedOffice(fixture, 'xlsx', parsed);
    if (!sourceId) throw new Error('XLSX section source missing');

    expect(() => validateOfficeRevenue(fixture, sourceId)).toThrow(
      '来源未同时提供指标“收入”的数值、单位和期间',
    );
  });

  it('rejects duplicate semantic CSV headers as ambiguous', async () => {
    const fixture = setup();
    const parsed = await parseOfficeBytes(
      'csv',
      Buffer.from('期间,指标,指标,单位,数值\n2026-10,收入,收入,万元,100\n', 'utf8'),
    );
    const [sourceId] = applyParsedOffice(fixture, 'csv', parsed);
    if (!sourceId) throw new Error('CSV section source missing');

    expect(() => validateOfficeRevenue(fixture, sourceId)).toThrow(
      'Office 来源“收入”的表头或行定位存在歧义',
    );
  });

  it('does not borrow a value from another CSV sourceId', () => {
    const fixture = setup();
    fixture.apply('read_office_material', {
      material: { ...fixture.textMaterial, format: 'csv' },
      format: 'csv',
      sections: [
        {
          locator: 'rows:1-2',
          kind: 'cells',
          content: [
            ['期间', '指标', '单位', '数值'],
            ['2026-10', '收入', '万元', ''],
          ],
          sourceId: 'read-office:partial',
        },
        {
          locator: 'rows:3-4',
          kind: 'cells',
          content: [
            ['期间', '指标', '单位', '数值'],
            ['2026-10', '收入', '万元', '100'],
          ],
          sourceId: 'read-office:complete',
        },
      ],
      contentHash: 'input-hash',
    });

    expect(() => validateOfficeRevenue(fixture, 'read-office:partial')).toThrow(
      '来源未同时提供指标“收入”的数值、单位和期间',
    );
  });

  it('does not borrow a value from another XLSX Sheet', async () => {
    const fixture = setup();
    const workbook = new ExcelJS.Workbook();
    const partial = workbook.addWorksheet('摘要');
    partial.addRow(['期间', '收入（万元）']);
    partial.addRow(['2026-10']);
    const complete = workbook.addWorksheet('明细');
    complete.addRow(['期间', '收入（万元）']);
    complete.addRow(['2026-10', 100]);
    const parsed = await parseOfficeBytes('xlsx', Buffer.from(await workbook.xlsx.writeBuffer()));
    const sourceIds = applyParsedOffice(fixture, 'xlsx', parsed);
    const partialSource = sourceIds[0];
    if (!partialSource) throw new Error('Partial XLSX Sheet source missing');

    expect(() => validateOfficeRevenue(fixture, partialSource)).toThrow(
      '来源未同时提供指标“收入”的数值、单位和期间',
    );
  });

  it('rejects an XLSX range that omits its header row', async () => {
    const fixture = setup();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('经营数据');
    sheet.addRow(['期间', '收入（万元）']);
    sheet.addRow(['2026-10', 100]);
    const parsed = await parseOfficeBytes('xlsx', Buffer.from(await workbook.xlsx.writeBuffer()), {
      structuredLocator: { sheet: '经营数据', range: 'A2:B2' },
    });
    const [sourceId] = applyParsedOffice(fixture, 'xlsx', parsed);
    if (!sourceId) throw new Error('Truncated XLSX section source missing');

    expect(() => validateOfficeRevenue(fixture, sourceId)).toThrow(
      '来源未同时提供指标“收入”的数值、单位和期间',
    );
  });

  it('keeps PPTX text and notes on the existing exact-text fact path', () => {
    const fixture = setup();
    fixture.apply('read_office_material', {
      material: { ...fixture.textMaterial, format: 'pptx' },
      format: 'pptx',
      sections: [
        {
          locator: 'slide:1',
          kind: 'text',
          content: '收入 2026-10：100万元。',
          sourceId: 'read-office:text',
        },
        {
          locator: 'slide:1/notes',
          kind: 'notes',
          content: '收入 2026-10：100万元。',
          sourceId: 'read-office:notes',
        },
      ],
      contentHash: 'input-hash',
    });

    expect(fixture.materialFacts.sources.get('read-office:text')).toBe('收入 2026-10：100万元。');
    expect(fixture.materialFacts.sources.get('read-office:notes')).toBe('收入 2026-10：100万元。');
    expect(fixture.materialFacts.officeSources.has('read-office:text')).toBe(false);
    validateOfficeRevenue(fixture, 'read-office:notes');
    expect(fixture.materialFacts.facts).toContainEqual(
      expect.objectContaining({ metric: '收入', value: 100, unit: '万元', periods: ['2026-10'] }),
    );
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
    fixture.store.evidence.saveLocal({
      taskId: fixture.taskId,
      runId: fixture.runId,
      sourceUri: '/source',
      title: 'source',
      locator: 'l2',
      excerpt: '40元',
      contentHash: 'h2',
    });
    const readEvidenceId = fixture.store.evidence
      .listByTask(fixture.taskId)
      .find((evidence) => evidence.locator === 'l2')?.id;
    if (!readEvidenceId) throw new Error('read evidence fixture missing');
    fixture.apply('read_knowledge', {
      parts: [{ evidenceId: readEvidenceId, text: '40元', hidden: '666元' }],
    });
    fixture.apply('read_knowledge', { parts: [{ evidenceId: readEvidenceId, text: '40元' }] });
    expect(fixture.store.evidence.listByTask(fixture.taskId)).toHaveLength(2);
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([]);
    expect(fixture.materialFacts.sources.get(evidenceId)).toBe('30元');
    expect(fixture.materialFacts.sources.get(readEvidenceId)).toBe('40元');
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
    const fixture = setup({ explicitBusinessAnalysis: false });
    fixture.apply('task_write_file', { path: 'report.MD', contentHash: 'h1' });
    fixture.apply('task_write_file', { path: 'image.svg', contentHash: 'h2' });
    fixture.apply('task_write_file', { path: 'report.MD', contentHash: 'h3' });
    expect([...fixture.markdownWrites]).toEqual([['report.MD', 'h3']]);
    fixture.apply('analyze_business_metrics', {
      period: '本期',
      metrics: [{ metric: '收入', current: 30, warnings: [] }],
      message: '完成',
    });
    expect(fixture.materialFacts.facts).toHaveLength(0);
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
    expect(fixture.materialFacts.sources.size).toBe(0);
    expect(fixture.materialFacts.facts).toHaveLength(0);
    expect(fixture.materialFacts.materialReadCount).toBe(0);
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([]);
    expect(fixture.store.evidence.listByTask(fixture.taskId)).toEqual([]);
    expect(fixture.markdownWrites.size).toBe(0);
  });
});
