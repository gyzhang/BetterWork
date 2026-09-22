import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CreateMemoryRequest } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { normalizedMemoryHash } from './memory-content-policy';
import { buildLegacyProvenance } from './memory-provenance';
import { MemoryService } from './memory-service';

const userScope = { kind: 'user' } as const;

const userInstruction = (
  content: string,
  overrides: Partial<CreateMemoryRequest> = {},
): CreateMemoryRequest => ({
  operationId: randomUUID(),
  content,
  facet: 'preference',
  scope: userScope,
  asUserInstruction: true,
  genericDeclaration: true,
  ...overrides,
});

describe('MemoryService', () => {
  const stores: AppStore[] = [];
  const directories: string[] = [];

  const setup = async (): Promise<{
    store: AppStore;
    directory: string;
    service: MemoryService;
  }> => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'betterwork-memory-'));
    directories.push(directory);
    const store = AppStore.open(':memory:');
    stores.push(store);
    return { store, directory, service: new MemoryService(store, directory) };
  };

  afterEach(async () => {
    for (const store of stores.splice(0)) store.close();
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('rebuilds a managed Markdown projection from SQLite records', async () => {
    const { service, directory } = await setup();
    const result = await service.create(userInstruction('交付物优先使用中文。'));

    expect(result.ok).toBe(true);
    const projection = await readFile(path.join(directory, 'memory', 'user', 'index.md'), 'utf8');
    expect(projection).toContain('BetterWork 记忆');
    expect(projection).toContain('交付物优先使用中文。');
    expect(projection).toContain('请通过算台管理记忆');
  });

  it('投影重建只清理 manifest 登记的受管文件，不遍历删除用户资料', async () => {
    const { service, store, directory } = await setup();
    const created = await service.create(userInstruction('周报固定用五段式。'));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const root = path.join(directory, 'memory');
    const managed = path.join(root, 'user', 'index.md');
    const manifest = path.join(root, '.managed-manifest.json');
    expect(JSON.parse(await readFile(manifest, 'utf8'))).toEqual(['user/index.md']);

    // 受管目录里混进用户自己的文件：重建既不许删它们，也不许把它们登记成受管路径。
    const note = path.join(root, 'user', '我的笔记.md');
    const stray = path.join(root, '草稿.txt');
    writeFileSync(note, '我自己写的笔记，算台不要动。\n', 'utf8');
    writeFileSync(stray, '放在投影根目录下的用户文件。\n', 'utf8');

    const revisionId = created.data.committedRevisionIds[0] ?? '';
    const record = store.memories.getRevision(revisionId);
    if (!record) throw new Error('创建后必须能按修订读回记录');
    const deleted = await service.setStatus({
      operationId: randomUUID(),
      id: record.id,
      expectedRevision: record.revision,
      action: 'delete',
    });
    expect(deleted.ok).toBe(true);
    const rebuilt = await service.rebuildProjection({ operationId: randomUUID() });
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(rebuilt.data.projectionState).toBe('synced');

    // 旧受管文件按 manifest 清掉；未登记的用户文件与路径原样留下。
    expect(existsSync(managed)).toBe(false);
    expect(JSON.parse(await readFile(manifest, 'utf8'))).toEqual([]);
    expect(readFileSync(note, 'utf8')).toContain('算台不要动');
    expect(readFileSync(stray, 'utf8')).toContain('用户文件');
  });

  it('keeps a self-declared statement reusable across materials', async () => {
    const { service } = await setup();
    const result = await service.create(
      userInstruction('月报先核对收入确认口径。', { facet: 'decision', topicKey: 'revenue' }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const memory = result.data.currentMemory;
    expect(memory?.sourceAvailability).toBe('available');
    expect(memory?.requiresMaterialSelection).toBe(false);
    expect(memory?.provenance).toMatchObject({
      verification: 'verified',
      authority: 'user-instruction',
      materialDependencies: [],
      memoryDependencies: [],
    });
  });

  it('refuses credential-looking content without persisting it', async () => {
    const { service, store } = await setup();
    const secret = 'API_KEY=sk-abcdefghijklmnopqrstuvwxyz012345';
    const result = await service.create(userInstruction(secret));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SENSITIVE_CONTENT');
    // 失败摘要不得回显命中片段。
    expect(result.error.message).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345');
    expect(store.memories.list({ includeCandidates: true })).toHaveLength(0);
  });

  it('requires an explicit generic declaration before writing global memory', async () => {
    const { service } = await setup();
    const result = await service.create(
      userInstruction('所有交付物都用中文。', { genericDeclaration: false }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('GLOBAL_SCOPE_REQUIRES_DECLARATION');
  });

  it('keeps the restated revision as an audit link, even on replay', async () => {
    const { service } = await setup();
    const original = await service.create(userInstruction('资料里说收入按回款确认。'));
    expect(original.ok).toBe(true);
    if (!original.ok) return;
    const fromRevisionId = original.data.committedRevisionIds[0] ?? '';

    const operationId = randomUUID();
    const restated = await service.create(
      userInstruction('收入以回款到账为准，这是我自己的口径。', {
        operationId,
        fromMemoryRevisionId: fromRevisionId,
      }),
    );
    expect(restated.ok).toBe(true);
    if (!restated.ok) return;
    expect(restated.data.fromMemoryRevisionId).toBe(fromRevisionId);
    expect(restated.data.currentMemory?.provenance).toMatchObject({
      authority: 'user-instruction',
      materialDependencies: [],
      memoryDependencies: [],
    });

    const replay = await service.create(
      userInstruction('收入以回款到账为准，这是我自己的口径。', {
        operationId,
        fromMemoryRevisionId: fromRevisionId,
      }),
    );
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.data.fromMemoryRevisionId).toBe(fromRevisionId);
    expect(replay.data.committedRevisionIds).toEqual(restated.data.committedRevisionIds);
  });

  it('refuses an audit link that is fabricated or not a restatement', async () => {
    const { service } = await setup();
    const missing = await service.create(
      userInstruction('凭空的审计线索。', { fromMemoryRevisionId: 'rev-missing' }),
    );
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe('NOT_FOUND');

    const notRestatement = await service.create(
      userInstruction('资料结论。', {
        scope: { kind: 'workspace', workspaceId: 'ws-a' },
        asUserInstruction: false,
        genericDeclaration: undefined,
        sourceSelector: { kind: 'run-user', runId: 'run-1', start: 0, end: 5 },
        fromMemoryRevisionId: 'rev-any',
      }),
    );
    expect(notRestatement.ok).toBe(false);
    if (notRestatement.ok) return;
    expect(notRestatement.error.code).toBe('SOURCE_MISMATCH');
  });

  it('replays one effect per operationId and rejects a reused id with a different request', async () => {
    const { service, store } = await setup();
    const operationId = randomUUID();
    const first = await service.create(userInstruction('汇报要先说风险。', { operationId }));
    const replay = await service.create(userInstruction('汇报要先说风险。', { operationId }));
    const conflict = await service.create(userInstruction('汇报要先说结论。', { operationId }));

    expect(first.ok && replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(replay.data.committedRevisionIds).toEqual(first.data.committedRevisionIds);
    expect(replay.data.currentMemory?.revision).toBe(1);
    expect(store.memories.getRevision(first.data.committedRevisionIds[0] ?? '')?.revision).toBe(1);
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('reports the live revision on a stale write without appending one', async () => {
    const { service, store } = await setup();
    const created = await service.create(userInstruction('预算按季度复核。'));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data.currentMemory?.id ?? '';

    const stale = await service.update({
      operationId: randomUUID(),
      id,
      expectedRevision: 99,
      patch: { content: '预算按月复核。' },
    });

    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.code).toBe('REVISION_CONFLICT');
    expect(stale.error.currentRevision).toBe(1);
    expect(store.memories.get(id)?.revision).toBe(1);
    expect(store.memories.get(id)?.content).toBe('预算按季度复核。');
  });

  it('survives a failed projection as committed-plus-warning', async () => {
    const { service, store, directory } = await setup();
    // 受管投影根被普通文件占用：mkdir 必然失败，用来固定「已提交 + 投影失败」这一顺序。
    writeFileSync(path.join(directory, 'memory'), 'not-a-directory', 'utf8');

    const result = await service.create(userInstruction('结论放第一段。'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.commit).toBe('committed');
    expect(result.data.projectionState).toBe('failed');
    expect(result.warnings.map((warning) => warning.code)).toContain('PROJECTION_PENDING');
    // 投影失败不得重复写业务修订。
    expect(store.memories.get(result.data.currentMemory?.id ?? '')?.revision).toBe(1);
  });

  it('gates unreviewed legacy records and clears the gate through the review entry', async () => {
    const { service, store } = await setup();
    const content = '历史口径：合同额即收入。';
    const legacy = store.memories.create({
      facet: 'fact',
      scope: userScope,
      content,
      normalizedHash: normalizedMemoryHash(content),
      provenance: buildLegacyProvenance({ sourceType: 'conversation' }),
      confidence: 1,
      status: 'confirmed',
    });
    const id = legacy.record.id;

    const blocked = await service.setStatus({
      operationId: randomUUID(),
      id,
      expectedRevision: 1,
      action: 'reconfirm',
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.code).toBe('SOURCE_REVIEW_REQUIRED');

    const reviewed = await service.update({
      operationId: randomUUID(),
      id,
      expectedRevision: 1,
      patch: { content },
      legacySourceReview: { mode: 'user-instruction', genericDeclaration: true },
    });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;
    expect(reviewed.data.currentMemory?.sourceAvailability).toBe('available');
    expect(store.memories.get(id)?.provenance.verification).toBe('verified');
  });

  it('rejects a fabricated source selector instead of trusting the client', async () => {
    const { service } = await setup();
    const result = await service.create(
      userInstruction('收入按回款金额统计。', {
        scope: { kind: 'workspace', workspaceId: 'ws-fabricated' },
        asUserInstruction: false,
        genericDeclaration: undefined,
        sourceSelector: { kind: 'run-user', runId: 'no-such-run', start: 0, end: 2 },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SOURCE_UNAVAILABLE');
  });

  it('resolves conflicts atomically and demands an applicability note for keep-both', async () => {
    const { service, store } = await setup();
    const left = await service.create(
      userInstruction('收入按回款金额统计。', { facet: 'fact', topicKey: 'revenue' }),
    );
    const right = await service.create(
      userInstruction('收入按签约金额统计。', { facet: 'fact', topicKey: 'revenue' }),
    );
    expect(left.ok && right.ok).toBe(true);
    if (!left.ok || !right.ok) return;
    const leftId = left.data.currentMemory?.id ?? '';
    const rightId = right.data.currentMemory?.id ?? '';

    const withoutNote = await service.resolveConflict({
      operationId: randomUUID(),
      left: { id: leftId, expectedRevision: 1 },
      right: { id: rightId, expectedRevision: 1 },
      decision: 'keep-both',
    });
    expect(withoutNote.ok).toBe(false);
    if (withoutNote.ok) return;
    expect(withoutNote.error.code).toBe('CONFLICT_REVIEW_REQUIRED');

    const staleLoser = await service.resolveConflict({
      operationId: randomUUID(),
      left: { id: leftId, expectedRevision: 1 },
      right: { id: rightId, expectedRevision: 7 },
      decision: 'replace',
      winnerId: leftId,
    });
    expect(staleLoser.ok).toBe(false);
    if (staleLoser.ok) return;
    expect(store.memories.get(rightId)?.status).toBe('confirmed');
    expect(store.memories.get(leftId)?.revision).toBe(1);

    const replaced = await service.resolveConflict({
      operationId: randomUUID(),
      left: { id: leftId, expectedRevision: 1 },
      right: { id: rightId, expectedRevision: 1 },
      decision: 'replace',
      winnerId: leftId,
    });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(store.memories.get(leftId)?.status).toBe('confirmed');
    expect(store.memories.get(rightId)?.status).toBe('superseded');
    expect(replaced.data.decision).toMatchObject({ decision: 'replace' });
  });

  it('lists governance views with derived effective status', async () => {
    const { service } = await setup();
    const created = await service.create(
      userInstruction('已失效的旧口径。', { facet: 'fact', validUntil: 1_000 }),
    );
    expect(created.ok).toBe(true);

    const page = service.list({ includeCandidates: false });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.data.items.map((item) => item.effectiveStatus)).toContain('expired');
  });
});
