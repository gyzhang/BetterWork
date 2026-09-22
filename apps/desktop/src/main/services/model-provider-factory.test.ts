import type { ModelProfileSummary } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import type { RunnableModel } from '../persistence/model-repository';
import type { CredentialResolver } from './credential-access';
import {
  endpointDisplayOf,
  type LanguageModelSource,
  ModelFactoryError,
  ModelProviderFactory,
} from './model-provider-factory';

const profile = (over: Partial<ModelProfileSummary & { apiKey: string }> = {}) => ({
  id: 'p-1',
  name: '公司内网模型',
  provider: 'openai-compatible',
  baseUrl: 'https://llm.internal.example/v1',
  model: 'glm-4.6',
  role: 'language' as const,
  apiKeyConfigured: true,
  enabled: true,
  priority: 0,
  connectionStatus: 'connected' as const,
  maxContextTokens: 128_000,
  maxOutputTokens: 4_096,
  temperature: 0.3,
  createdAt: 1,
  updatedAt: 1,
  apiKey: 'sk-profile-secret',
  ...over,
});

const runnable = (over: Partial<RunnableModel> = {}): RunnableModel => ({
  id: 'p-default',
  baseUrl: 'https://llm.internal.example/v1',
  apiKey: 'sk-default-secret',
  model: 'glm-4.6',
  temperature: 0.7,
  maxOutputTokens: 8_192,
  ...over,
});

const teachingProvider = {
  id: 'fake',
  async *stream(): AsyncGenerator<never, void, unknown> {},
};

const factory = (
  models: Partial<LanguageModelSource>,
  options: {
    credentialAccess?: ConstructorParameters<typeof ModelProviderFactory>[0]['credentialAccess'];
    withFallback?: boolean;
  } = {},
): ModelProviderFactory =>
  new ModelProviderFactory({
    models: {
      getWithSecret: () => undefined,
      getForRun: () => undefined,
      ...models,
    },
    credentialAccess: options.credentialAccess,
    ...(options.withFallback === false ? {} : { fallbackProvider: teachingProvider }),
  });

describe('endpointDisplayOf', () => {
  it('strips query, userinfo and any url-borne token', () => {
    expect(
      endpointDisplayOf('https://alice:s3cr3t@gw.internal.example/v1/chat?token=abc&x=1'),
    ).toBe('https://gw.internal.example/v1/chat');
  });

  it('echoes nothing for a value that is not a URL', () => {
    expect(endpointDisplayOf('not a url at all')).toBe('invalid-endpoint');
  });
});

describe('ModelProviderFactory.resolveForRun', () => {
  it('keeps the teaching fallback for ordinary runs when nothing is configured', async () => {
    const resolved = await factory({}).resolveForRun();
    expect(resolved.provider).toBe(teachingProvider);
    expect(resolved.profileId).toBeUndefined();
    expect(resolved.displayName).toBe('内置教学模型');
  });

  it('still errors when an explicitly referenced profile is missing or unusable', async () => {
    await expect(
      factory({}).resolveForRun({ mode: 'profile', modelProfileId: 'ghost' }),
    ).rejects.toThrow('指定的模型配置不存在');

    await expect(
      factory({ getWithSecret: () => profile({ enabled: false }) }).resolveForRun({
        mode: 'profile',
        modelProfileId: 'p-1',
      }),
    ).rejects.toThrow('不可用于语言模型运行');

    await expect(
      factory({ getWithSecret: () => profile({ role: 'embedding' }) }).resolveForRun({
        mode: 'profile',
        modelProfileId: 'p-1',
      }),
    ).rejects.toThrow(ModelFactoryError);
  });
});

describe('ModelProviderFactory.requireConfiguredLanguageModel', () => {
  it('never falls back to the teaching provider', async () => {
    await expect(
      factory({}, { withFallback: false }).requireConfiguredLanguageModel(),
    ).rejects.toThrow('自动提炼不会回落到内置模型');
  });

  it('refuses to run extraction on the teaching model even when a fallback exists', async () => {
    await expect(factory({}).requireConfiguredLanguageModel()).rejects.toThrow(ModelFactoryError);
  });

  it('resolves a real profile and reports its identity', async () => {
    const resolved = await factory({
      getWithSecret: () => profile(),
    }).requireConfiguredLanguageModel({ mode: 'profile', modelProfileId: 'p-1' });
    expect(resolved.profileId).toBe('p-1');
    expect(resolved.displayName).toBe('公司内网模型');
    expect(resolved.endpointDisplay).toBe('https://llm.internal.example/v1');
  });
});

describe('configuration fingerprint', () => {
  it('never carries the credential, so two keys on the same config match', async () => {
    const models: Partial<LanguageModelSource> = {
      getWithSecret: () => profile({ apiKey: 'sk-one' }),
    };
    const first = await factory(models).requireConfiguredLanguageModel({
      mode: 'profile',
      modelProfileId: 'p-1',
    });
    const second = await factory({
      getWithSecret: () => profile({ apiKey: 'sk-two' }),
    }).requireConfiguredLanguageModel({ mode: 'profile', modelProfileId: 'p-1' });
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).not.toContain('sk-');
    expect(second.endpointDisplay).toBe('https://llm.internal.example/v1');
  });

  it('changes when any non-sensitive setting changes', async () => {
    const base = await factory({ getWithSecret: () => profile() }).requireConfiguredLanguageModel({
      mode: 'profile',
      modelProfileId: 'p-1',
    });
    const changed = await factory({
      getWithSecret: () => profile({ model: 'glm-5' }),
    }).requireConfiguredLanguageModel({ mode: 'profile', modelProfileId: 'p-1' });
    expect(base.fingerprint).not.toBe(changed.fingerprint);
  });

  it('is stable regardless of the key insertion order of the source object', async () => {
    const first = await factory({ getWithSecret: () => profile() }).requireConfiguredLanguageModel({
      mode: 'profile',
      modelProfileId: 'p-1',
    });
    const second = await factory({
      getWithSecret: () => ({ ...profile() }),
    }).requireConfiguredLanguageModel({ mode: 'profile', modelProfileId: 'p-1' });
    expect(first.fingerprint).toBe(second.fingerprint);
  });
});

describe('credential access', () => {
  const gate = (
    status: 'none' | 'pending' | 'failed' | 'done',
    secret = 'sk-from-vault',
  ): CredentialResolver => ({
    migrationStatus: () => status,
    resolveSecret: async () => secret,
  });

  it('rejects a pending or failed migration instead of reusing the plaintext column', async () => {
    for (const status of ['pending', 'failed'] as const) {
      await expect(
        factory(
          { getForRun: () => runnable() },
          { credentialAccess: gate(status) },
        ).requireConfiguredLanguageModel(),
      ).rejects.toThrow('尚未完成加密迁移');
    }
  });

  it('reads the secret from the credential store once migration is done', async () => {
    const resolved = await factory(
      { getForRun: () => runnable() },
      { credentialAccess: gate('done') },
    ).requireConfiguredLanguageModel();
    expect(resolved.profileId).toBe('p-default');
    // 审计面字段（不含 provider 实例本身）不得带出凭据。
    expect(
      JSON.stringify({
        profileId: resolved.profileId,
        displayName: resolved.displayName,
        fingerprint: resolved.fingerprint,
        endpointDisplay: resolved.endpointDisplay,
      }),
    ).not.toContain('sk-');
  });

  it('keeps the legacy column path when no credential accessor is injected', async () => {
    const resolved = await factory({
      getForRun: () => runnable(),
    }).requireConfiguredLanguageModel();
    expect(resolved.profileId).toBe('p-default');
  });
});
