import { createHash } from 'node:crypto';

import type { ModelProvider } from '@betterwork/agent-core';
import { OpenAICompatibleProvider } from '@betterwork/agent-core';
import type { ExpertModelReference, ModelProfileSummary } from '@betterwork/agent-protocol';

import { API_KEY_SLOT, CredentialError } from '../persistence/credential-repository';
import type { RunnableModel } from '../persistence/model-repository';
import type { CredentialResolver } from './credential-access';

/**
 * Main 内共享的语言模型解析（总稿 §7.1）。
 *
 * 普通 Run 保持既有兼容行为：未配置语言模型时仍回落到教学 Provider。
 * 提炼作业走 requireConfiguredLanguageModel——生产环境不接受 Fake Provider 回落，
 * 配置不可用时也不暗换成另一个服务。
 */

export type ModelFactoryErrorCode = 'MODEL_UNAVAILABLE';

export class ModelFactoryError extends Error {
  constructor(
    readonly code: ModelFactoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ModelFactoryError';
  }
}

type SecretBearingProfile = ModelProfileSummary & { apiKey: string };

export interface LanguageModelSource {
  getWithSecret(id: string): SecretBearingProfile | undefined;
  getForRun(role: 'language'): RunnableModel | undefined;
}

export interface ResolvedLanguageModel {
  readonly provider: ModelProvider;
  /** 实际解析到的配置身份；回落到内置教学 Provider 时缺省。 */
  readonly profileId?: string | undefined;
  readonly displayName: string;
  /** 非敏感配置指纹：不含凭据，但配置一变就变。 */
  readonly fingerprint: string;
  /** 只保留 scheme+host+path，去掉 query、userinfo 与 URL token。 */
  readonly endpointDisplay: string;
}

export interface ModelProviderFactoryOptions {
  readonly models: LanguageModelSource;
  readonly credentialAccess?: CredentialResolver | undefined;
  readonly fallbackProvider?: ModelProvider | undefined;
}

type ResolvedProfile =
  | { readonly origin: 'profile'; readonly profile: SecretBearingProfile }
  | { readonly origin: 'default'; readonly model: RunnableModel }
  | { readonly origin: 'fallback' };

/** 审计与历史摘要只存这个展示值，绝不存原始 URL——它可能带着 token。 */
export const endpointDisplayOf = (baseUrl: string): string => {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    // 非 URL 形态的配置值不回显任何片段，免得把疑似凭据写进审计。
    return 'invalid-endpoint';
  }
};

const stableFingerprint = (parts: Readonly<Record<string, unknown>>): string =>
  createHash('sha256')
    .update(
      Object.keys(parts)
        .sort()
        .map((key) => `${key}=${String(parts[key])}`)
        .join('|'),
    )
    .digest('hex');

const TEACHING_FINGERPRINT = stableFingerprint({ kind: 'teaching-fallback' });

export class ModelProviderFactory {
  private readonly models: LanguageModelSource;
  private readonly credentialAccess: CredentialResolver | undefined;
  private readonly fallbackProvider: ModelProvider | undefined;

  constructor(options: ModelProviderFactoryOptions) {
    this.models = options.models;
    this.credentialAccess = options.credentialAccess;
    this.fallbackProvider = options.fallbackProvider;
  }

  /** 普通 Run：保持既有的教学 Provider 回落，链路始终可复现。 */
  async resolveForRun(reference?: ExpertModelReference): Promise<ResolvedLanguageModel> {
    const profile = this.profileFor(reference);
    if (profile.origin === 'fallback') {
      const fallback = this.fallbackProvider;
      if (fallback === undefined) {
        throw new ModelFactoryError('MODEL_UNAVAILABLE', '尚未配置可用的语言模型。');
      }
      return {
        provider: fallback,
        displayName: '内置教学模型',
        fingerprint: TEACHING_FINGERPRINT,
        endpointDisplay: 'local://teaching-fallback',
      };
    }
    return this.build(profile);
  }

  /** 提炼作业：必须有真实配置的语言模型，禁止 Fake 回落。 */
  async requireConfiguredLanguageModel(
    reference?: ExpertModelReference,
  ): Promise<ResolvedLanguageModel> {
    const profile = this.profileFor(reference);
    if (profile.origin !== 'profile' && profile.origin !== 'default') {
      throw new ModelFactoryError(
        'MODEL_UNAVAILABLE',
        '未配置可用的语言模型，自动提炼不会回落到内置模型。',
      );
    }
    return this.build(profile);
  }

  private profileFor(reference?: ExpertModelReference): ResolvedProfile {
    if (reference?.mode === 'profile') {
      const configured = this.models.getWithSecret(reference.modelProfileId);
      if (!configured) {
        throw new ModelFactoryError(
          'MODEL_UNAVAILABLE',
          `指定的模型配置不存在：${reference.modelProfileId}`,
        );
      }
      if (!configured.enabled || configured.role !== 'language') {
        throw new ModelFactoryError(
          'MODEL_UNAVAILABLE',
          `指定的模型配置不可用于语言模型运行：${configured.name}`,
        );
      }
      return { origin: 'profile', profile: configured };
    }
    const configured = this.models.getForRun('language');
    return configured ? { origin: 'default', model: configured } : { origin: 'fallback' };
  }

  private async build(
    profile: Exclude<ResolvedProfile, { origin: 'fallback' }>,
  ): Promise<ResolvedLanguageModel> {
    const model = profile.origin === 'profile' ? profile.profile : profile.model;
    const apiKey = await this.credentialSecret(model);
    const displayName = profile.origin === 'profile' ? profile.profile.name : profile.model.id;
    return {
      provider: new OpenAICompatibleProvider({ ...model, apiKey }),
      profileId: model.id,
      displayName,
      fingerprint: stableFingerprint({
        id: model.id,
        baseUrl: endpointDisplayOf(model.baseUrl),
        model: model.model,
        temperature: model.temperature,
        maxOutputTokens: model.maxOutputTokens,
      }),
      endpointDisplay: endpointDisplayOf(model.baseUrl),
    };
  }

  /**
   * 新读优先：done→从凭据库取；pending/failed→拒绝，不回落明文；none→用旧列（回滚窗口/keyless）。
   * 未注入凭据访问点时保持原列行为，兼容既有测试。
   */
  private async credentialSecret(model: RunnableModel): Promise<string> {
    const access = this.credentialAccess;
    if (!access) return model.apiKey;
    const ref = { ownerKind: 'model-profile' as const, ownerId: model.id, slot: API_KEY_SLOT };
    const status = access.migrationStatus(ref);
    if (status === 'pending' || status === 'failed') {
      throw new CredentialError(
        'credential_migration_required',
        '相关凭据尚未完成加密迁移，请确认应用已成功启动并迁移后重试',
      );
    }
    if (status === 'done') return access.resolveSecret(ref);
    return model.apiKey;
  }
}
