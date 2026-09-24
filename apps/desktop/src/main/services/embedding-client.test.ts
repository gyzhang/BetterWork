import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { abortError, isAbortError } from '@betterwork/agent-core';
import type { ModelProfileInput } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import type { CredentialOwnerRef } from '../persistence/credential-repository';
import type { CredentialGateStatus, CredentialResolver } from './credential-access';
import { EmbeddingClient, embeddingEndpointOf } from './embedding-client';
import { KnowledgeServiceError } from './knowledge-errors';

const temporaryDirectories: string[] = [];
const temporaryDirectory = (): string => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-embedding-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const BASE_URL = 'https://model.test/v1';
const API_KEY = 'sk-secret-should-not-leak';

const openStore = (): AppStore => AppStore.open(path.join(temporaryDirectory(), 'app.sqlite'));

const saveEmbeddingProfile = (store: AppStore): string =>
  store.models.save({
    name: '嵌入模型',
    provider: 'openai-compatible',
    baseUrl: BASE_URL,
    model: 'embed-v1',
    role: 'embedding',
    apiKey: API_KEY,
    maxContextTokens: 8_192,
    maxOutputTokens: 512,
    temperature: 0,
    enabled: true,
  });

/** 以现有配置为底重存，避免测试里散落字段副本。 */
const resaveProfile = (
  store: AppStore,
  profileId: string,
  overrides: Partial<ModelProfileInput>,
): void => {
  const current = store.models.getWithSecret(profileId);
  if (!current) throw new Error('测试前置：模型配置应存在');
  store.models.save({
    id: current.id,
    name: current.name,
    provider: current.provider,
    baseUrl: current.baseUrl,
    model: current.model,
    role: current.role,
    apiKey: current.apiKey,
    maxContextTokens: current.maxContextTokens,
    maxOutputTokens: current.maxOutputTokens,
    temperature: current.temperature,
    enabled: current.enabled,
    ...overrides,
  });
};

const vectorsPayload = (vectors: ReadonlyArray<readonly [number, number[]]>): string =>
  JSON.stringify({
    data: vectors.map(([index, embedding]) => ({ index, embedding })),
    usage: { prompt_tokens: 12, total_tokens: 12 },
  });

const jsonResponse = (body: string, init: ResponseInit = {}): Response =>
  new Response(body, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });

interface FetchCall {
  url: string;
  init: RequestInit;
}

/** 记录请求并把 abort 接成真实 fetch 的行为：信号触发时以统一取消错误拒绝。 */
const createFetch = (
  reply: (call: FetchCall) => Promise<Response> | Response,
): { calls: FetchCall[]; fetchImpl: typeof fetch } => {
  const calls: FetchCall[] = [];
  const fetchImpl = vi.fn(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const call = { url: String(input), init: init ?? {} };
      calls.push(call);
      const signal = call.init.signal;
      if (signal instanceof AbortSignal && signal.aborted) throw abortError();
      return reply(call);
    },
  );
  return { calls, fetchImpl };
};

const neverResolve: (call: FetchCall) => Promise<Response> = (call) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = call.init.signal;
    if (signal instanceof AbortSignal) {
      signal.addEventListener('abort', () => reject(abortError()), { once: true });
    }
  });

/** 每次 pull 产出 1 MiB，用来验证流式累计上限而不是整包读进内存。 */
const streamingBody = (): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
  });

const credentialStub = (
  status: CredentialGateStatus,
  secret = 'sk-from-credential-store',
): CredentialResolver & { resolvedOwnerIds: string[] } => {
  const resolvedOwnerIds: string[] = [];
  return {
    resolvedOwnerIds,
    migrationStatus: (ref: CredentialOwnerRef): CredentialGateStatus => {
      resolvedOwnerIds.push(ref.ownerId);
      return status;
    },
    resolveSecret: async (ref: CredentialOwnerRef): Promise<string> => {
      resolvedOwnerIds.push(ref.ownerId);
      return secret;
    },
  };
};

const settledError = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(() => undefined).catch((reason: unknown) => reason);

const thrownError = (run: () => unknown): unknown => {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
};

const expectCode = (error: unknown, code: KnowledgeServiceError['code']): void => {
  expect(error).toBeInstanceOf(KnowledgeServiceError);
  if (error instanceof KnowledgeServiceError) expect(error.code).toBe(code);
};

describe('embeddingEndpointOf', () => {
  it('沿用 http/https 校验、保留影响路由的 query 并拒绝 URL 内嵌凭据', () => {
    expect(embeddingEndpointOf('https://host/v1/')).toBe('https://host/v1/embeddings');
    expect(embeddingEndpointOf('https://host/v1/embeddings')).toBe('https://host/v1/embeddings');
    expect(embeddingEndpointOf('https://host/v1?route=a')).toBe(
      'https://host/v1/embeddings?route=a',
    );
    expect(() => embeddingEndpointOf('https://user:pass@host/v1')).toThrow(KnowledgeServiceError);
    expect(() => embeddingEndpointOf('file:///tmp/model')).toThrow(KnowledgeServiceError);
  });
});

describe('EmbeddingClient 模型身份', () => {
  it('换凭据或重存配置不改向量空间指纹，改 endpoint 或 model 必改', () => {
    const store = openStore();
    const profileId = saveEmbeddingProfile(store);
    const client = new EmbeddingClient({ models: store.models });
    const first = client.snapshotOf(profileId);

    resaveProfile(store, profileId, { apiKey: 'sk-rotated' });
    expect(client.snapshotOf(profileId).modelFingerprint).toBe(first.modelFingerprint);

    resaveProfile(store, profileId, { baseUrl: 'https://other.test/v1' });
    expect(client.snapshotOf(profileId).modelFingerprint).not.toBe(first.modelFingerprint);

    resaveProfile(store, profileId, { model: 'embed-v2' });
    const changed = client.snapshotOf(profileId);
    expect(changed.modelFingerprint).not.toBe(first.modelFingerprint);
    expect(changed.model).toBe('embed-v2');
    // 快照只带指纹，不带完整 endpoint 或凭据
    expect(JSON.stringify(changed)).not.toContain('model.test');
    expect(JSON.stringify(changed)).not.toContain('sk-');
    store.close();
  });

  it('没有可用默认嵌入模型时拒绝启用，不顶替其他角色', () => {
    const store = openStore();
    store.models.save({
      name: '语言模型',
      provider: 'openai-compatible',
      baseUrl: BASE_URL,
      model: 'chat-v1',
      role: 'language',
      apiKey: API_KEY,
      maxContextTokens: 8_192,
      maxOutputTokens: 512,
      temperature: 0,
      enabled: true,
    });
    const client = new EmbeddingClient({ models: store.models });

    expectCode(
      thrownError(() => client.defaultSnapshot()),
      'EMBEDDING_MODEL_UNAVAILABLE',
    );
    store.close();
  });

  it('停用或删除的 profile 直接失败且零 HTTP', async () => {
    const store = openStore();
    const profileId = saveEmbeddingProfile(store);
    const { calls, fetchImpl } = createFetch(() => jsonResponse(vectorsPayload([[0, [1, 0]]])));
    const client = new EmbeddingClient({ models: store.models, fetchImpl });
    const snapshot = client.snapshotOf(profileId);

    store.models.setEnabled(profileId, false);
    expectCode(
      await settledError(
        client.embed({ snapshot, inputs: ['甲'], signal: new AbortController().signal }),
      ),
      'EMBEDDING_MODEL_UNAVAILABLE',
    );

    store.models.delete(profileId);
    expectCode(
      await settledError(
        client.embed({ snapshot, inputs: ['甲'], signal: new AbortController().signal }),
      ),
      'EMBEDDING_MODEL_UNAVAILABLE',
    );
    expect(calls).toHaveLength(0);
    store.close();
  });
});

describe('EmbeddingClient 请求与响应', () => {
  it('按所选 profile 发请求，乱序 index 响应重排后归一化为单位向量', async () => {
    const store = openStore();
    const profileId = saveEmbeddingProfile(store);
    const { calls, fetchImpl } = createFetch(() =>
      jsonResponse(
        vectorsPayload([
          [1, [3, 4]],
          [0, [1, 0]],
        ]),
      ),
    );
    const client = new EmbeddingClient({ models: store.models, fetchImpl });

    const result = await client.embed({
      snapshot: client.snapshotOf(profileId),
      inputs: ['甲', '乙'],
      signal: new AbortController().signal,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://model.test/v1/embeddings');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      model: 'embed-v1',
      input: ['甲', '乙'],
      encoding_format: 'float',
    });
    expect(new Headers(calls[0]?.init.headers).get('Authorization')).toBe(`Bearer ${API_KEY}`);
    expect(result.dimension).toBe(2);
    expect(Array.from(result.vectors[0] ?? [])).toEqual([1, 0]);
    expect(Math.hypot(...Array.from(result.vectors[1] ?? []))).toBeCloseTo(1);
    expect(result.usage).toEqual({ promptTokens: 12, totalTokens: 12 });
    store.close();
  });

  it('凭据迁移完成时用凭据库解析的 Key，不读明文列', async () => {
    const store = openStore();
    const profileId = saveEmbeddingProfile(store);
    const credentialAccess = credentialStub('done');
    const { calls, fetchImpl } = createFetch(() => jsonResponse(vectorsPayload([[0, [1, 0]]])));
    const client = new EmbeddingClient({ models: store.models, credentialAccess, fetchImpl });

    await client.embed({
      snapshot: client.snapshotOf(profileId),
      inputs: ['甲'],
      signal: new AbortController().signal,
    });

    // 查状态一次、解析一次，都指向快照里那个 profile
    expect(credentialAccess.resolvedOwnerIds).toEqual([profileId, profileId]);
    expect(new Headers(calls[0]?.init.headers).get('Authorization')).toBe(
      'Bearer sk-from-credential-store',
    );
    store.close();
  });

  it('凭据迁移未完成时停止语义请求且不回落明文', async () => {
    const store = openStore();
    const profileId = saveEmbeddingProfile(store);
    const credentialAccess = credentialStub('pending');
    const { calls, fetchImpl } = createFetch(() => jsonResponse(vectorsPayload([[0, [1, 0]]])));
    const client = new EmbeddingClient({
      models: store.models,
      credentialAccess,
      fetchImpl,
    });

    expectCode(
      await settledError(
        client.embed({
          snapshot: client.snapshotOf(profileId),
          inputs: ['甲'],
          signal: new AbortController().signal,
        }),
      ),
      'EMBEDDING_MODEL_UNAVAILABLE',
    );
    // 只查了一次迁移状态就停止，没有去解析任何凭据
    expect(credentialAccess.resolvedOwnerIds).toEqual([profileId]);
    expect(calls).toHaveLength(0);
    store.close();
  });

  it('配置在快照之后变化时拒绝请求，旧向量空间需要显式重建', async () => {
    const store = openStore();
    const profileId = saveEmbeddingProfile(store);
    const snapshot = new EmbeddingClient({ models: store.models }).snapshotOf(profileId);
    resaveProfile(store, profileId, { model: 'embed-v2' });
    const { calls, fetchImpl } = createFetch(() => jsonResponse(vectorsPayload([[0, [1, 0]]])));
    const client = new EmbeddingClient({ models: store.models, fetchImpl });

    expectCode(
      await settledError(
        client.embed({ snapshot, inputs: ['甲'], signal: new AbortController().signal }),
      ),
      'EMBEDDING_MODEL_UNAVAILABLE',
    );
    expect(calls).toHaveLength(0);
    store.close();
  });

  it('超时明确失败且一次请求不自动重试', async () => {
    vi.useFakeTimers();
    const store = openStore();
    const profileId = saveEmbeddingProfile(store);
    const { calls, fetchImpl } = createFetch(neverResolve);
    const client = new EmbeddingClient({ models: store.models, fetchImpl });

    const pending = settledError(
      client.embed({
        snapshot: client.snapshotOf(profileId),
        inputs: ['甲'],
        signal: new AbortController().signal,
      }),
    );
    await vi.advanceTimersByTimeAsync(10_000);

    expectCode(await pending, 'EMBEDDING_TIMEOUT');
    expect(calls).toHaveLength(1);
    store.close();
  });

  it('用户取消走统一取消语义，不是领域失败', async () => {
    const store = openStore();
    const profileId = saveEmbeddingProfile(store);
    const { fetchImpl } = createFetch(neverResolve);
    const client = new EmbeddingClient({ models: store.models, fetchImpl });
    const controller = new AbortController();

    const pending = client.embed({
      snapshot: client.snapshotOf(profileId),
      inputs: ['甲'],
      signal: controller.signal,
    });
    const settled = settledError(pending);
    controller.abort();

    expect(isAbortError(await settled)).toBe(true);
    store.close();
  });

  const invalidCases: ReadonlyArray<readonly [string, string]> = [
    ['条数与输入不符', vectorsPayload([[0, [1, 0]]])],
    [
      'index 越界',
      vectorsPayload([
        [0, [1, 0]],
        [7, [0, 1]],
      ]),
    ],
    [
      'index 重复',
      vectorsPayload([
        [0, [1, 0]],
        [0, [0, 1]],
      ]),
    ],
    [
      '含非有限数值',
      vectorsPayload([
        [0, [1, Number.NaN]],
        [1, [0, 1]],
      ]),
    ],
    [
      '批内维度不一致',
      vectorsPayload([
        [0, [1, 0]],
        [1, [1, 2, 3]],
      ]),
    ],
    [
      '全零向量',
      vectorsPayload([
        [0, [0, 0]],
        [1, [1, 1]],
      ]),
    ],
    ['不是合法 JSON', '{"data":'],
    ['缺少 data', JSON.stringify({ usage: { prompt_tokens: 1, total_tokens: 1 } })],
  ];

  it.each(invalidCases)('响应非法（%s）时明确失败而不是当作无命中', async (_label, body) => {
    const store = openStore();
    const profileId = saveEmbeddingProfile(store);
    const { calls, fetchImpl } = createFetch(() => jsonResponse(body));
    const client = new EmbeddingClient({ models: store.models, fetchImpl });

    expectCode(
      await settledError(
        client.embed({
          snapshot: client.snapshotOf(profileId),
          inputs: ['甲', '乙'],
          signal: new AbortController().signal,
        }),
      ),
      'EMBEDDING_RESPONSE_INVALID',
    );
    expect(calls).toHaveLength(1);
    store.close();
  });

  it('HTTP 错误只保留安全状态码，不回显响应正文或密钥', async () => {
    const store = openStore();
    const profileId = saveEmbeddingProfile(store);
    const { fetchImpl } = createFetch(
      () => new Response(`service failed, key=${API_KEY}`, { status: 503 }),
    );
    const client = new EmbeddingClient({ models: store.models, fetchImpl });

    const error = await settledError(
      client.embed({
        snapshot: client.snapshotOf(profileId),
        inputs: ['甲'],
        signal: new AbortController().signal,
      }),
    );
    expectCode(error, 'EMBEDDING_MODEL_UNAVAILABLE');
    if (error instanceof KnowledgeServiceError) {
      expect(error.message).toContain('503');
      expect(error.message).not.toContain(API_KEY);
    }
    store.close();
  });

  it('流式响应累计超过上限即取消并失败', async () => {
    const store = openStore();
    const profileId = saveEmbeddingProfile(store);
    const { fetchImpl } = createFetch(() => new Response(streamingBody()));
    const client = new EmbeddingClient({ models: store.models, fetchImpl });

    expectCode(
      await settledError(
        client.embed({
          snapshot: client.snapshotOf(profileId),
          inputs: ['甲'],
          signal: new AbortController().signal,
        }),
      ),
      'EMBEDDING_RESPONSE_INVALID',
    );
    store.close();
  });

  it('快照已锁定维度时拒绝不同维度的批次', async () => {
    const store = openStore();
    const profileId = saveEmbeddingProfile(store);
    const { calls, fetchImpl } = createFetch(() => jsonResponse(vectorsPayload([[0, [1, 0]]])));
    const client = new EmbeddingClient({ models: store.models, fetchImpl });

    expectCode(
      await settledError(
        client.embed({
          snapshot: { ...client.snapshotOf(profileId), dimension: 3 },
          inputs: ['甲'],
          signal: new AbortController().signal,
        }),
      ),
      'EMBEDDING_RESPONSE_INVALID',
    );
    expect(calls).toHaveLength(1);
    store.close();
  });

  it('超出批次数、码点预算或空输入时零 HTTP', async () => {
    const store = openStore();
    const profileId = saveEmbeddingProfile(store);
    const { calls, fetchImpl } = createFetch(() => jsonResponse(vectorsPayload([[0, [1, 0]]])));
    const client = new EmbeddingClient({ models: store.models, fetchImpl });
    const snapshot = client.snapshotOf(profileId);

    for (const inputs of [
      Array.from({ length: 17 }, (_unused, index) => `段${index}`),
      ['甲'.repeat(8_000), '乙'.repeat(8_001)],
      ['  '],
    ]) {
      expectCode(
        await settledError(
          client.embed({ snapshot, inputs, signal: new AbortController().signal }),
        ),
        'EMBEDDING_RESPONSE_INVALID',
      );
    }
    expect(calls).toHaveLength(0);
    store.close();
  });
});
