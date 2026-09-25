import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';

import { KnowledgeServiceError } from './knowledge-errors';
import { KnowledgeVault } from './knowledge-vault';

const temporaryDirectories: string[] = [];
const temporaryDirectory = (): string => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-vault-'));
  temporaryDirectories.push(directory);
  return directory;
};
afterEach(() =>
  temporaryDirectories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true })),
);

const makePdf = (text: string): Buffer => {
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${text.replace(/[()\\]/gu, '\\$&')}) Tj\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'binary');
};

const makeDocx = async (paragraphs: string[]): Promise<Buffer> => {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip
    .folder('_rels')!
    .file(
      '.rels',
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
  const body = paragraphs
    .map((paragraph) => `<w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p>`)
    .join('');
  zip
    .folder('word')!
    .file(
      'document.xml',
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    );
  return zip.generateAsync({ type: 'nodebuffer' });
};

describe('KnowledgeVault', () => {
  it('imports Word paragraphs with stable locators', async () => {
    const directory = temporaryDirectory();
    const document = path.join(directory, '客户方案.docx');
    writeFileSync(
      document,
      await makeDocx(['客户续约风险需要在复盘中跟进', '第二段作为独立来源定位']),
    );
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const result = await vault.importPaths([document]);
    expect(result).toMatchObject({
      imported: [{ title: '客户方案', format: 'docx' }],
      skipped: [],
    });
    expect(vault.search('续约风险')[0]).toMatchObject({
      document: { title: '客户方案', format: 'docx' },
      locator: '段落 1',
      excerpt: expect.stringContaining('续约风险'),
    });
    vault.close();
    // mammoth 首次动态导入需要现场转换，冷缓存下会超过默认的 5 秒
  }, 30_000);

  it('注入的提取器接管解析并收到条目级作业上下文（KM07b）', async () => {
    const directory = temporaryDirectory();
    const document = path.join(directory, '注入提取.md');
    const content = '# 原件\n\n原件文本。';
    writeFileSync(document, content);
    const calls: Array<{ format: string; bytes: number; jobId: string | undefined }> = [];
    const vault = new KnowledgeVault(path.join(directory, 'vault-worker.sqlite'), {
      async extractor(format, bytes, context) {
        calls.push({ format, bytes: bytes.length, jobId: context?.jobId });
        return {
          format,
          content: '由 Worker 返回的提取文本。',
          sections: [{ locator: '全文', ordinal: 0, content: '由 Worker 返回的提取文本。' }],
        };
      },
    });
    const published = await vault.importSource(document, { jobId: 'job-77', attempt: 3 });
    expect(calls).toEqual([
      { format: 'markdown', bytes: Buffer.byteLength(content), jobId: 'job-77' },
    ]);
    expect(vault.search('Worker')[0]).toMatchObject({
      document: { title: '注入提取' },
    });
    expect(published.textHash).toBeTruthy();
    // 不传上下文（如旧调用路径）时照常工作，Worker 端落到独立作业。
    await vault.importSource(document);
    expect(calls[1]?.jobId).toBeUndefined();
    vault.close();
  });

  it('imports PDF pages as independently locatable search results', async () => {
    const directory = temporaryDirectory();
    const pdf = path.join(directory, '市场报告.pdf');
    writeFileSync(pdf, makePdf('Market outlook: retention risk requires action'));
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const result = await vault.importPaths([pdf]);
    expect(result).toMatchObject({
      imported: [{ title: '市场报告', format: 'pdf', pageCount: 1 }],
      skipped: [],
    });
    expect(vault.search('retention risk')[0]).toMatchObject({
      document: { title: '市场报告', format: 'pdf' },
      locator: '第 1 页',
      excerpt: expect.stringContaining('retention risk'),
    });
    vault.close();
    // pdf-parse 首次动态导入需要现场转换，冷缓存下会超过默认的 5 秒
  }, 30_000);

  it('imports local markdown and text, then searches their contents', async () => {
    const directory = temporaryDirectory();
    const markdown = path.join(directory, '市场笔记.md');
    const text = path.join(directory, '客户访谈.txt');
    writeFileSync(markdown, '# 增长策略\n华东市场需要关注渠道转化。');
    writeFileSync(text, '客户希望在季度复盘中看到续约风险。');
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    expect((await vault.importPaths([markdown, text])).skipped).toEqual([]);
    expect(vault.listDocuments().map((document) => document.title)).toEqual([
      '客户访谈',
      '市场笔记',
    ]);
    expect(vault.search('渠道转化')[0]).toMatchObject({
      document: { title: '市场笔记', format: 'markdown' },
      excerpt: expect.stringContaining('渠道转化'),
    });
    expect(vault.getRegisteredSourcePath(markdown)).toBe(markdown);
    expect(vault.getRegisteredSourcePath(path.join(directory, '未导入.txt'))).toBeUndefined();
    vault.close();
  });

  it('updates an imported source and reports unsupported files', async () => {
    const directory = temporaryDirectory();
    const text = path.join(directory, '计划.txt');
    const pdf = path.join(directory, '材料.pdf');
    writeFileSync(text, '第一版计划');
    writeFileSync(pdf, 'not a PDF');
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const first = (await vault.importPaths([text])).imported[0]!;
    writeFileSync(text, '第二版计划，包含新的方向。');
    const result = await vault.importPaths([text, pdf]);
    expect(result.imported[0]).toMatchObject({
      id: first.id,
      contentHash: expect.not.stringMatching(first.contentHash),
    });
    expect(result.skipped[0]?.sourcePath).toBe(pdf);
    expect(result.skipped[0]?.reason).toMatch(/^导入失败：/u);
    expect(vault.search('新的方向')[0]?.document.id).toBe(first.id);
    expect(vault.listRevisions(first.id)).toHaveLength(2);
    expect(vault.getRevision(vault.listRevisions(first.id)[1]!.id)).toMatchObject({
      documentId: first.id,
      content: '第一版计划',
      chunks: [{ locator: '全文', content: '第一版计划' }],
    });
    vault.close();
  });

  it('keeps one immutable revision when the same content is imported again', async () => {
    const directory = temporaryDirectory();
    const text = path.join(directory, '稳定资料.txt');
    writeFileSync(text, '相同内容不应重复创建修订。');
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const first = (await vault.importPaths([text])).imported[0]!;
    await vault.importPaths([text]);
    expect(vault.listRevisions(first.id)).toHaveLength(1);
    expect(vault.getRevision(vault.listRevisions(first.id)[0]!.id)?.content).toBe(
      '相同内容不应重复创建修订。',
    );
    vault.close();
  });

  it('removes only the local index record and its search chunks', async () => {
    const directory = temporaryDirectory();
    const text = path.join(directory, '可移除资料.txt');
    writeFileSync(text, '需要从本地索引中移除的内容。');
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const document = (await vault.importPaths([text])).imported[0]!;
    expect(vault.removeDocument(document.id)).toBe(true);
    expect(vault.listDocuments()).toEqual([]);
    expect(vault.search('移除')).toEqual([]);
    expect(vault.removeDocument(document.id)).toBe(false);
    expect(existsSync(text)).toBe(true);
    vault.close();
  });

  it('refreshes a registered document from its original source path', async () => {
    const directory = temporaryDirectory();
    const text = path.join(directory, '动态资料.txt');
    writeFileSync(text, '第一版内容。');
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const original = (await vault.importPaths([text])).imported[0]!;
    writeFileSync(text, '第二版内容，包含新的市场信号。');
    const refreshed = await vault.refreshDocument(original.id);
    expect(refreshed.refreshed).toMatchObject({
      id: original.id,
      contentHash: expect.not.stringMatching(original.contentHash),
    });
    expect(vault.search('市场信号')[0]?.document.id).toBe(original.id);
    expect(await vault.refreshDocument('missing-document')).toEqual({
      error: '资料已不在当前资料库中。',
    });
    vault.close();
  });

  it('falls back to substring search when full-text match finds nothing', async () => {
    const directory = temporaryDirectory();
    const markdown = path.join(directory, '增长笔记.md');
    writeFileSync(markdown, '# 渠道复盘\nBetterWork 的转化率在三月显著提升。');
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    await vault.importPaths([markdown]);
    expect(vault.search('etterWork')[0]).toMatchObject({
      document: { title: '增长笔记' },
      excerpt: expect.stringContaining('BetterWork'),
    });
    expect(vault.search('完全不存在的词组xyz')).toEqual([]);
    vault.close();
  });

  it('keeps the index unchanged when the original file is missing during refresh', async () => {
    const directory = temporaryDirectory();
    const text = path.join(directory, '会消失的资料.txt');
    writeFileSync(text, '待刷新的原始内容。');
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const original = (await vault.importPaths([text])).imported[0]!;
    rmSync(text);
    const refreshed = await vault.refreshDocument(original.id);
    expect(refreshed.refreshed).toBeUndefined();
    expect(refreshed.error).toMatch(/原始文件/u);
    expect(vault.listDocuments()).toHaveLength(1);
    expect(vault.search('待刷新的原始内容')[0]?.document.id).toBe(original.id);
    vault.close();
  });

  it('KM01 exposes fixed revision identity on list and search from one snapshot', async () => {
    const directory = temporaryDirectory();
    const text = path.join(directory, '版本资料.txt');
    writeFileSync(text, '第一版：渠道转化。');
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const first = (await vault.importPaths([text])).imported[0]!;
    const firstRevision = vault.listDocuments().find((item) => item.id === first.id);
    expect(firstRevision?.currentRevisionId).toBeDefined();
    expect(vault.search('渠道转化')[0]).toMatchObject({
      document: { currentRevisionId: firstRevision?.currentRevisionId },
      reference: {
        kind: 'knowledge-revision',
        knowledgeDocumentId: first.id,
        knowledgeRevisionId: firstRevision?.currentRevisionId,
        contentHash: firstRevision?.contentHash,
        sourcePath: text,
      },
      textHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });

    // 刷新产生新修订后，列表与搜索身份一起前进，不留下 latest 补出来的旧引用
    writeFileSync(text, '第二版：渠道转化与续约风险。');
    await vault.importPaths([text]);
    const revisions = vault.listRevisions(first.id);
    expect(revisions.map((revision) => revision.revision)).toEqual([2, 1]);
    const current = vault.listDocuments().find((item) => item.id === first.id);
    expect(current?.currentRevisionId).toBe(revisions[0]?.id);
    expect(current?.contentHash).toBe(revisions[0]?.contentHash);
    const hits = vault.search('续约风险');
    expect(hits[0]?.reference.knowledgeRevisionId).toBe(revisions[0]?.id);
    expect(hits[0]?.textHash).toBe(revisions[0]?.textHash);
    vault.close();
  });

  it('KM01 re-import is idempotent while history stays readable after removal', async () => {
    const directory = temporaryDirectory();
    const text = path.join(directory, '历史资料.txt');
    writeFileSync(text, '旧版本的市场信号。');
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const document = (await vault.importPaths([text])).imported[0]!;
    await vault.importPaths([text]);
    expect(vault.listRevisions(document.id)).toHaveLength(1);

    writeFileSync(text, '新版本的市场信号与续约风险。');
    await vault.importPaths([text]);
    const revisions = vault.listRevisions(document.id);
    expect(revisions).toHaveLength(2);
    const oldRevisionId = revisions[1]?.id;
    expect(oldRevisionId).toBeDefined();
    // 历史修订仍可读，正文不漂移
    expect(vault.getRevision(oldRevisionId!)?.content).toContain('旧版本的市场信号');
    const page = vault.previewRevision(document.id, oldRevisionId!);
    expect(page.parts.map((part) => part.text).join('')).toBe('旧版本的市场信号。');
    expect(page.complete).toBe(true);

    // 移除当前登记不删除留存修订；重新导入是新登记，不改写历史
    vault.removeDocument(document.id);
    expect(vault.getRevision(oldRevisionId!)?.title).toBeDefined();
    writeFileSync(text, '第三次导入的内容。');
    const reimported = (await vault.importPaths([text])).imported[0]!;
    expect(reimported.id).not.toBe(document.id);
    expect(vault.listRevisions(reimported.id)).toHaveLength(1);
    expect(vault.getRevision(oldRevisionId!)?.content).toContain('旧版本的市场信号');
    vault.close();
  });

  it('KM01 refuses nondeterministic re-parse and mismatched preview identity', async () => {
    const directory = temporaryDirectory();
    const vaultFile = path.join(directory, 'vault.sqlite');
    const text = path.join(directory, '解析稳定性.txt');
    writeFileSync(text, '稳定的提取文本。');
    const vault = new KnowledgeVault(vaultFile);
    const document = (await vault.importPaths([text])).imported[0]!;
    vault.close();

    // 模拟解析器回归：同解析身份的已存修订带着不同的提取文本哈希
    const raw = new Database(vaultFile);
    raw.prepare('UPDATE knowledge_revisions SET text_hash = ?').run('deadbeef');
    raw.close();
    const reopened = new KnowledgeVault(vaultFile);
    const outcome = await reopened.importPaths([text]);
    expect(outcome.imported).toHaveLength(0);
    expect(outcome.skipped[0]?.reason).toMatch(/解析/u);
    // 失败回滚后旧修订与哈希未被覆盖
    expect(reopened.listRevisions(document.id)[0]?.textHash).toBe('deadbeef');
    expect(() => reopened.previewRevision('other-document', document.id)).toThrowError(
      KnowledgeServiceError,
    );
    reopened.close();
  });
});

describe('来源检查与摘要投影（KM10，契约 §10.1/§10.2）', () => {
  it('导入即得出「一致」结论；原件变化与缺失按结论持久而不是作业失败', async () => {
    const directory = temporaryDirectory();
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const file = path.join(directory, '原件.md');
    writeFileSync(file, '原件内容。');
    const imported = await vault.importSource(file);
    expect(imported.document.sourceStatus).toBe('unchanged');
    expect(imported.document.sourceCheckedAt).toBeTypeOf('number');
    expect(imported.document.lexicalState).toBe('ready');
    expect(imported.document.semanticState).toBe('disabled');

    expect(await vault.checkSource(imported.document.id)).toMatchObject({ status: 'unchanged' });
    writeFileSync(file, '改写后的原件。');
    expect((await vault.checkSource(imported.document.id)).status).toBe('changed');
    expect(
      vault.listDocuments().find((document) => document.id === imported.document.id)?.sourceStatus,
    ).toBe('changed');

    rmSync(file);
    expect((await vault.checkSource(imported.document.id)).status).toBe('missing');
    const listed = vault.listDocuments().find((document) => document.id === imported.document.id);
    expect(listed?.sourceStatus).toBe('missing');
    // 原件缺失后保存文本仍可读：详情预览不依赖原件存在
    const page = vault.previewRevision(imported.document.id, imported.revisionId);
    expect(page.parts.length).toBeGreaterThan(0);
    vault.close();
  });

  it('语义状态由设置与代次派生：启用无代次为待建，发布后就绪，退役旧空间即过期', async () => {
    const directory = temporaryDirectory();
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const file = path.join(directory, '语义.md');
    writeFileSync(file, '语义状态内容。');
    const imported = await vault.importSource(file);
    const fingerprint = 'a'.repeat(64);
    vault.index.saveSettings({
      expectedRevision: vault.index.settings().revision,
      semanticEnabled: true,
    });
    const stateOf = (): string =>
      vault.listDocuments().find((document) => document.id === imported.document.id)
        ?.semanticState ?? 'missing';
    expect(stateOf()).toBe('pending');

    const index = vault.index;
    const chunks = index.retrievalChunks(imported.revisionId);
    const space = index.ensureCurrentSpace(fingerprint);
    index.lockDimension(space.id, 3);
    const generation = index.createStagingGeneration({
      revisionId: imported.revisionId,
      textHash: chunks[0]?.textHash ?? '',
      spaceId: space.id,
      modelSnapshot: { modelFingerprint: fingerprint },
      chunkingVersion: chunks[0]?.chunkingVersion ?? '',
      chunkCount: chunks.length,
    });
    index.addStagingVectors(
      generation.id,
      chunks.map((chunk) => ({
        chunkId: chunk.id,
        chunkHash: chunk.contentHash,
        vector: Float32Array.from([1, 0, 0]),
      })),
    );
    index.publishGeneration({
      generationId: generation.id,
      expect: {
        revisionId: imported.revisionId,
        textHash: chunks[0]?.textHash ?? '',
        spaceId: space.id,
        modelFingerprint: fingerprint,
        dimension: 3,
        chunkingVersion: chunks[0]?.chunkingVersion ?? '',
        registeredRevisionId: vault.registeredRevisionId(imported.document.id) ?? '',
      },
    });
    expect(stateOf()).toBe('ready');

    index.resetCurrentSpace(fingerprint);
    expect(stateOf()).toBe('stale');
    vault.close();
  });
});

describe('单层集合与成员（KM11，契约 §10.1）', () => {
  const importDoc = async (vault: KnowledgeVault, directory: string, name: string) => {
    const file = path.join(directory, name);
    writeFileSync(file, `${name} 的内容。`);
    return vault.importSource(file);
  };

  it('集合名规范化唯一：全角/大小写/首尾空格都算重名，改名 CAS 拒绝并发改动', async () => {
    const directory = temporaryDirectory();
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const created = vault.saveCollection({ mode: 'create', name: '  季度报告Ａ  ' });
    expect(created).toHaveLength(1);
    expect(created[0]?.name).toBe('季度报告Ａ');
    expect(created[0]?.revision).toBe(1);

    expect(() => vault.saveCollection({ mode: 'create', name: '季度报告a' })).toThrowError(
      KnowledgeServiceError,
    );
    expect(() => vault.saveCollection({ mode: 'create', name: '季度报告a' })).toThrowError(
      /已有同名集合/,
    );

    const collectionId = created[0]?.id ?? '';
    expect(() =>
      vault.saveCollection({
        mode: 'rename',
        id: collectionId,
        name: '新名字',
        expectedRevision: 99,
      }),
    ).toThrowError(/集合不存在或已被其他操作更新/);
    const renamed = vault.saveCollection({
      mode: 'rename',
      id: collectionId,
      name: ' 新名字 ',
      expectedRevision: 1,
    });
    expect(renamed[0]).toMatchObject({ name: '新名字', revision: 2 });
    vault.close();
  });

  it('成员 replace-set＋CAS：筛选视图各归其位，删集合保另一集合成员，移除再导入不复活成员', async () => {
    const directory = temporaryDirectory();
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const docA = await importDoc(vault, directory, '甲.md');
    const docB = await importDoc(vault, directory, '乙.md');
    const collections = vault.saveCollection({ mode: 'create', name: '研究' });
    const colStudy = collections.find((collection) => collection.name === '研究')?.id ?? '';
    const colOther =
      vault
        .saveCollection({ mode: 'create', name: '归档' })
        .find((collection) => collection.name === '归档')?.id ?? '';

    const first = vault.setCollectionMembers({
      documentId: docA.document.id,
      expectedMembershipRevision: docA.document.membershipRevision,
      collectionIds: [colOther, colStudy],
    });
    expect(first).toEqual({
      membershipRevision: docA.document.membershipRevision + 1,
      collectionIds: [colStudy, colOther].sort(),
    });
    expect(() =>
      vault.setCollectionMembers({
        documentId: docA.document.id,
        expectedMembershipRevision: docA.document.membershipRevision,
        collectionIds: [],
      }),
    ).toThrowError(/分类刚被其他操作更新/);
    expect(() =>
      vault.setCollectionMembers({
        documentId: docA.document.id,
        expectedMembershipRevision: first.membershipRevision,
        collectionIds: ['不存在的集合'],
      }),
    ).toThrowError(/引用了不存在或已删除的集合/);
    expect(() =>
      vault.setCollectionMembers({
        documentId: 'ghost-doc',
        expectedMembershipRevision: 1,
        collectionIds: [],
      }),
    ).toThrowError(/资料已不在当前资料库中/);

    expect(
      vault
        .listDocuments({ kind: 'collection', collectionId: colStudy })
        .map((document) => document.id),
    ).toEqual([docA.document.id]);
    expect(vault.listDocuments({ kind: 'uncategorized' }).map((document) => document.id)).toEqual([
      docB.document.id,
    ]);
    expect(vault.listDocuments({ kind: 'all' })).toHaveLength(2);

    // K-16：删除一个集合，资料与另一集合成员仍在
    const afterDelete = vault.deleteCollection({ id: colStudy, expectedRevision: 1 });
    expect(afterDelete.map((collection) => collection.id)).toEqual([colOther]);
    const listedA = vault.listDocuments().find((document) => document.id === docA.document.id);
    expect(listedA?.collectionIds).toEqual([colOther]);
    // 内容版本不因分类改动：登记修订保持不变
    expect(listedA?.currentRevisionId).toBe(docA.revisionId);

    // 移出资料库后重新导入是新登记：不恢复旧成员
    expect(vault.removeDocument(docA.document.id)).toBe(true);
    const reimported = await importDoc(vault, directory, '甲.md');
    expect(reimported.document.id).not.toBe(docA.document.id);
    expect(reimported.document.collectionIds).toEqual([]);
    expect(reimported.document.membershipRevision).toBe(1);
    vault.close();
  });
});
