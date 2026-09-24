import { createHash } from 'node:crypto';

import { abortError } from '@betterwork/agent-core';
import type { ModelProfileSummary } from '@betterwork/agent-protocol';
import {
  countCodePoints,
  type EmbeddingModelSnapshot,
  embeddingModelSnapshotSchema,
  type EmbeddingUsage,
  KNOWLEDGE_EMBEDDING_BATCH_CODE_POINT_BUDGET,
  KNOWLEDGE_EMBEDDING_BATCH_INPUT_MAX,
  KNOWLEDGE_EMBEDDING_BATCH_TIMEOUT_MS,
  KNOWLEDGE_EMBEDDING_DIMENSION_MAX,
  KNOWLEDGE_EMBEDDING_FINGERPRINT_VERSION,
  KNOWLEDGE_EMBEDDING_QUERY_INPUT_MAX,
  KNOWLEDGE_EMBEDDING_QUERY_TIMEOUT_MS,
  KNOWLEDGE_EMBEDDING_RESPONSE_FORMAT,
  KNOWLEDGE_EMBEDDING_RESPONSE_MAX_BYTES,
} from '@betterwork/agent-protocol';

import { API_KEY_SLOT, CredentialError } from '../persistence/credential-repository';
import type { CredentialResolver } from './credential-access';
import { KnowledgeServiceError } from './knowledge-errors';
import { endpointDisplayOf } from './model-provider-factory';

/**
 * 嵌入模型只从现有模型配置与凭据入口解析（知识契约 §7.1）。
 * 明文 Key 与完整 endpoint 都留在 Main，快照里只有指纹；不新建第二套凭据入口。
 */
export interface EmbeddingProfileSource {
  getWithSecret(id: string): (ModelProfileSummary & { apiKey: string }) | undefined;
  getDefaultProfileId(role: 'embedding'): string | undefined;
}

export interface EmbeddingResult {
  /** 与输入同序的单位向量。 */
  vectors: Float32Array[];
  dimension: number;
  usage?: EmbeddingUsage;
}

export interface EmbeddingRequest {
  snapshot: EmbeddingModelSnapshot;
  inputs: readonly string[];
  signal: AbortSignal;
}

export interface EmbeddingClientOptions {
  readonly models: EmbeddingProfileSource;
  readonly credentialAccess?: CredentialResolver | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

type SecretBearingProfile = ModelProfileSummary & { apiKey: string };

interface EmbeddingIdentity {
  profileId: string;
  provider: string;
  model: string;
  /** 规范化完整 endpoint，只用于请求与指纹，不进入快照。 */
  endpoint: string;
  baseUrl: string;
  profile: SecretBearingProfile;
}

const unavailable = (message: string, cause?: unknown): KnowledgeServiceError =>
  cause === undefined
    ? new KnowledgeServiceError('EMBEDDING_MODEL_UNAVAILABLE', message)
    : new KnowledgeServiceError('EMBEDDING_MODEL_UNAVAILABLE', message, { cause });

const invalid = (message: string, cause?: unknown): KnowledgeServiceError =>
  cause === undefined
    ? new KnowledgeServiceError('EMBEDDING_RESPONSE_INVALID', message)
    : new KnowledgeServiceError('EMBEDDING_RESPONSE_INVALID', message, { cause });

const digest = (parts: readonly (readonly [string, unknown])[]): string =>
  createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(parts)))
    .digest('hex');

/**
 * 规范化完整 endpoint：沿用 http/https 校验、拒绝 URL 内嵌凭据，
 * 保留会影响路由的 query——它参与指纹，但快照里只留哈希。
 */
export const embeddingEndpointOf = (baseUrl: string): string => {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (error) {
    throw unavailable('嵌入模型的 API 地址不是合法 URL。', error);
  }
  if (url.username !== '' || url.password !== '') {
    throw unavailable('嵌入模型的 API 地址不能在 URL 里内嵌凭据。');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw unavailable('嵌入模型的 API 地址必须是 http 或 https。');
  }
  const path = url.pathname.replace(/\/+$/u, '');
  // 与连通性探测同一口径：已经写全的端点不再二次拼接。
  if (path.endsWith('/embeddings')) {
    url.pathname = path;
    return url.toString();
  }
  url.pathname = `${path}/embeddings`;
  return url.toString();
};

/** 向量空间身份：版本、profileId、provider、完整 endpoint、model、固定请求格式。 */
export const embeddingModelFingerprintOf = (identity: {
  profileId: string;
  provider: string;
  endpoint: string;
  model: string;
}): string =>
  digest([
    ['version', KNOWLEDGE_EMBEDDING_FINGERPRINT_VERSION],
    ['profileId', identity.profileId],
    ['provider', identity.provider],
    ['endpoint', identity.endpoint],
    ['model', identity.model],
    ['format', KNOWLEDGE_EMBEDDING_RESPONSE_FORMAT],
  ]);

export const embeddingEndpointFingerprintOf = (endpoint: string): string =>
  digest([
    ['version', KNOWLEDGE_EMBEDDING_FINGERPRINT_VERSION],
    ['endpoint', endpoint],
  ]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** usage 只接受服务返回的非负整数；缺失或不合法都省略，不用字符数伪造。 */
const usageOf = (payload: Record<string, unknown>): EmbeddingUsage | undefined => {
  const usage = payload['usage'];
  if (!isRecord(usage)) return undefined;
  const promptTokens = usage['prompt_tokens'];
  const totalTokens = usage['total_tokens'];
  if (!isNonNegativeInteger(promptTokens) || !isNonNegativeInteger(totalTokens)) return undefined;
  return { promptTokens, totalTokens };
};

/** 归一化为单位向量；Float32 舍入后再查有限性与非零，不把退化向量当作有效命中。 */
const normalize = (values: readonly number[]): Float32Array => {
  let sumOfSquares = 0;
  for (const value of values) sumOfSquares += value * value;
  const norm = Math.sqrt(sumOfSquares);
  if (!Number.isFinite(norm) || norm <= 0) throw invalid('向量范数非法。');
  const vector = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    vector[index] = (values[index] ?? 0) / norm;
  }
  let nonZero = false;
  for (const value of vector) {
    if (!Number.isFinite(value)) throw invalid('向量在 Float32 归一化后失去有限性。');
    if (value !== 0) nonZero = true;
  }
  if (!nonZero) throw invalid('向量归一化后全为零。');
  return vector;
};

const vectorOf = (raw: unknown, expectedDimension: number | undefined): Float32Array => {
  if (!Array.isArray(raw) || raw.length === 0) throw invalid('向量不是非空数组。');
  if (raw.length > KNOWLEDGE_EMBEDDING_DIMENSION_MAX) throw invalid('向量维度超出本期上限。');
  const values: number[] = [];
  for (const item of raw) {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      throw invalid('向量含 NaN 或非有限数值。');
    }
    values.push(item);
  }
  if (expectedDimension !== undefined && values.length !== expectedDimension) {
    throw invalid('向量维度与共享空间锁定的维度不一致。');
  }
  return normalize(values);
};

/** 只按 index 重排；条数、唯一性、覆盖范围任一不符都算响应非法。 */
const reorder = (data: readonly unknown[], expected: number): readonly unknown[] => {
  const slots: unknown[] = new Array<unknown>(expected);
  const seen = new Set<number>();
  for (const item of data) {
    if (!isRecord(item)) throw invalid('向量条目不是对象。');
    const index = item['index'];
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= expected) {
      throw invalid('向量条目 index 越界或非整数。');
    }
    if (seen.has(index)) throw invalid('向量条目 index 重复。');
    seen.add(index);
    slots[index] = item;
  }
  if (seen.size !== expected) throw invalid('向量条目数量与输入数量不一致。');
  return slots;
};

const concat = (chunks: readonly Uint8Array[], total: number): Uint8Array => {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
};

/** 流式累计读取，达到上限即取消，不把超限响应整个读进内存。 */
const readCappedText = async (body: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    received += value.byteLength;
    if (received > KNOWLEDGE_EMBEDDING_RESPONSE_MAX_BYTES) {
      await reader.cancel();
      throw invalid('嵌入响应体超过 4 MiB 上限。');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(concat(chunks, received));
};

/**
 * OpenAI-compatible `/embeddings` 适配（知识契约 §7.2）。
 *
 * 每次请求都按快照里的 profileId 重新解析配置与凭据：换 Key 不改向量空间，
 * 但正在用旧凭据的请求会失败；endpoint/model/provider 变化则指纹不符，
 * 直接停掉语义请求——不暗换成另一个 profile，也不自动重试。
 */
export class EmbeddingClient {
  private readonly models: EmbeddingProfileSource;
  private readonly credentialAccess: CredentialResolver | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: EmbeddingClientOptions) {
    this.models = options.models;
    this.credentialAccess = options.credentialAccess;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** 当前默认嵌入 profile 的身份快照；没有合格模型就拒绝启用语义能力。 */
  defaultSnapshot(): EmbeddingModelSnapshot {
    const profileId = this.models.getDefaultProfileId('embedding');
    if (!profileId) {
      throw unavailable('尚未启用可用的嵌入模型，语义检索不会回落到其他模型。');
    }
    return this.snapshotOf(profileId);
  }

  snapshotOf(profileId: string): EmbeddingModelSnapshot {
    const identity = this.identityOf(profileId);
    return embeddingModelSnapshotSchema.parse({
      profileId: identity.profileId,
      provider: identity.provider,
      endpointFingerprint: embeddingEndpointFingerprintOf(identity.endpoint),
      model: identity.model,
      modelFingerprint: embeddingModelFingerprintOf({
        profileId: identity.profileId,
        provider: identity.provider,
        endpoint: identity.endpoint,
        model: identity.model,
      }),
    });
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const inputs = this.validateInputs(request.inputs);
    const snapshot = embeddingModelSnapshotSchema.parse(request.snapshot);
    const identity = this.identityOf(snapshot.profileId);
    if (
      embeddingEndpointFingerprintOf(identity.endpoint) !== snapshot.endpointFingerprint ||
      embeddingModelFingerprintOf(identity) !== snapshot.modelFingerprint
    ) {
      throw unavailable('嵌入模型配置已变化，旧向量空间不再可用，需要用户显式重建。');
    }
    const apiKey = await this.credentialSecret(identity.profile);
    const timeoutMs =
      inputs.length <= KNOWLEDGE_EMBEDDING_QUERY_INPUT_MAX
        ? KNOWLEDGE_EMBEDDING_QUERY_TIMEOUT_MS
        : KNOWLEDGE_EMBEDDING_BATCH_TIMEOUT_MS;

    const controller = new AbortController();
    let timedOut = false;
    const onUserAbort = (): void => {
      controller.abort();
    };
    if (request.signal.aborted) throw abortError();
    request.signal.addEventListener('abort', onUserAbort);
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await this.fetchImpl(identity.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey === '' ? {} : { Authorization: `Bearer ${apiKey}` }),
        },
        body: JSON.stringify({
          model: identity.model,
          input: inputs,
          encoding_format: KNOWLEDGE_EMBEDDING_RESPONSE_FORMAT,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw unavailable(`嵌入模型服务返回 HTTP ${response.status}。`);
      const text = response.body ? await readCappedText(response.body) : await response.text();
      if (request.signal.aborted) throw abortError();
      return this.parseResponse(text, inputs.length, snapshot.dimension);
    } catch (error) {
      if (error instanceof KnowledgeServiceError) throw error;
      if (error instanceof CredentialError) {
        throw unavailable('嵌入模型的凭据不可用，语义请求已停止。', error);
      }
      if (timedOut) {
        throw new KnowledgeServiceError(
          'EMBEDDING_TIMEOUT',
          `嵌入请求超过 ${timeoutMs / 1000} 秒未完成。`,
          { cause: error },
        );
      }
      if (request.signal.aborted) throw abortError();
      throw unavailable(
        `无法连接嵌入模型服务（${endpointDisplayOf(identity.baseUrl)}），响应内容未回显。`,
        error,
      );
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', onUserAbort);
    }
  }

  private validateInputs(inputs: readonly string[]): string[] {
    if (inputs.length === 0) throw invalid('嵌入请求没有输入文本。');
    if (inputs.length > KNOWLEDGE_EMBEDDING_BATCH_INPUT_MAX) {
      throw invalid(`一次嵌入请求最多 ${KNOWLEDGE_EMBEDDING_BATCH_INPUT_MAX} 段文本。`);
    }
    let total = 0;
    for (const input of inputs) {
      if (input.trim() === '') throw invalid('嵌入输入不能为空。');
      total += countCodePoints(input);
    }
    if (total > KNOWLEDGE_EMBEDDING_BATCH_CODE_POINT_BUDGET) {
      throw invalid(`一次嵌入请求最多 ${KNOWLEDGE_EMBEDDING_BATCH_CODE_POINT_BUDGET} 码点。`);
    }
    return [...inputs];
  }

  private parseResponse(
    text: string,
    expected: number,
    dimension: number | undefined,
  ): EmbeddingResult {
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw invalid('嵌入响应不是合法 JSON。', error);
    }
    const data = isRecord(payload) ? payload['data'] : undefined;
    if (!Array.isArray(data) || data.length !== expected) {
      throw invalid('嵌入响应的向量条数与输入条数不一致。');
    }
    const vectors: Float32Array[] = [];
    let resolvedDimension = dimension;
    for (const item of reorder(data, expected)) {
      const embedding = isRecord(item) ? item['embedding'] : undefined;
      const vector = vectorOf(embedding, resolvedDimension);
      resolvedDimension ??= vector.length;
      vectors.push(vector);
    }
    if (resolvedDimension === undefined) throw invalid('无法确定向量维度。');
    const usage = isRecord(payload) ? usageOf(payload) : undefined;
    return {
      vectors,
      dimension: resolvedDimension,
      ...(usage === undefined ? {} : { usage }),
    };
  }

  private identityOf(profileId: string): EmbeddingIdentity {
    const profile = this.models.getWithSecret(profileId);
    if (!profile) throw unavailable(`嵌入模型配置不存在：${profileId}`);
    if (!profile.enabled || profile.role !== 'embedding') {
      throw unavailable(`模型配置「${profile.name}」当前不可用于嵌入。`);
    }
    return {
      profileId: profile.id,
      provider: profile.provider,
      model: profile.model,
      endpoint: embeddingEndpointOf(profile.baseUrl),
      baseUrl: profile.baseUrl,
      profile,
    };
  }

  /** 与语言模型侧同一凭据口径：迁移未完成不回落明文，done 从凭据库解析。 */
  private async credentialSecret(profile: SecretBearingProfile): Promise<string> {
    const access = this.credentialAccess;
    if (!access) return profile.apiKey;
    const ref = {
      ownerKind: 'model-profile' as const,
      ownerId: profile.id,
      slot: API_KEY_SLOT,
    };
    const status = access.migrationStatus(ref);
    if (status === 'pending' || status === 'failed') {
      throw unavailable('嵌入模型凭据尚未完成加密迁移，语义请求已停止。');
    }
    if (status !== 'done') return profile.apiKey;
    return access.resolveSecret(ref);
  }
}
