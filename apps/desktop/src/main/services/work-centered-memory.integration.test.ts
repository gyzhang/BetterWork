import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  CreateMemoryRequest,
  MemoryJobSummary,
  MemoryRecord,
  MemoryScope,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import {
  MEMORY_EXTRACTION_QUEUE_LIMIT,
  MEMORY_SUGGESTION_CONSENT_VERSION,
  memoryRecallPolicyV1,
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
  input: {
    content: string;
    facet: 'goal' | 'constraint' | 'decision' | 'fact' | 'method' | 'preference';
    topicKey?: string;
  },
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

  it('保留来源的保存继承运行的材料与记忆依赖，缺审计记录与非最终事件被拒绝', async () => {
    const world = await createWorld();
    // 选了材料就必须真读：让替身模型走一次 read_text_file，Run 才能进到 completed 终态。
    world.script.readsMaterials = true;
    const scope: MemoryScope = { kind: 'workspace', workspaceId: world.layout.workspaceA };
    await confirmMemory(world, scope, {
      content: '金额按万元保留两位。',
      facet: 'preference',
    });
    const material = await addMaterial(
      world,
      '收入口径说明.md',
      '收入按回款金额统计，不使用签约金额。',
    );
    const context = saveContext(world, world.layout.a1, {
      materials: [material],
      excludedMemoryIds: [],
    });
    const runId = startRun(world, world.layout.a1, '请汇总本月收入并给出万元口径结论。', context);
    await waitForCompletion(world, runId);
    const events = world.services.store.runs.listEvents(runId);
    const finalEvent = [...events].reverse().find((event) => event.type === 'message.completed');
    if (!finalEvent || finalEvent.type !== 'message.completed') {
      throw new Error('运行缺少最终回答事件。');
    }
    const answerLength = [...finalEvent.content].length;
    const operationId = randomUUID();
    const request: CreateMemoryRequest = {
      operationId,
      content: '汇总收入前先核对回款口径与单位。',
      facet: 'method',
      scope,
      asUserInstruction: false,
      sourceSelector: {
        kind: 'run-assistant',
        runId,
        eventId: finalEvent.id,
        start: 0,
        end: Math.min(8, answerLength),
      },
    };
    const result = await world.services.memories.create(request);
    if (!result.ok) throw new Error(`来源保存失败：${result.error.code} ${result.error.message}`);
    const revisionId = result.data.committedRevisionIds[0];
    if (revisionId === undefined) throw new Error('修订未落库。');
    const record = world.services.store.memories.getRevision(revisionId);
    if (!record) throw new Error('记忆修订不存在。');
    const provenance = record.provenance;
    if (provenance.verification !== 'verified') throw new Error('来源应为已核验派生。');
    expect(provenance.authority).toBe('derived');
    // 依赖等式：新记忆继承该运行「直接＋传递」并集，不裁剪也不新增。
    const union = world.services.store.runMemoryContexts.listDependencyUnion(runId);
    expect(new Set(provenance.memoryDependencies.map((item) => item.revisionId))).toEqual(
      new Set(union.memories.map((item) => item.revisionId)),
    );
    const savedKeys = new Set(provenance.materialDependencies.map((item) => item.contentHash));
    for (const reference of union.materials) {
      expect(savedKeys.has(reference.contentHash)).toBe(true);
    }
    for (const selected of world.services.store.runContextSnapshots.get(runId)?.materials ?? []) {
      expect(savedKeys.has(selected.reference.contentHash)).toBe(true);
    }
    // 同 operationId 原样重试只落一次；换正文必须失败。
    const replayed = await world.services.memories.create(request);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    // 同 operationId 原样重放只回同一份回执，不追加修订。
    expect(replayed.data.committedRevisionIds).toEqual(result.data.committedRevisionIds);
    const mutated = await world.services.memories.create({ ...request, content: '换一个正文。' });
    expect(mutated.ok).toBe(false);
    if (mutated.ok) return;
    expect(mutated.error.code).toBe('IDEMPOTENCY_CONFLICT');

    const started = events.find((event) => event.type === 'run.started');
    if (!started) throw new Error('缺少非最终事件。');
    const wrongEvent = await world.services.memories.create({
      ...request,
      operationId: randomUUID(),
      sourceSelector: {
        kind: 'run-assistant',
        runId,
        eventId: started.id,
        start: 0,
        end: 4,
      },
    });
    expect(wrongEvent.ok).toBe(false);
    if (wrongEvent.ok) return;
    expect(wrongEvent.error.code).toBe('SOURCE_UNAVAILABLE');

    // 有终态但没有准备快照/记忆审计的旧运行：不能当成「零依赖」保存。
    const orphanRunId = randomUUID();
    world.services.store.runs.create({
      id: orphanRunId,
      taskId: world.layout.a1.taskId,
      sessionId: world.layout.a1.sessionId,
      prompt: '没有准备快照的完成运行',
      status: 'completed',
      createdAt: Date.now(),
    });
    world.services.store.runs.appendEvent({
      id: 'orphan-answer-event',
      runId: orphanRunId,
      sequence: 1,
      createdAt: Date.now(),
      type: 'message.completed',
      messageId: 'orphan-message',
      content: '孤立运行的回答正文。',
    });
    const orphanEvents = world.services.store.runs.listEvents(orphanRunId);
    const orphanAnswer = orphanEvents.find((event) => event.type === 'message.completed');
    if (!orphanAnswer || orphanAnswer.type !== 'message.completed') {
      throw new Error('孤立事件未落库。');
    }
    const orphan = await world.services.memories.create({
      ...request,
      operationId: randomUUID(),
      sourceSelector: {
        kind: 'run-assistant',
        runId: orphanRunId,
        eventId: orphanAnswer.id,
        start: 0,
        end: 4,
      },
    });
    expect(orphan.ok).toBe(false);
    if (orphan.ok) return;
    expect(orphan.error.code).toBe('SOURCE_REVIEW_REQUIRED');
    // 拒绝路径零写入：该正文没有产生新修订。
    expect(
      world.services.store.memories
        .list({ workspaceId: world.layout.workspaceA })
        .filter((item) => item.content === '汇总收入前先核对回款口径与单位。'),
    ).toHaveLength(1);
    world.services.store.close();
    world.services.vault.close();
  });

  it('派生来源不能落到全局范围，摘录超限在 Main 侧先拒绝', async () => {
    const world = await createWorld();
    const runId = startRun(world, world.layout.a1, '按回款金额口径核对本月收入并给出结论。');
    await waitForCompletion(world, runId);
    const events = world.services.store.runs.listEvents(runId);
    const finalEvent = [...events].reverse().find((event) => event.type === 'message.completed');
    if (!finalEvent || finalEvent.type !== 'message.completed') {
      throw new Error('运行缺少最终回答事件。');
    }
    const selector = {
      kind: 'run-assistant',
      runId,
      eventId: finalEvent.id,
      start: 0,
      end: Math.min(4, [...finalEvent.content].length),
    } as const;
    const global = await world.services.memories.create({
      operationId: randomUUID(),
      content: '派生内容不能声明为全局口径。',
      facet: 'method',
      scope: { kind: 'user' },
      asUserInstruction: false,
      genericDeclaration: true,
      sourceSelector: selector,
    });
    expect(global.ok).toBe(false);
    if (global.ok) return;
    expect(global.error.code).toBe('GLOBAL_SCOPE_REQUIRES_DECLARATION');

    const long = await world.services.memories.create({
      operationId: randomUUID(),
      content: '超出摘录上限的保存必须被拒绝。',
      facet: 'method',
      scope: { kind: 'workspace', workspaceId: world.layout.workspaceA },
      asUserInstruction: false,
      sourceSelector: { ...selector, start: 0, end: 501 },
    });
    expect(long.ok).toBe(false);
    if (long.ok) return;
    expect(long.error.code).toBe('SOURCE_MISMATCH');

    world.services.store.close();
    world.services.vault.close();
  });

  // ===== MI09 离线联合回归：Q1–Q8 问法矩阵与关键正负例（契约 §11.3–§11.4） =====
  const RULE = '金额按万元保留两位。';
  const PINNED_PROMPTS = [
    '做份经营回顾',
    '请整理本季简报',
    '准备董事会汇报提纲',
    '输出经营分析',
    '撰写本期摘要',
    '做一版管理层汇报',
    '整理财务概览',
    '请汇总近期业务表现',
  ] as const;

  const pinRule = async (
    world: World,
    content = RULE,
    overrides: { facet?: 'constraint' | 'method' | 'preference'; validUntil?: number } = {},
  ): Promise<{ id: string; revision: number; revisionId: string }> => {
    const scope: MemoryScope = { kind: 'workspace', workspaceId: world.layout.workspaceA };
    const created = await world.services.memories.create({
      operationId: randomUUID(),
      content,
      facet: overrides.facet ?? 'constraint',
      scope,
      asUserInstruction: true,
      ...(overrides.validUntil === undefined ? {} : { validUntil: overrides.validUntil }),
    });
    if (!created.ok) throw new Error(`规则写入失败：${created.error.code}`);
    const revisionId = created.data.committedRevisionIds[0];
    if (revisionId === undefined) throw new Error('缺少修订。');
    const record = world.services.store.memories.getRevision(revisionId);
    if (!record) throw new Error('修订未落库。');
    const pinned = await world.services.memories.update({
      operationId: randomUUID(),
      id: record.id,
      expectedRevision: record.revision,
      patch: { recallPolicy: 'pinned' },
    });
    if (!pinned.ok) throw new Error(`设优先失败：${pinned.error.code}`);
    const latest = world.services.store.memories.get(record.id);
    if (!latest) throw new Error('优先修订未落库。');
    return { id: latest.id, revision: latest.revision, revisionId: latest.revisionId };
  };

  it('Q1–Q8 八种无词面问法都经生产发送链路带入优先规则，且词面分数如实为 0', async () => {
    const world = await createWorld();
    const rule = await pinRule(world);
    // 对照前提：同样合法但没有设优先的规则，零词面命中时必须不入选——
    // 否则「免词面」就成了对所有记忆的放行，矩阵 §5.0 的断言也就没有意义。
    const control = await confirmMemory(
      world,
      { kind: 'workspace', workspaceId: world.layout.workspaceA },
      {
        content: '对照口径：按千元列示。',
        facet: 'constraint',
      },
    );
    // §5.0 的前提是「材料标题不补查询关键词」，不是「没有材料」：挂一份标题与目标规则
    // 零 bigram 重叠的真实材料，让前提在非零查询宽度上成立。
    const material = await addMaterial(world, '季度经营数据.md', '本期收入合计 128。');

    for (const [index, prompt] of PINNED_PROMPTS.entries()) {
      const task = world.services.store.tasks.create(
        world.layout.workspaceA,
        `Q${index + 1} 经营交付`,
        prompt,
      );
      const context = saveContext(
        world,
        { taskId: task.task.id, sessionId: task.sessionId },
        {
          materials: [material],
          excludedMemoryIds: [],
        },
      );
      const runId = startRun(
        world,
        { taskId: task.task.id, sessionId: task.sessionId },
        prompt,
        context,
      );
      await waitForCompletion(world, runId);

      // 断言落到实际 ModelRequest，而不是只看选择结果。
      expect(mentions(lastRunRequest(world), RULE), prompt).toBe(true);
      const audit = world.services.store.runMemoryContexts.get(runId);
      const selected = audit?.selectedItems.find((item) => item.memoryId === rule.id);
      expect(selected?.reason, prompt).toBe('pinned-rule');
      expect(selected?.score, prompt).toBe(0);
      expect(audit?.recallVersion, prompt).toBe('memory-recall-v2');
      // 同一次运行里，未设优先且零词面命中的合法规则不得混进来，且要有可解释原因。
      expect(
        (audit?.selectedItems ?? []).some((item) => item.memoryId === control.id),
        prompt,
      ).toBe(false);
      expect(mentions(lastRunRequest(world), '对照口径：按千元列示。'), prompt).toBe(false);
      expect(
        audit?.decisionSummary.exclusions
          .find((entry) => entry.reason === 'not-relevant')
          ?.identities.map((entry) => entry.memoryId),
        prompt,
      ).toContain(control.id);

      // 矩阵 §5.0 要的是「preview 与实际请求都带」：只断言请求侧会漏掉预览那条同口径承诺。
      const preview = world.services.recall.preview({
        taskId: task.task.id,
        taskContextRevisionId: context.id,
        expectedTaskContextRevision: context.revision,
        prompt,
      });
      expect(preview.ok, prompt).toBe(true);
      if (!preview.ok) continue;
      const previewSelected = preview.data.selectedItems.find(
        (entry) => entry.memoryId === rule.id,
      );
      expect(previewSelected?.reason, prompt).toBe('pinned-rule');
      expect(previewSelected?.score, prompt).toBe(0);
      expect(preview.data.policySnapshot.recallVersion, prompt).toBe('memory-recall-v2');
    }
  });

  it('N1 排除优先父规则后，派生记忆与继承历史都不回流', async () => {
    const world = await createWorld();
    const rule = await pinRule(world);
    const first = world.layout.a1;
    const firstContext = saveContext(world, first, { materials: [], excludedMemoryIds: [] });
    const firstRun = startRun(world, first, '请按金额按万元保留两位汇总本月收入', firstContext);
    await waitForCompletion(world, firstRun);
    expect(mentions(lastRunRequest(world), RULE)).toBe(true);

    // 派生记忆经正常回答捕获建立，不伪造事件 ID 或外键。
    const answer = world.services.store.runs
      .listEvents(firstRun)
      .filter((event) => event.type === 'message.completed')
      .at(-1);
    if (!answer || answer.type !== 'message.completed') throw new Error('缺少最终回答事件。');
    const derived = await world.services.memories.create({
      operationId: randomUUID(),
      content: '复盘时先统一金额单位再比较。',
      facet: 'method',
      scope: { kind: 'workspace', workspaceId: world.layout.workspaceA },
      asUserInstruction: false,
      sourceSelector: {
        kind: 'run-assistant',
        runId: firstRun,
        eventId: answer.id,
        start: 0,
        end: 4,
      },
    });
    expect(derived.ok).toBe(true);

    const excluded = world.services.store.taskContexts.save(first.taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      materials: [],
      excludedMemoryIds: [rule.id],
    });
    const secondRun = startRun(world, first, '请出本期结论并给出下一期动作', excluded);
    await waitForCompletion(world, secondRun);
    // 只看宿主注入给模型的历史与记忆段：本轮 prompt 本身允许出现同一句话。
    const injected = (lastRunRequest(world)?.messages ?? [])
      .filter((message) => message.role !== 'user')
      .map((message) => message.content)
      .join('\n');
    expect(injected).not.toContain(RULE);
    expect(injected).not.toContain('复盘时先统一金额单位再比较。');
    const audit = world.services.store.runMemoryContexts.get(secondRun);
    expect(audit?.selectedItems.map((item) => item.memoryId)).not.toContain(rule.id);
  });

  it('N3 过期的优先规则不注入，N7 未裁决冲突也不按时间挑胜者', async () => {
    const world = await createWorld();
    const expired = await pinRule(world, '过期规则不再带入。');
    const expiredResult = await world.services.memories.setStatus({
      operationId: randomUUID(),
      id: expired.id,
      expectedRevision: expired.revision,
      action: 'expire',
    });
    expect(expiredResult.ok).toBe(true);
    const task = world.services.store.tasks.create(
      world.layout.workspaceA,
      '过期与冲突',
      '请汇总近期业务表现',
    );
    const context = saveContext(
      world,
      { taskId: task.task.id, sessionId: task.sessionId },
      {
        materials: [],
        excludedMemoryIds: [],
      },
    );
    const runId = startRun(
      world,
      { taskId: task.task.id, sessionId: task.sessionId },
      '请汇总近期业务表现',
      context,
    );
    await waitForCompletion(world, runId);
    expect(mentions(lastRunRequest(world), '过期规则不再带入。')).toBe(false);
    const audit = world.services.store.runMemoryContexts.get(runId);
    expect(audit?.selectedItems.map((item) => item.memoryId)).not.toContain(expired.id);
    expect(mentions(lastRunRequest(world), '过期规则不再带入。')).toBe(false);

    const left = await confirmMemory(
      world,
      { kind: 'workspace', workspaceId: world.layout.workspaceA },
      {
        content: '经营月报统一用万元。',
        facet: 'decision',
        topicKey: 'monthly-unit',
      },
    );
    const right = await confirmMemory(
      world,
      { kind: 'workspace', workspaceId: world.layout.workspaceA },
      {
        content: '经营月报统一用元。',
        facet: 'decision',
        topicKey: 'monthly-unit',
      },
    );
    const conflicted = await world.services.memories.update({
      operationId: randomUUID(),
      id: left.id,
      expectedRevision: left.revision,
      patch: { recallPolicy: 'pinned' },
    });
    expect(conflicted.ok).toBe(true);
    const pinnedRun = startRun(
      world,
      { taskId: task.task.id, sessionId: task.sessionId },
      '请出经营月报统一用万元的口径结论',
      world.services.store.taskContexts.save(task.task.id, {
        executor: { kind: 'general' },
        skillBindings: [],
        materials: [],
        excludedMemoryIds: [],
      }),
    );
    await waitForCompletion(world, pinnedRun);
    const after = world.services.store.runMemoryContexts.get(pinnedRun);
    // 未裁决冲突挡住相关规则：不注入任何一侧，也不按更新时间或置信度挑胜者。
    expect(after?.selectedItems.map((item) => item.memoryId)).not.toContain(left.id);
    expect(after?.selectedItems.map((item) => item.memoryId)).not.toContain(right.id);
  });

  it('R6 一个优先与两条相关并存时整组带入且条件齐全', async () => {
    const world = await createWorld();
    const scope: MemoryScope = { kind: 'workspace', workspaceId: world.layout.workspaceA };
    const mainCreated = await world.services.memories.create({
      operationId: randomUUID(),
      content: '经营月报先给结论。',
      facet: 'constraint',
      scope,
      topicKey: 'report-opening',
      asUserInstruction: true,
    });
    if (!mainCreated.ok) throw new Error(`主规则写入失败：${mainCreated.error.code}`);
    const mainRevisionId = mainCreated.data.committedRevisionIds[0];
    const mainCreatedRecord =
      mainRevisionId === undefined
        ? undefined
        : world.services.store.memories.getRevision(mainRevisionId);
    if (!mainCreatedRecord) throw new Error('主规则未落库。');
    const mainPinned = await world.services.memories.update({
      operationId: randomUUID(),
      id: mainCreatedRecord.id,
      expectedRevision: mainCreatedRecord.revision,
      patch: { recallPolicy: 'pinned' },
    });
    if (!mainPinned.ok) throw new Error(`主规则设优先失败：${mainPinned.error.code}`);
    const mainRecord = world.services.store.memories.get(mainCreatedRecord.id);
    if (!mainRecord) throw new Error('主规则修订缺失。');
    const main = { id: mainRecord.id, revision: mainRecord.revision };
    const companion = await confirmMemory(world, scope, {
      content: '经营月报先给结论再列证据。',
      facet: 'decision',
      topicKey: 'report-opening',
    });
    const resolved = await world.services.memories.resolveConflict({
      operationId: randomUUID(),
      left: { id: main.id, expectedRevision: main.revision },
      right: { id: companion.id, expectedRevision: companion.revision },
      decision: 'keep-both',
      applicabilityNote: '内部简报只要结论，对外汇报要结论加证据。',
    });
    expect(resolved.ok).toBe(true);

    const task = world.services.store.tasks.create(
      world.layout.workspaceA,
      '并存组',
      '请整理本季简报',
    );
    const context = saveContext(
      world,
      { taskId: task.task.id, sessionId: task.sessionId },
      {
        materials: [],
        excludedMemoryIds: [],
      },
    );
    const runId = startRun(
      world,
      { taskId: task.task.id, sessionId: task.sessionId },
      '请整理本季简报',
      context,
    );
    await waitForCompletion(world, runId);
    const selected = world.services.store.runMemoryContexts.get(runId)?.selectedItems ?? [];
    expect(new Set(selected.map((item) => item.memoryId))).toEqual(
      new Set([main.id, companion.id]),
    );
    expect(selected.every((item) => item.reason === 'pinned-rule')).toBe(true);
    // 并存说明随整组一起注入，缺一侧就不算整组带入。
    const injectedBlock = (lastRunRequest(world)?.messages ?? [])
      .map((message) => message.content)
      .join('\n');
    expect(injectedBlock).toContain('内部简报只要结论，对外汇报要结论加证据。');
  });

  /**
   * 矩阵 N8（请求级）：并存分量只要含一条优先就整体属于优先池，装不下就整组落选；
   * 关键反证是「词面本来就命中的那条成员」不得改走相关池绕开优先池上限。
   */
  it('N8 超预算的优先并存组整组不入选，词面命中也不绕过上限', async () => {
    const world = await createWorld();
    const scope: MemoryScope = { kind: 'workspace', workspaceId: world.layout.workspaceA };
    const pad = (head: string, total: number): string =>
      head + '径'.repeat(total - [...head].length);
    const companionText = pad('经营回顾时统一收入口径：', 1_100);

    // 对照组：这条记忆词面确实可被召回，否则后面的断言只是空跑。
    const companion = await confirmMemory(world, scope, {
      content: companionText,
      facet: 'method',
      topicKey: 'income-unit',
    });
    const controlTask = world.services.store.tasks.create(
      world.layout.workspaceA,
      'N8 对照',
      '做份经营回顾',
    );
    const controlRef = {
      taskId: controlTask.task.id,
      sessionId: controlTask.sessionId,
    };
    const controlContext = saveContext(world, controlRef, {
      materials: [],
      excludedMemoryIds: [],
    });
    const controlRun = startRun(world, controlRef, '做份经营回顾', controlContext);
    await waitForCompletion(world, controlRun);
    expect(mentions(lastRunRequest(world), '经营回顾时统一收入口径：')).toBe(true);
    expect(
      world.services.store.runMemoryContexts
        .get(controlRun)
        ?.selectedItems.map((item) => item.memoryId),
    ).toContain(companion.id);

    // 加入一条同议题的优先规则并判定并存：整组进入优先池，两条正文合计超过 2,000 码点。
    const pinned = await confirmMemory(world, scope, {
      content: pad('经营回顾金额按万元保留两位：', 1_100),
      facet: 'decision',
      topicKey: 'income-unit',
    });
    const pinnedCurrent = world.services.store.memories.get(pinned.id);
    if (!pinnedCurrent) throw new Error('优先规则未落库。');
    const setPinned = await world.services.memories.update({
      operationId: randomUUID(),
      id: pinnedCurrent.id,
      expectedRevision: pinnedCurrent.revision,
      patch: { recallPolicy: 'pinned' },
    });
    if (!setPinned.ok) throw new Error(`设优先失败：${setPinned.error.code}`);
    const afterPin = world.services.store.memories.get(pinnedCurrent.id);
    if (!afterPin) throw new Error('优先修订缺失。');
    const decided = await world.services.memories.resolveConflict({
      operationId: randomUUID(),
      left: { id: pinned.id, expectedRevision: afterPin.revision },
      right: { id: companion.id, expectedRevision: companion.revision },
      decision: 'keep-both',
      applicabilityNote: '内部回顾只看金额口径。',
    });
    expect(decided.ok).toBe(true);

    const task = world.services.store.tasks.create(
      world.layout.workspaceA,
      'N8 整组落选',
      '做份经营回顾',
    );
    const taskRef = { taskId: task.task.id, sessionId: task.sessionId };
    const context = saveContext(world, taskRef, { materials: [], excludedMemoryIds: [] });
    const runId = startRun(world, taskRef, '做份经营回顾', context);
    await waitForCompletion(world, runId);

    const audit = world.services.store.runMemoryContexts.get(runId);
    const selectedIds = new Set((audit?.selectedItems ?? []).map((item) => item.memoryId));
    expect(selectedIds.has(pinned.id)).toBe(false);
    expect(selectedIds.has(companion.id)).toBe(false);
    const injected = (lastRunRequest(world)?.messages ?? [])
      .filter((message) => message.role !== 'user')
      .map((message) => message.content)
      .join('\n');
    expect(injected).not.toContain('经营回顾时统一收入口径：');
    expect(injected).not.toContain('经营回顾金额按万元保留两位：');
    // 落选原因必须是预算，且两条都在同一批里；不能把词面命中那条改记成「不相关」。
    const budget = audit?.decisionSummary.exclusions.find((entry) => entry.reason === 'budget');
    expect(new Set((budget?.identities ?? []).map((entry) => entry.memoryId))).toEqual(
      new Set([pinned.id, companion.id]),
    );
    expect(
      audit?.decisionSummary.exclusions
        .find((entry) => entry.reason === 'not-relevant')
        ?.identities.map((entry) => entry.memoryId) ?? [],
    ).not.toContain(companion.id);
  });

  it('R3/R7 无需历史即可带入最新优先修订，旧运行回看不变', async () => {
    const world = await createWorld();
    const scope: MemoryScope = { kind: 'user' };
    const created = await world.services.memories.create({
      operationId: randomUUID(),
      content: '给出表格后附限制说明。',
      facet: 'preference',
      scope,
      asUserInstruction: true,
      genericDeclaration: true,
    });
    if (!created.ok) throw new Error(`偏好写入失败：${created.error.code}`);
    const firstRevisionId = created.data.committedRevisionIds[0];
    const firstRecord =
      firstRevisionId === undefined
        ? undefined
        : world.services.store.memories.getRevision(firstRevisionId);
    if (!firstRecord) throw new Error('偏好未落库。');
    const pinned = await world.services.memories.update({
      operationId: randomUUID(),
      id: firstRecord.id,
      expectedRevision: firstRecord.revision,
      patch: { recallPolicy: 'pinned' },
    });
    if (!pinned.ok) throw new Error(`设优先失败：${pinned.error.code}`);

    // R3：新 Task、无历史，仅凭优先池入选。
    const task = world.services.store.tasks.create(
      world.layout.workspaceA,
      'R3 表格偏好',
      '请整理财务概览',
    );
    const taskRef = { taskId: task.task.id, sessionId: task.sessionId };
    const firstRun = startRun(
      world,
      taskRef,
      '请整理财务概览',
      saveContext(world, taskRef, { materials: [], excludedMemoryIds: [] }),
    );
    await waitForCompletion(world, firstRun);
    expect(mentions(lastRunRequest(world), '给出表格后附限制说明。')).toBe(true);
    const beforeRevision = world.services.store.runMemoryContexts
      .get(firstRun)
      ?.selectedItems.find((item) => item.memoryId === firstRecord.id)?.revisionId;

    // R7：改为新修订并重新设优先，新任务只注入最新修订，旧运行审计不变。
    const current = world.services.store.memories.get(firstRecord.id);
    if (!current) throw new Error('记录缺失。');
    const reworded = await world.services.memories.update({
      operationId: randomUUID(),
      id: firstRecord.id,
      expectedRevision: current.revision,
      patch: { content: '给出表格后附限制说明与数据截止日期。', recallPolicy: 'pinned' },
    });
    expect(reworded.ok).toBe(true);
    const secondRun = startRun(world, taskRef, '请整理财务概览', {
      id: saveContext(world, taskRef, { materials: [], excludedMemoryIds: [] }).id,
      revision: (world.services.store.taskContexts.getLatest(task.task.id) ?? { revision: 0 })
        .revision,
    });
    await waitForCompletion(world, secondRun);
    const injected = (lastRunRequest(world)?.messages ?? [])
      .filter((message) => message.role !== 'user')
      .map((message) => message.content)
      .join('\n');
    expect(injected).toContain('给出表格后附限制说明与数据截止日期。');
    expect(injected).not.toContain('给出表格后附限制说明。\n');
    expect(
      world.services.store.runMemoryContexts
        .get(firstRun)
        ?.selectedItems.find((item) => item.memoryId === firstRecord.id)?.revisionId,
    ).toBe(beforeRevision);
  });

  it('N2 父规则被删除后，派生记忆不再带入也不擦除依赖', async () => {
    const world = await createWorld();
    const scope: MemoryScope = { kind: 'workspace', workspaceId: world.layout.workspaceA };
    const parent = await confirmMemory(world, scope, {
      content: '金额按万元保留两位。',
      facet: 'preference',
    });
    const runId = startRun(
      world,
      world.layout.a1,
      '请按金额按万元保留两位汇总本月收入',
      saveContext(world, world.layout.a1, { materials: [], excludedMemoryIds: [] }),
    );
    await waitForCompletion(world, runId);
    const answer = world.services.store.runs
      .listEvents(runId)
      .filter((event) => event.type === 'message.completed')
      .at(-1);
    if (!answer || answer.type !== 'message.completed') throw new Error('缺少最终回答。');
    const derived = await world.services.memories.create({
      operationId: randomUUID(),
      content: '复盘时先统一金额单位。',
      facet: 'method',
      scope,
      asUserInstruction: false,
      sourceSelector: {
        kind: 'run-assistant',
        runId,
        eventId: answer.id,
        start: 0,
        end: 4,
      },
    });
    expect(derived.ok).toBe(true);
    const derivedRevisionId = derived.ok ? derived.data.committedRevisionIds[0] : undefined;
    const derivedRecord =
      derivedRevisionId === undefined
        ? undefined
        : world.services.store.memories.getRevision(derivedRevisionId);
    if (!derivedRecord) throw new Error('派生记忆未落库。');
    const dependenciesBefore =
      derivedRecord.provenance.verification === 'verified'
        ? derivedRecord.provenance.memoryDependencies.length
        : 0;
    expect(dependenciesBefore).toBeGreaterThan(0);

    const deleted = await world.services.memories.setStatus({
      operationId: randomUUID(),
      id: parent.id,
      expectedRevision: parent.revision,
      action: 'delete',
    });
    expect(deleted.ok).toBe(true);

    const secondRun = startRun(world, world.layout.a2, '请出本期经营分析', {
      id: saveContext(world, world.layout.a2, { materials: [], excludedMemoryIds: [] }).id,
      revision: (
        world.services.store.taskContexts.getLatest(world.layout.a2.taskId) ?? {
          revision: 0,
        }
      ).revision,
    });
    await waitForCompletion(world, secondRun);
    const injected = (lastRunRequest(world)?.messages ?? [])
      .filter((message) => message.role !== 'user')
      .map((message) => message.content)
      .join('\n');
    expect(injected).not.toContain('复盘时先统一金额单位。');
    // 依赖不擦除：仍登记原父修订引用，由门禁拒绝带入而不是抹掉证据链。
    const after = world.services.store.memories.getRevision(derivedRecord.revisionId);
    expect(
      after?.provenance.verification === 'verified'
        ? after.provenance.memoryDependencies.length
        : 0,
    ).toBe(dependenciesBefore);
  });

  it('AC3 崩溃重启后旧 v1 审计原样可读，新策略字段不强塞历史', async () => {
    const world = await createWorld();
    const legacyRunId = 'mi09-legacy-v1-run';
    world.services.store.runs.create({
      id: legacyRunId,
      taskId: world.layout.a1.taskId,
      sessionId: world.layout.a1.sessionId,
      prompt: '改造前的旧运行',
      status: 'completed',
      createdAt: 1,
      completedAt: 2,
    });
    world.services.store.runMemoryContexts.recordSelection({
      runId: legacyRunId,
      evaluatedAt: 3,
      queryHash: 'e'.repeat(64),
      policySnapshot: memoryRecallPolicyV1,
      selectedItems: [
        {
          memoryId: 'legacy-memory',
          revisionId: 'legacy-revision',
          contentHash: 'f'.repeat(64),
          order: 1,
          score: 500,
          reason: 'task-relevant',
        },
      ],
      decisionSummary: {
        budget: {
          totalItems: 1,
          preferenceItems: 0,
          contentCodePoints: 9,
          wrapperCodePoints: 20,
          blockCodePoints: 29,
        },
        exclusions: [],
        queryTruncated: false,
        conflictReviewRequired: false,
      },
      authorizationHash: 'a'.repeat(64),
      selectedAt: 3,
    });

    const reopened = restartWorld(world);
    expect(reopened).toBeGreaterThanOrEqual(0);
    const context = world.services.store.runMemoryContexts.get(legacyRunId);
    expect(context?.recallVersion).toBe('memory-recall-v1');
    expect(context?.policySnapshot.algorithmVersion).toBe(1);
    expect(context?.selectedItems[0]?.reason).toBe('task-relevant');
    // 旧行不被回填新字段：读取仍按冻结的 v1 形状解析。
    expect(context !== undefined && Object.hasOwn(context.policySnapshot, 'pinnedItemLimit')).toBe(
      false,
    );
    const read = world.services.recall.runContext({ runId: legacyRunId });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data.context?.recallVersion).toBe('memory-recall-v1');
  });

  const pinInScope = async (
    world: World,
    scope: MemoryScope,
    content: string,
    facet: 'constraint' | 'method' | 'preference' | 'decision',
  ): Promise<{ id: string; revision: number }> => {
    const created = await world.services.memories.create({
      operationId: randomUUID(),
      content,
      facet,
      scope,
      asUserInstruction: true,
      ...(scope.kind === 'user' || scope.kind === 'expert' ? { genericDeclaration: true } : {}),
    });
    if (!created.ok) throw new Error(`规则写入失败：${created.error.code}`);
    const revisionId = created.data.committedRevisionIds[0];
    const record =
      revisionId === undefined ? undefined : world.services.store.memories.getRevision(revisionId);
    if (!record) throw new Error('规则未落库。');
    const pinned = await world.services.memories.update({
      operationId: randomUUID(),
      id: record.id,
      expectedRevision: record.revision,
      patch: { recallPolicy: 'pinned' },
    });
    if (!pinned.ok) throw new Error(`设优先失败：${pinned.error.code}`);
    return { id: record.id, revision: record.revision + 1 };
  };

  it('R2/R4 专家与专家工作空间的优先规则按范围带入，另一侧不泄露（N4）', async () => {
    const world = await createWorld();
    const expertScope: MemoryScope = { kind: 'expert', expertId: world.layout.expertId };
    const expertWorkspaceScope: MemoryScope = {
      kind: 'expert-workspace',
      expertId: world.layout.expertId,
      workspaceId: world.layout.workspaceA,
    };
    const otherWorkspaceScope: MemoryScope = {
      kind: 'expert-workspace',
      expertId: world.layout.expertId,
      workspaceId: world.layout.workspaceB,
    };
    const expertRule = await pinInScope(
      world,
      expertScope,
      '写给管理层的段落先给一句判断。',
      'method',
    );
    const workspaceRule = await pinInScope(
      world,
      expertWorkspaceScope,
      '结论、证据、建议依次输出。',
      'method',
    );
    const foreignRule = await pinInScope(
      world,
      otherWorkspaceScope,
      '另一个空间的内部口径不得跨范围带入。',
      'method',
    );

    const taskRef = { taskId: world.layout.a2.taskId, sessionId: world.layout.a2.sessionId };
    const context = saveContext(world, taskRef, { materials: [], excludedMemoryIds: [] });
    const runId = startRun(world, taskRef, '继续处理这件事', context);
    await waitForCompletion(world, runId);
    const injected = (lastRunRequest(world)?.messages ?? [])
      .filter((message) => message.role !== 'user')
      .map((message) => message.content)
      .join('\n');
    expect(injected).toContain('写给管理层的段落先给一句判断。');
    expect(injected).toContain('结论、证据、建议依次输出。');
    // N4：同专家但另一工作空间的优先规则既不注入，也不在请求里暴露正文。
    expect(injected).not.toContain('另一个空间的内部口径不得跨范围带入。');
    const selected = world.services.store.runMemoryContexts.get(runId)?.selectedItems ?? [];
    expect(new Set(selected.map((item) => item.memoryId))).toEqual(
      new Set([expertRule.id, workspaceRule.id]),
    );
    // R2 单独占一行，矩阵给它的是另一个问法：逐行分母要求这条 When 也真走过一次。
    const r2Task = world.services.store.tasks.create(
      world.layout.workspaceA,
      'R2 管理层沟通稿',
      '请整理下一场管理层沟通稿',
    );
    const r2Ref = { taskId: r2Task.task.id, sessionId: r2Task.sessionId };
    const r2Context = saveContext(world, r2Ref, { materials: [], excludedMemoryIds: [] });
    const r2Run = startRun(world, r2Ref, '请整理下一场管理层沟通稿', r2Context);
    await waitForCompletion(world, r2Run);
    const r2Injected = (lastRunRequest(world)?.messages ?? [])
      .filter((message) => message.role !== 'user')
      .map((message) => message.content)
      .join('\n');
    expect(r2Injected).toContain('结论、证据、建议依次输出。');
    expect(r2Injected).not.toContain('另一个空间的内部口径不得跨范围带入。');
    expect(
      world.services.store.runMemoryContexts.get(r2Run)?.selectedItems.map((item) => item.memoryId),
    ).toContain(workspaceRule.id);
    // N4 另一半：他空间规则只能以排除 ID 的占位分支出现，不回正文与来源。
    const excluding = world.services.store.taskContexts.save(taskRef.taskId, {
      executor: {
        kind: 'expert',
        expertId: world.layout.expertId,
        expertRevisionId: world.layout.expertRevisionId,
      },
      skillBindings: [],
      materials: [],
      excludedMemoryIds: [foreignRule.id],
    });
    const exclusions = world.services.recall.taskExclusions({
      taskId: taskRef.taskId,
      taskContextRevisionId: excluding.id,
      expectedTaskContextRevision: excluding.revision,
    });
    expect(exclusions.ok).toBe(true);
    if (!exclusions.ok) return;
    expect(exclusions.data.items).toEqual([
      { visibility: 'unavailable', memoryId: foreignRule.id },
    ]);
  });

  it('N5 派生记忆依赖的材料换版本后不再进入请求，源文件保持只读', async () => {
    const world = await createWorld();
    const first = await addMaterial(world, '收入口径.md', '收入按回款金额统计，不含签约金额。');
    const taskRef = world.layout.a1;
    const firstContext = saveContext(world, taskRef, {
      materials: [first],
      excludedMemoryIds: [],
    });
    world.script.readsMaterials = true;
    const firstRun = startRun(world, taskRef, '请按收入口径说明本月收入', firstContext);
    await waitForCompletion(world, firstRun);
    const answer = world.services.store.runs
      .listEvents(firstRun)
      .filter((event) => event.type === 'message.completed')
      .at(-1);
    if (!answer || answer.type !== 'message.completed') throw new Error('缺少最终回答。');
    const derived = await world.services.memories.create({
      operationId: randomUUID(),
      content: '复盘收入时先核对统计口径。',
      facet: 'method',
      scope: { kind: 'workspace', workspaceId: world.layout.workspaceA },
      asUserInstruction: false,
      sourceSelector: {
        kind: 'run-assistant',
        runId: firstRun,
        eventId: answer.id,
        start: 0,
        end: 4,
      },
    });
    expect(derived.ok).toBe(true);
    const derivedRevisionId = derived.ok ? derived.data.committedRevisionIds[0] : undefined;
    const derivedRecord =
      derivedRevisionId === undefined
        ? undefined
        : world.services.store.memories.getRevision(derivedRevisionId);
    if (!derivedRecord || derivedRecord.provenance.verification !== 'verified') {
      throw new Error('派生记忆未按预期登记依赖。');
    }
    expect(derivedRecord.provenance.materialDependencies.length).toBeGreaterThan(0);

    // 契约 §11.1：改写正文只是换口径重述，不得顺带解除已登记的资料依赖。
    const dependencyHashes = derivedRecord.provenance.materialDependencies.map(
      (entry) => entry.contentHash,
    );
    const restated = await world.services.memories.update({
      operationId: randomUUID(),
      id: derivedRecord.id,
      expectedRevision: derivedRecord.revision,
      patch: { content: '复盘收入时先统一统计口径再比较增减。' },
    });
    expect(restated.ok).toBe(true);
    const restatedRevisionId = restated.ok ? restated.data.committedRevisionIds[0] : undefined;
    const restatedRecord =
      restatedRevisionId === undefined
        ? undefined
        : world.services.store.memories.getRevision(restatedRevisionId);
    expect(restatedRecord?.provenance.verification).toBe('verified');
    expect(
      restatedRecord?.provenance.verification === 'verified'
        ? restatedRecord.provenance.materialDependencies.map((entry) => entry.contentHash)
        : undefined,
    ).toEqual(dependencyHashes);

    // 本期换成新材料：旧快照派生的经验不得再进入请求。
    const second = await addMaterial(world, '收入口径.md', '收入按签约金额统计。');
    const secondContext = saveContext(world, world.layout.a2, {
      materials: [second],
      excludedMemoryIds: [],
    });
    const secondRun = startRun(world, world.layout.a2, '请复盘收入并核对统计口径。', secondContext);
    await waitForCompletion(world, secondRun);
    const audit = world.services.store.runMemoryContexts.get(secondRun);
    expect(audit?.selectedItems.map((item) => item.memoryId)).not.toContain(derivedRecord.id);
    const excludedReasons = audit?.decisionSummary.exclusions.map((entry) => entry.reason) ?? [];
    expect(excludedReasons).toContain('dependency-unavailable');
    // 源文件只读：本卡只写过一次，验证内容仍是当前版本而不是被改坏。
    const onDisk = readFileSync(path.join(world.layout.rootA, '收入口径.md'), 'utf8');
    expect(onDisk).toBe('收入按签约金额统计。');
  });

  it('R8 换期：新材料＋精确成果结构参考＋自主方法同时成立，旧期数字不当默认事实', async () => {
    const world = await createWorld();
    const scope: MemoryScope = { kind: 'workspace', workspaceId: world.layout.workspaceA };
    // 上一期的成果版本：只固定它自己的精确引用与哈希，不跟随后续版本。
    const previousRun = randomUUID();
    world.services.store.runs.create({
      id: previousRun,
      taskId: world.layout.a1.taskId,
      sessionId: world.layout.a1.sessionId,
      prompt: '上期经营复盘',
      status: 'completed',
      createdAt: 1,
      completedAt: 2,
    });
    const legacy = world.services.store.artifacts.saveMarkdown(
      {
        taskId: world.layout.a1.taskId,
        title: '上期经营复盘',
        content: '# 上期结论\n\n上期收入 1.23 亿元。',
        origin: 'assistant-run',
        runId: previousRun,
      },
      'model',
    );
    const legacyDetail = world.services.store.artifacts.getDetail(legacy.id);
    if (!legacyDetail) throw new Error('上期成果未落库。');
    const legacyVersionId = legacyDetail.currentVersionId;
    const legacyVersion = world.services.store.artifacts.getVersionDetail(legacyVersionId);
    if (!legacyVersion || legacyVersion.type !== 'markdown') {
      throw new Error('上期成果版本不可精确读取。');
    }
    const legacyHash = legacyVersion.contentHash;

    const method = await pinInScope(world, scope, '分析先给一句结论，再列证据与建议。', 'method');
    const currentMaterial = await addMaterial(
      world,
      '本期数据.md',
      '本期收入 1.42 亿元，回款口径。',
    );
    const taskRef = world.layout.a2;
    const context = world.services.store.taskContexts.save(taskRef.taskId, {
      executor: {
        kind: 'expert',
        expertId: world.layout.expertId,
        expertRevisionId: world.layout.expertRevisionId,
      },
      skillBindings: [],
      materials: [
        currentMaterial,
        {
          reference: {
            kind: 'artifact-version',
            artifactId: legacy.id,
            artifactVersionId: legacyVersionId,
            contentHash: legacyHash,
            originWorkspaceId: world.layout.workspaceA,
          },
          purpose: 'structure-reference',
          addedFrom: 'expert-reference',
        },
      ],
      excludedMemoryIds: [],
    });
    const runId = startRun(world, taskRef, '请沿用上期结构输出本期经营复盘要点', {
      id: context.id,
      revision: context.revision,
    });
    await waitForCompletion(world, runId);

    // 自主方法经优先池带入；旧期数字不作为事实注入记忆块。
    const selected = world.services.store.runMemoryContexts.get(runId)?.selectedItems ?? [];
    expect(selected.map((item) => item.memoryId)).toContain(method.id);
    const memoryBlock = (lastRunRequest(world)?.messages ?? [])
      .map((message) => message.content)
      .find((content) => content.includes('长期记忆'));
    expect(memoryBlock ?? '').toContain('分析先给一句结论，再列证据与建议。');
    expect(memoryBlock ?? '').not.toContain('1.23 亿元');

    // 精确引用合法性：运行快照钉住的是那一版成果，不是 latest。
    const snapshot = world.services.store.runContextSnapshots.get(runId);
    const pinned = snapshot?.materials.find(
      (material) => material.reference.kind === 'artifact-version',
    );
    if (!pinned || pinned.reference.kind !== 'artifact-version') {
      throw new Error('本期任务没有钉住参考成果版本。');
    }
    expect(pinned.reference.artifactVersionId).toBe(legacyVersionId);
    expect(pinned.reference.contentHash).toBe(legacyHash);
    // 参考不等于已读取：本次没有真实读取该成果，因此不产生它的证据。
    const reads = world.services.store.materialReads.listByRun(runId);
    expect(reads.some((read) => read.material.kind === 'artifact-version')).toBe(false);
  });

  it('没有来源 Run 的讨论反馈用当前 TaskContext 钉住的模型，不暗换应用级默认', async () => {
    const world = await createWorld();
    const store = world.services.store;
    const pinnedId = store.models.save({
      name: '讨论反馈专用模型',
      provider: 'openai-compatible',
      baseUrl: 'http://model.test/v1',
      model: 'pinned-for-checkpoint',
      role: 'language',
      apiKey: '',
      enabled: true,
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
    });
    store.taskContexts.save(world.layout.a1.taskId, {
      executor: {
        kind: 'expert',
        expertId: world.layout.expertId,
        expertRevisionId: world.layout.expertRevisionId,
      },
      skillBindings: [],
      modelReference: { mode: 'profile', modelProfileId: pinnedId },
    });
    const addCheckpoint = (id: string, feedback: string): void => {
      store.discussionCheckpoints.create(world.layout.a1.taskId, {
        id,
        taskId: world.layout.a1.taskId,
        stage: 'understanding',
        title: '大纲口径',
        summary: '大纲先给结论再展开。',
        artifactVersionIds: [],
        feedback,
      });
    };
    addCheckpoint('cp-pinned', '以后大纲都按结论先开来写。');
    await enableAutoSuggest(world, world.layout.workspaceA);

    const queued = await world.services.extractions.requestExtractionForCheckpoint('cp-pinned');
    expect(queued.ok).toBe(true);
    if (!queued.ok) return;
    expect(queued.data.reason).toBeUndefined();
    expect(store.memoryExtractions.get(queued.data.jobId ?? '')?.modelProfileId).toBe(pinnedId);

    // 应用级默认模型此刻仍然可用：只把钉住的那条停掉，就必须可见地拒绝，
    // 而不是回落到默认模型——回落等于把同一段反馈送给另一个服务。
    store.models.setEnabled(pinnedId, false);
    addCheckpoint('cp-refused', '汇报里不要出现未核实的预测数字。');
    const refused = await world.services.extractions.requestExtractionForCheckpoint('cp-refused');
    expect(refused.ok).toBe(true);
    if (!refused.ok) return;
    expect(refused.data.status).toBe('not-enqueued');
    expect(refused.data.reason).toBe('MODEL_UNAVAILABLE');
    // 被拒的那一次连作业都不该登记：这个任务名下只有第一条钉住模型的作业。
    const jobs = store.memoryExtractions.listPage({
      workspaceId: world.layout.workspaceA,
      taskId: world.layout.a1.taskId,
    });
    expect(jobs.items.map((job) => job.id)).toEqual([queued.data.jobId]);
  });
});
