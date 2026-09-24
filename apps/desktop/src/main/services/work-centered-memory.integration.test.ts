import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  MemoryJobSummary,
  MemoryRecord,
  MemoryScope,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import {
  MEMORY_EXTRACTION_QUEUE_LIMIT,
  MEMORY_SUGGESTION_CONSENT_VERSION,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import type { CredentialResolver } from './credential-access';
import { createStoreExtractionSourceReader } from './extraction-source-reader';
import { InputSnapshotService } from './input-snapshot-service';
import { KnowledgeVault } from './knowledge-vault';
import { MemoryExtractionService } from './memory-extraction-service';
import { MemoryRecallService } from './memory-recall-service';
import { MemoryService } from './memory-service';
import { ModelProviderFactory } from './model-provider-factory';
import { NotificationService } from './notification-service';
import { RunService } from './run-service';
import { SkillService } from './skill-service';
import { TaskMaterialService } from './task-material-service';

// WM15 系统级合成验收：真实文件 SQLite（可关闭重开）＋ mock fetch 捕获实际 Provider 请求。
// 空间与文案全部合成，不使用任何公司真实文件；这里只证明机制与范围隔离，不证明真实模型语义质量。

const EXTRACTION_MARKER = '只输出严格 JSON';

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const temporaryDirectories: string[] = [];
const openStores: AppStore[] = [];
const openVaults: KnowledgeVault[] = [];

interface WireMessage {
  readonly role: string;
  readonly content: string;
}

interface WireRequest {
  readonly messages: readonly WireMessage[];
  readonly extraction: boolean;
}

interface ModelScript {
  answer: string;
  extractionText: string;
  /** 需要真实读取材料时，模型先按清单发起一次 read_text_file 调用。 */
  readsMaterials?: boolean;
}

interface TaskRef {
  readonly taskId: string;
  readonly sessionId: string;
}

interface ContextRef {
  readonly id: string;
  readonly revision: number;
}

interface Layout {
  readonly workspaceA: string;
  readonly workspaceB: string;
  readonly rootA: string;
  readonly rootB: string;
  readonly expertId: string;
  readonly expertRevisionId: string;
  readonly a1: TaskRef;
  readonly a2: TaskRef;
  readonly b1: TaskRef;
  readonly b2: TaskRef;
}

interface Services {
  readonly store: AppStore;
  readonly vault: KnowledgeVault;
  readonly inputSnapshots: InputSnapshotService;
  readonly memories: MemoryService;
  readonly recall: MemoryRecallService;
  readonly extractions: MemoryExtractionService;
  readonly runs: RunService;
}

interface World {
  readonly directory: string;
  readonly layout: Layout;
  readonly requests: WireRequest[];
  readonly script: ModelScript;
  services: Services;
}

const credentialResolver: CredentialResolver = {
  migrationStatus: (reference) => (reference.ownerKind === 'model-profile' ? 'done' : 'none'),
  resolveSecret: async () => 'SK-FROM-WM15-FIXTURE',
};

const sseResponse = (payload: string): Response =>
  new Response(
    `data: ${payload}

data: [DONE]

`,
    { headers: { 'content-type': 'text/event-stream' } },
  );

const wireMessages = (init: RequestInit | undefined): WireMessage[] => {
  const parsed: unknown = JSON.parse(String(init?.body ?? '{}'));
  const messages =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { messages?: unknown }).messages
      : undefined;
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message) => {
    if (typeof message !== 'object' || message === null) return [];
    const entry = message as { role?: unknown; content?: unknown };
    return typeof entry.role === 'string' && typeof entry.content === 'string'
      ? [{ role: entry.role, content: entry.content }]
      : [];
  });
};

/** 只问「模型实际看见了什么」：任一角色含该文本即为 true。 */
const mentions = (request: WireRequest | undefined, text: string): boolean =>
  (request?.messages ?? []).some((message) => message.content.includes(text));

const installFetch = (world: World): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      const extraction = body.includes(EXTRACTION_MARKER);
      world.requests.push({ messages: wireMessages(init), extraction });
      const toolCall = ((): string | undefined => {
        if (world.script.readsMaterials !== true || extraction) return undefined;
        if (body.includes('"tool_call_id"')) return undefined;
        return /path=\\"([^"\\]+)\\"/.exec(body)?.[1];
      })();
      if (toolCall !== undefined) {
        return sseResponse(
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'wm15-material-read',
                      function: {
                        name: 'read_text_file',
                        arguments: JSON.stringify({ path: toolCall }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
      }
      const content = extraction ? world.script.extractionText : world.script.answer;
      return sseResponse(
        JSON.stringify({
          choices: [{ delta: { content }, finish_reason: 'stop' }],
          ...(extraction
            ? { usage: { prompt_tokens: 300, completion_tokens: 40, total_tokens: 340 } }
            : {}),
        }),
      );
    }),
  );
};

const openServices = (directory: string): Services => {
  const store = AppStore.open(path.join(directory, 'app.sqlite'));
  openStores.push(store);
  const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
  openVaults.push(vault);
  const inputSnapshots = new InputSnapshotService(store, directory);
  const taskMaterials = new TaskMaterialService({ store, knowledgeVault: vault, inputSnapshots });
  const memories = new MemoryService(store, directory);
  const extractions = new MemoryExtractionService({
    jobs: store.memoryExtractions,
    memories: store.memories,
    operations: store.memoryOperations,
    transaction: <TBody>(body: () => TBody): TBody => store.transaction(body),
    sources: createStoreExtractionSourceReader(store),
    modelFactory: new ModelProviderFactory({
      models: store.models,
      credentialAccess: credentialResolver,
    }),
  });
  const skillService = new SkillService(store, {
    developmentBuiltinRoot: path.join(directory, 'builtin-dev'),
    installedBuiltinRoot: path.join(directory, 'builtin-installed'),
    userRoot: path.join(directory, 'skills'),
  });
  const notifications = new NotificationService(store.notifications, () => null);
  const runs = new RunService(
    store,
    vault,
    notifications,
    skillService,
    () => null,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    inputSnapshots,
    taskMaterials,
    extractions,
    undefined,
    undefined,
    undefined,
    credentialResolver,
  );
  return {
    store,
    vault,
    inputSnapshots,
    memories,
    recall: new MemoryRecallService({ store }),
    extractions,
    runs,
  };
};

const expertRevision = {
  name: '经营分析专家',
  summary: '按用户口径完成经营分析',
  identity: '负责经营分析与收入口径复核。',
  principles: [],
  inputRequirements: [],
  deliveryRequirements: [],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' as const },
  modelReference: { mode: 'application-default' as const },
};

const createWorld = async (
  options: { projectionBlocked?: boolean; withoutModel?: boolean } = {},
): Promise<World> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'betterwork-wm15-'));
  temporaryDirectories.push(directory);
  const rootA = path.join(directory, 'workspace-a');
  const rootB = path.join(directory, 'workspace-b');
  await mkdir(rootA, { recursive: true });
  await mkdir(rootB, { recursive: true });
  if (options.projectionBlocked === true) {
    // 受管投影根被普通文件占用：投影必然失败，用来证明 SQLite 才是真相源。
    writeFileSync(path.join(directory, 'memory'), 'not-a-directory', 'utf8');
  }
  const store = AppStore.open(path.join(directory, 'app.sqlite'));
  if (options.withoutModel !== true) {
    store.models.save({
      name: 'WM15 请求替身模型',
      provider: 'openai-compatible',
      baseUrl: 'http://model.test/v1',
      model: 'x',
      role: 'language',
      apiKey: '',
      enabled: true,
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
    });
  }
  const workspaceA = store.workspaces.getOrCreate(rootA, '经营分析').id;
  const workspaceB = store.workspaces.getOrCreate(rootB, '市场研究').id;
  const expert = store.experts.create({ sourceKind: 'user', revision: expertRevision });
  const a1 = store.tasks.create(workspaceA, '本月收入复盘', '产出收入口径分析');
  const a2 = store.tasks.create(workspaceA, '季度收入汇报', '产出季度汇报段落');
  const b1 = store.tasks.create(workspaceB, '竞品价格调研', '产出对比结论');
  const b2 = store.tasks.create(workspaceB, '渠道投放复盘', '产出投放建议');
  store.close();

  const layout: Layout = {
    workspaceA,
    workspaceB,
    rootA,
    rootB,
    expertId: expert.id,
    expertRevisionId: expert.revision.id,
    a1: { taskId: a1.task.id, sessionId: a1.sessionId },
    a2: { taskId: a2.task.id, sessionId: a2.sessionId },
    b1: { taskId: b1.task.id, sessionId: b1.sessionId },
    b2: { taskId: b2.task.id, sessionId: b2.sessionId },
  };
  const world: World = {
    directory,
    layout,
    requests: [],
    script: {
      answer: '已按回款金额口径完成本期收入汇总。',
      extractionText: JSON.stringify({ candidates: [] }),
    },
    services: openServices(directory),
  };
  installFetch(world);
  return world;
};

/** 模拟应用重启：关掉全部句柄后重新装配，只保留临时目录与请求捕获。 */
const restartWorld = (world: World): number => {
  const interrupted = world.services.extractions.recoverInterruptedJobs();
  world.services.store.close();
  world.services.vault.close();
  const requestsBefore = world.requests.length;
  world.services = openServices(world.directory);
  // 启动只做收口，不在启动瞬间触网（契约 §7.3）。
  expect(world.requests.length).toBe(requestsBefore);
  return interrupted;
};

const statusOf = (world: World, runId: string): string | undefined =>
  world.services.store.runs.list().find((run) => run.id === runId)?.status;

const waitForCompletion = async (world: World, runId: string): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (statusOf(world, runId) !== 'running') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Run did not complete in time');
};

const startRun = (world: World, task: TaskRef, prompt: string, context?: ContextRef): string =>
  world.services.runs.start({
    taskId: task.taskId,
    sessionId: task.sessionId,
    prompt,
    ...(context === undefined
      ? {}
      : { taskContextRevisionId: context.id, expectedTaskContextRevision: context.revision }),
  });

const lastRunRequest = (world: World): WireRequest | undefined =>
  [...world.requests].reverse().find((request) => !request.extraction);

const saveContext = (
  world: World,
  task: TaskRef,
  input: { materials: TaskMaterialSelection[]; excludedMemoryIds: string[] },
): ContextRef =>
  world.services.store.taskContexts.save(task.taskId, {
    executor: {
      kind: 'expert',
      expertId: world.layout.expertId,
      expertRevisionId: world.layout.expertRevisionId,
    },
    skillBindings: [],
    materials: input.materials,
    excludedMemoryIds: input.excludedMemoryIds,
  });

/** 走真实快照链路合成一份工作区材料，返回可直接绑进 TaskContext 的选择项。 */
const addMaterial = async (
  world: World,
  fileName: string,
  content: string,
): Promise<TaskMaterialSelection> => {
  const workspaceId = world.layout.workspaceA;
  const sourcePath = path.join(world.layout.rootA, fileName);
  await writeFile(sourcePath, content, 'utf8');
  const receipt = await world.services.inputSnapshots.create({
    workspaceId,
    workspaceRoot: world.layout.rootA,
    sourcePath,
  });
  return {
    reference: {
      kind: 'workspace-input-snapshot',
      snapshotId: receipt.snapshot.id,
      workspaceId,
      contentHash: receipt.snapshot.contentHash,
      format: receipt.snapshot.format,
      fileKey: receipt.snapshot.fileKey,
    },
    purpose: 'current-input',
    addedFrom: 'user-input',
  };
};

const confirmMemory = async (
  world: World,
  scope: MemoryScope,
  input: { content: string; facet: 'decision' | 'fact' | 'preference'; topicKey?: string },
): Promise<MemoryRecord> => {
  const result = await world.services.memories.create({
    operationId: randomUUID(),
    content: input.content,
    facet: input.facet,
    scope,
    asUserInstruction: true,
    ...(scope.kind === 'user' || scope.kind === 'expert' ? { genericDeclaration: true } : {}),
    ...(input.topicKey === undefined ? {} : { topicKey: input.topicKey }),
  });
  if (!result.ok) throw new Error(`记忆写入失败：${result.error.code}`);
  const revisionId = result.data.committedRevisionIds[0];
  const record =
    revisionId === undefined ? undefined : world.services.store.memories.getRevision(revisionId);
  if (!record) throw new Error('记忆修订未落库。');
  return record;
};

const enableAutoSuggest = async (world: World, workspaceId: string): Promise<void> => {
  const result = await world.services.extractions.setSettings({
    operationId: randomUUID(),
    workspaceId,
    expectedRevision: 0,
    autoSuggestEnabled: true,
    consentVersion: MEMORY_SUGGESTION_CONSENT_VERSION,
  });
  if (!result.ok) throw new Error(`自动建议开启失败：${result.error.code}`);
};

const drainUntilTerminal = async (
  world: World,
  workspaceId: string,
): Promise<MemoryJobSummary | undefined> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const page = await world.services.extractions.listJobs({ workspaceId });
    const job = page.ok ? page.data.items[0] : undefined;
    if (job !== undefined && job.status !== 'queued' && job.status !== 'running') return job;
    await world.services.extractions.runPendingJobs();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return undefined;
};

const memoriesOf = (world: World, workspaceId: string): MemoryRecord[] => {
  const page = world.services.memories.list({ workspaceId, includeCandidates: true });
  if (!page.ok) throw new Error(`记忆列表读取失败：${page.error.code}`);
  return page.data.items.flatMap((item) => {
    const record = world.services.store.memories.get(item.id);
    return record === undefined ? [] : [record];
  });
};

const selectedRevisionIds = (world: World, runId: string): string[] =>
  (world.services.store.runMemoryContexts.get(runId)?.selectedItems ?? []).map(
    (item) => item.revisionId,
  );

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const store of openStores.splice(0)) store.close();
  for (const vault of openVaults.splice(0)) vault.close();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('工作型记忆系统级合成验收（WM15）', () => {
  it('自主口径带入同空间的两个独立任务，且不泄漏到另一个空间', async () => {
    const world = await createWorld();
    const rule = '收入按回款金额统计，不使用签约金额。';
    const memory = await confirmMemory(
      world,
      { kind: 'workspace', workspaceId: world.layout.workspaceA },
      { content: rule, facet: 'decision', topicKey: '统计口径' },
    );

    const firstRun = startRun(world, world.layout.a1, '按回款金额口径核对本月收入。');
    await waitForCompletion(world, firstRun);
    expect(statusOf(world, firstRun)).toBe('completed');
    expect(mentions(lastRunRequest(world), rule)).toBe(true);

    // 同空间的第二个独立任务没有继承第一个任务的排除与材料，仍应带入口径。
    const secondRun = startRun(world, world.layout.a2, '把回款金额口径下的收入结论整理成段落。');
    await waitForCompletion(world, secondRun);
    expect(mentions(lastRunRequest(world), rule)).toBe(true);
    const audit = world.services.store.runMemoryContexts.get(secondRun);
    expect(audit?.phase).toBe('dispatch-attempted');
    expect(selectedRevisionIds(world, secondRun)).toContain(memory.revisionId);

    const otherWorkspaceRun = startRun(world, world.layout.b1, '按回款金额口径核对竞品定价。');
    await waitForCompletion(world, otherWorkspaceRun);
    expect(mentions(lastRunRequest(world), rule)).toBe(false);
    expect(selectedRevisionIds(world, otherWorkspaceRun)).toEqual([]);
  });

  it('中英混合材料按 memory-recall-v1 命中，无关任务不误带', async () => {
    const world = await createWorld();
    const arrRule = 'ARR 不含一次性实施费，单位为万元。';
    const memory = await confirmMemory(
      world,
      { kind: 'workspace', workspaceId: world.layout.workspaceA },
      { content: arrRule, facet: 'decision', topicKey: 'ARR' },
    );

    const matched = startRun(world, world.layout.a1, '请说明 ARR 中一次性实施费如何处理。');
    await waitForCompletion(world, matched);
    expect(mentions(lastRunRequest(world), arrRule)).toBe(true);

    const unrelated = startRun(world, world.layout.a2, '整理本月渠道续约率的说明。');
    await waitForCompletion(world, unrelated);
    expect(mentions(lastRunRequest(world), arrRule)).toBe(false);
    expect(selectedRevisionIds(world, unrelated)).toEqual([]);
    expect(selectedRevisionIds(world, matched)).toContain(memory.revisionId);
  });

  it('提炼出的候选确认后只在来源材料被选中时带入', async () => {
    const world = await createWorld();
    const workspaceA = world.layout.workspaceA;
    const revenueDraft = await addMaterial(
      world,
      '收入底稿.md',
      '本月回款金额与签约金额分列，按回款确认收入。',
    );
    await enableAutoSuggest(world, workspaceA);
    // 材料范围 Run 必须真实读取才能完成，这里让替身按清单发起 read_text_file。
    world.script.readsMaterials = true;
    const candidateContent = '收入统计一律使用回款金额，不使用签约金额。';
    world.script.extractionText = JSON.stringify({
      candidates: [
        {
          content: candidateContent,
          facet: 'decision',
          topicKey: '统计口径',
          confidence: 0.8,
          evidence: [{ fragmentId: 'f1', start: 0, end: 8 }],
        },
      ],
    });

    const sourceRun = startRun(
      world,
      world.layout.a1,
      '请按收入底稿核对本月收入与回款金额，并给出经营分析结论。',
      saveContext(world, world.layout.a1, {
        materials: [revenueDraft],
        excludedMemoryIds: [],
      }),
    );
    await waitForCompletion(world, sourceRun);
    expect(statusOf(world, sourceRun)).toBe('completed');
    const job = await drainUntilTerminal(world, workspaceA);
    expect(job?.status).toBe('succeeded');

    const candidates = memoriesOf(world, workspaceA).filter(
      (record) => record.content === candidateContent,
    );
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0];
    if (candidate === undefined) throw new Error('候选未落库。');
    expect(candidate.status).toBe('candidate');
    const provenance =
      candidate.provenance.verification === 'verified' ? candidate.provenance : undefined;
    expect(provenance?.materialDependencies.map((entry) => entry.kind)).toEqual([
      'workspace-input-snapshot',
    ]);

    const confirmed = await world.services.memories.setStatus({
      operationId: randomUUID(),
      id: candidate.id,
      expectedRevision: candidate.revision,
      action: 'confirm',
    });
    expect(confirmed.ok).toBe(true);

    const withMaterial = startRun(
      world,
      world.layout.a2,
      '按收入底稿复核回款金额并整理成结论。',
      saveContext(world, world.layout.a2, {
        materials: [revenueDraft],
        excludedMemoryIds: [],
      }),
    );
    await waitForCompletion(world, withMaterial);
    expect(mentions(lastRunRequest(world), candidateContent)).toBe(true);

    // 换一份材料：派生结论的来源材料没被选中，就不能再冒充本任务的既有口径。
    const otherDraft = await addMaterial(world, '市场数据.md', '渠道投放费用与竞品定价明细。');
    const withoutMaterial = startRun(
      world,
      world.layout.a2,
      '按收入底稿复核回款金额并整理成结论。',
      saveContext(world, world.layout.a2, {
        materials: [otherDraft],
        excludedMemoryIds: [],
      }),
    );
    await waitForCompletion(world, withoutMaterial);
    expect(mentions(lastRunRequest(world), candidateContent)).toBe(false);
    const exclusions =
      world.services.store.runMemoryContexts.get(withoutMaterial)?.decisionSummary.exclusions ?? [];
    expect(exclusions.map((entry) => entry.reason)).toContain('dependency-unavailable');
  });

  it('旧规则被替代后，新任务不再带入旧规则，历史后缀也被挡住', async () => {
    const world = await createWorld();
    const workspaceA = world.layout.workspaceA;
    const oldRule = '收入按签约金额统计。';
    const newRule = '收入按回款金额统计。';
    const outdated = await confirmMemory(
      world,
      { kind: 'workspace', workspaceId: workspaceA },
      { content: oldRule, facet: 'decision', topicKey: '统计口径' },
    );

    // 旧规则先真实进入一次运行，成为那一轮的记忆依赖，替代才需要连历史一起判定。
    const firstRun = startRun(world, world.layout.a1, '按签约金额口径汇总本月收入。');
    await waitForCompletion(world, firstRun);
    expect(mentions(lastRunRequest(world), oldRule)).toBe(true);
    expect(selectedRevisionIds(world, firstRun)).toContain(outdated.revisionId);

    const current = await confirmMemory(
      world,
      { kind: 'workspace', workspaceId: workspaceA },
      { content: newRule, facet: 'decision', topicKey: '统计口径' },
    );
    const resolution = await world.services.memories.resolveConflict({
      operationId: randomUUID(),
      left: { id: outdated.id, expectedRevision: outdated.revision },
      right: { id: current.id, expectedRevision: current.revision },
      decision: 'replace',
      winnerId: current.id,
    });
    expect(resolution.ok).toBe(true);

    const secondRun = startRun(world, world.layout.a1, '按回款金额口径输出本季收入结论。');
    await waitForCompletion(world, secondRun);
    const request = lastRunRequest(world);
    expect(mentions(request, newRule)).toBe(true);
    // 旧修订已被替代：既不能作为记忆注入，也不能借上一轮回答继续影响本任务。
    expect(mentions(request, oldRule)).toBe(false);
    const context = world.services.store.runMemoryContexts.get(secondRun);
    expect(context?.selectedItems.map((item) => item.revisionId)).toEqual([current.revisionId]);
    const replay = context?.replay ?? [];
    expect(replay.filter((entry) => entry.replayed)).toEqual([]);
    expect(replay.map((entry) => ('reason' in entry ? entry.reason : undefined))).toContain(
      'memory-revised',
    );

    // 替代不改写历史：旧运行读过旧修订的审计事实必须原样保留。
    expect(
      world.services.store.memories.listMemoryReads(firstRun).map((read) => read.memoryRevisionId),
    ).toContain(outdated.revisionId);
  });

  it('排除、到期与删除各自生效，但历史运行的审计仍可回溯', async () => {
    const world = await createWorld();
    const workspaceA = world.layout.workspaceA;
    const prompt = '按回款金额核对收入，并汇报续约率的异常事项。';
    const excluded = await confirmMemory(
      world,
      { kind: 'workspace', workspaceId: workspaceA },
      { content: '汇报时先列异常事项。', facet: 'preference' },
    );
    const temporary = await confirmMemory(
      world,
      { kind: 'workspace', workspaceId: workspaceA },
      { content: '本期续约率为 82%。', facet: 'fact' },
    );
    const removed = await confirmMemory(
      world,
      { kind: 'workspace', workspaceId: workspaceA },
      { content: '收入按回款金额统计。', facet: 'decision', topicKey: '统计口径' },
    );

    const beforeRun = startRun(world, world.layout.a1, prompt);
    await waitForCompletion(world, beforeRun);
    expect(mentions(lastRunRequest(world), removed.content)).toBe(true);
    expect(selectedRevisionIds(world, beforeRun)).toContain(temporary.revisionId);

    const expired = await world.services.memories.setStatus({
      operationId: randomUUID(),
      id: temporary.id,
      expectedRevision: temporary.revision,
      action: 'expire',
    });
    expect(expired.ok).toBe(true);
    const deleted = await world.services.memories.setStatus({
      operationId: randomUUID(),
      id: removed.id,
      expectedRevision: removed.revision,
      action: 'delete',
    });
    expect(deleted.ok).toBe(true);

    const afterRun = startRun(
      world,
      world.layout.a2,
      prompt,
      saveContext(world, world.layout.a2, {
        materials: [],
        excludedMemoryIds: [excluded.id],
      }),
    );
    await waitForCompletion(world, afterRun);
    const request = lastRunRequest(world);
    expect(mentions(request, excluded.content)).toBe(false);
    expect(mentions(request, temporary.content)).toBe(false);
    expect(mentions(request, removed.content)).toBe(false);
    const reasons = (
      world.services.store.runMemoryContexts.get(afterRun)?.decisionSummary.exclusions ?? []
    ).map((entry) => entry.reason);
    expect(reasons).toContain('task-excluded');
    expect(reasons).toContain('inactive');

    // 删除是治理终态，不是抹掉历史：先前那次运行仍指向被删记忆的精确修订。
    expect(
      world.services.store.memories.listMemoryReads(beforeRun).map((read) => read.memoryRevisionId),
    ).toContain(removed.revisionId);
    expect(world.services.store.memories.get(removed.id)?.status).toBe('deleted');
  });

  it('重启后记忆、审计与召回保持一致，启动阶段零网络', async () => {
    const world = await createWorld();
    const rule = '收入按回款金额统计，不使用签约金额。';
    const memory = await confirmMemory(
      world,
      { kind: 'workspace', workspaceId: world.layout.workspaceA },
      { content: rule, facet: 'decision', topicKey: '统计口径' },
    );
    const firstRun = startRun(world, world.layout.a1, '按回款金额口径核对本月收入。');
    await waitForCompletion(world, firstRun);
    const auditBefore = world.services.store.runMemoryContexts.get(firstRun);
    if (auditBefore === undefined) throw new Error('运行审计未落库。');

    expect(restartWorld(world)).toBe(0);

    const reloaded = world.services.store.memories.get(memory.id);
    expect(reloaded?.content).toBe(rule);
    expect(reloaded?.revision).toBe(memory.revision);
    const restored = world.services.store.runMemoryContexts.get(firstRun);
    expect(restored?.phase).toBe(auditBefore.phase);
    expect(restored?.requestHash).toBe(auditBefore.requestHash);
    expect(restored?.selectedItems.map((item) => item.revisionId)).toEqual(
      auditBefore.selectedItems.map((item) => item.revisionId),
    );

    const secondRun = startRun(world, world.layout.a2, '把回款金额口径下的收入结论写成段落。');
    await waitForCompletion(world, secondRun);
    expect(mentions(lastRunRequest(world), rule)).toBe(true);
  });

  it('取消的 Run 不进入后续历史，迟到的取消不改动终态', async () => {
    // 不配模型：走内置教学 Provider，取消路径不触网，也顺便证明零网络回落。
    const world = await createWorld({ withoutModel: true });
    await confirmMemory(
      world,
      { kind: 'workspace', workspaceId: world.layout.workspaceA },
      {
        content: '收入按回款金额统计，不使用签约金额。',
        facet: 'decision',
        topicKey: '统计口径',
      },
    );

    const cancelledRun = startRun(world, world.layout.a1, '按回款金额口径核对本月收入。');
    expect(world.services.runs.cancel(cancelledRun)).toBe(true);
    await waitForCompletion(world, cancelledRun);
    expect(statusOf(world, cancelledRun)).toBe('cancelled');
    // 迟到取消：终态已落库，第二次取消不得改状态也不得追加事件。
    const eventsBefore = world.services.store.runs.listEvents(cancelledRun).length;
    expect(world.services.runs.cancel(cancelledRun)).toBe(false);
    expect(statusOf(world, cancelledRun)).toBe('cancelled');
    expect(world.services.store.runs.listEvents(cancelledRun)).toHaveLength(eventsBefore);

    const completedRun = startRun(world, world.layout.a1, '把本月收入结论再核对一遍。');
    await waitForCompletion(world, completedRun);
    expect(statusOf(world, completedRun)).toBe('completed');
    const nextRun = startRun(world, world.layout.a1, '按金额口径输出本季收入结论。');
    await waitForCompletion(world, nextRun);
    const replayed = (world.services.store.runMemoryContexts.get(nextRun)?.replay ?? []).filter(
      (entry) => entry.replayed,
    );
    expect(replayed.map((entry) => entry.runId)).toEqual([completedRun]);
    expect(world.requests).toEqual([]);
  });

  it('提炼失败不改变主 Run 终态，也不写入候选', async () => {
    const world = await createWorld();
    const workspaceA = world.layout.workspaceA;
    await enableAutoSuggest(world, workspaceA);
    world.script.extractionText = '我觉得这次口径挺好的，不用再改了。';

    const runId = startRun(world, world.layout.a1, '按回款金额口径核对本月收入并给出结论。');
    await waitForCompletion(world, runId);
    expect(statusOf(world, runId)).toBe('completed');
    expect(world.services.store.runMemoryContexts.get(runId)?.phase).toBe('dispatch-attempted');

    const job = await drainUntilTerminal(world, workspaceA);
    expect(job?.status).toBe('failed');
    expect(job?.errorCode).toBe('INVALID_MODEL_OUTPUT');
    const extractions = world.requests.filter((request) => request.extraction);
    expect(extractions).toHaveLength(1);
    expect(memoriesOf(world, workspaceA)).toEqual([]);
  });

  it('排队失败（全局队列已满）不改主 Run 终态，也不留下自动补单', async () => {
    const world = await createWorld();
    const workspaceA = world.layout.workspaceA;
    await enableAutoSuggest(world, workspaceA);

    // 全局队列只有 20 条：先用另一条真实任务链占满，让本次 Run 的提炼必然排队失败。
    // 一次事务写完占位作业，避免逐条提交把用例拖到默认超时边界。
    const seedRunId = randomUUID();
    world.services.store.transaction(() => {
      world.services.store.runs.create({
        id: seedRunId,
        taskId: world.layout.a2.taskId,
        sessionId: world.layout.a2.sessionId,
        prompt: '排队用例的来源运行',
        status: 'completed',
        createdAt: Date.now(),
      });
      for (let index = 0; index < MEMORY_EXTRACTION_QUEUE_LIMIT; index += 1) {
        const text = `排队占位片段 ${index}`;
        world.services.store.memoryExtractions.enqueue({
          source: { kind: 'run', runId: seedRunId },
          workspaceId: workspaceA,
          taskId: world.layout.a2.taskId,
          fragments: [
            { fragmentId: `queue-${index}`, role: 'run-assistant', text, partial: false },
          ],
          sourceVersionHash: sha256Hex(text),
          trigger: 'automatic',
          inputCodePoints: [...text].length,
        });
      }
    });
    expect(world.services.store.memoryExtractions.queuedCount()).toBe(
      MEMORY_EXTRACTION_QUEUE_LIMIT,
    );

    const diagnostics: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      diagnostics.push(String(args[0] ?? ''));
    });
    const runId = startRun(world, world.layout.a1, '按回款金额口径核对本月收入并给出结论。');
    await waitForCompletion(world, runId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    warnSpy.mockRestore();
    // 排队失败只留一条安全诊断：主 Run 的终态、作业行与候选都必须不受影响。
    expect(statusOf(world, runId)).toBe('completed');
    expect(
      diagnostics.some((line) => line.includes('提炼未入队') && line.includes('QUEUE_FULL')),
    ).toBe(true);
    expect(
      world.services.store.memoryExtractions.listPage({
        workspaceId: workspaceA,
        taskId: world.layout.a1.taskId,
      }).items,
    ).toEqual([]);
    expect(world.services.store.memoryExtractions.queuedCount()).toBe(
      MEMORY_EXTRACTION_QUEUE_LIMIT,
    );
    expect(memoriesOf(world, workspaceA)).toEqual([]);
  });

  it('投影目录故障时仍按 SQLite 召回，重建请求可见地报失败', async () => {
    const world = await createWorld({ projectionBlocked: true });
    const rule = '收入按回款金额统计，不使用签约金额。';
    const created = await world.services.memories.create({
      operationId: randomUUID(),
      content: rule,
      facet: 'decision',
      topicKey: '统计口径',
      scope: { kind: 'workspace', workspaceId: world.layout.workspaceA },
      asUserInstruction: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.commit).toBe('committed');
    expect(created.data.projectionState).toBe('failed');
    expect(created.warnings.map((warning) => warning.code)).toContain('PROJECTION_PENDING');

    const runId = startRun(world, world.layout.a1, '按回款金额口径核对本月收入。');
    await waitForCompletion(world, runId);
    expect(mentions(lastRunRequest(world), rule)).toBe(true);

    const rebuild = await world.services.memories.rebuildProjection({
      operationId: randomUUID(),
    });
    expect(rebuild.ok).toBe(true);
    if (!rebuild.ok) return;
    expect(rebuild.data.projectionState).toBe('failed');
  });

  it('改造前的旧运行只报 legacy_unknown，不伪造请求哈希', async () => {
    const world = await createWorld();
    const legacyRunId = 'legacy-run-before-memory';
    world.services.store.runs.create({
      id: legacyRunId,
      taskId: world.layout.a1.taskId,
      sessionId: world.layout.a1.sessionId,
      prompt: '改造前的旧运行',
      status: 'completed',
      createdAt: 1,
      completedAt: 2,
    });

    expect(world.services.store.runMemoryContexts.phaseOf(legacyRunId)).toBe('legacy_unknown');
    const result = world.services.recall.runContext({ runId: legacyRunId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.phase).toBe('legacy_unknown');
    expect(result.data.context).toBeUndefined();
    expect(result.data.reads).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toContain('SOURCE_NEEDS_REVIEW');
  });

  it('助手回复派生的空间记录不能直接改成全局口径', async () => {
    const world = await createWorld();
    const runId = startRun(world, world.layout.a1, '按回款金额口径核对本月收入并给出结论。');
    await waitForCompletion(world, runId);
    const assistant = world.services.store.runs
      .listEvents(runId)
      .find((event) => event.type === 'message.completed');
    if (assistant?.type !== 'message.completed') throw new Error('替身模型必须产出一条助手消息。');

    const created = await world.services.memories.create({
      operationId: randomUUID(),
      content: '本月收入按回款金额口径统计。',
      facet: 'fact',
      scope: { kind: 'workspace', workspaceId: world.layout.workspaceA },
      asUserInstruction: false,
      sourceSelector: {
        kind: 'run-assistant',
        runId,
        eventId: assistant.id,
        start: 0,
        end: [...assistant.content].length,
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const memory = created.data.currentMemory;
    if (!memory) throw new Error('回执必须带回当前记忆。');
    expect(memory.provenance).toMatchObject({
      verification: 'verified',
      authority: 'derived',
    });

    const escalated = await world.services.memories.update({
      operationId: randomUUID(),
      id: memory.id,
      expectedRevision: memory.revision,
      patch: { scope: { kind: 'user' } },
    });
    expect(escalated.ok).toBe(false);
    if (escalated.ok) return;
    expect(escalated.error.code).toBe('WORKSPACE_FACT_CANNOT_BE_GLOBAL');
    expect(world.services.store.memories.get(memory.id)?.scope.kind).toBe('workspace');
  });
});
