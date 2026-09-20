import { afterEach, describe, expect, it } from 'vitest';

import type { SafeStorageAdapter } from '../infrastructure/credential-store';
import { AppStore } from '../persistence';
import { type CredentialRepository } from '../persistence/credential-repository';
import { CredentialMigrationService } from './credential-migration-service';

class FakeStore implements SafeStorageAdapter {
  available = true;
  corrupt = false;
  async isAvailableAsync(): Promise<boolean> {
    return this.available;
  }
  async encryptAsync(plaintext: string): Promise<Buffer> {
    return Buffer.from(`enc:${plaintext}`, 'utf8');
  }
  async decryptAsync(ciphertext: Buffer): Promise<string> {
    const value = ciphertext.toString('utf8').replace(/^enc:/u, '');
    return this.corrupt ? `wrong:${value}` : value;
  }
}

let store: AppStore | undefined;

interface Ctx {
  store: AppStore;
  store_: FakeStore;
  credentials: CredentialRepository;
  service: CredentialMigrationService;
  modelId: string;
}

/** 用带 fake 适配器的 AppStore 播入明文 Key 的模型/搜索，并手动 ensurePending 模拟 v25 种子。 */
const seeded = (): Ctx => {
  const fake = new FakeStore();
  const opened = AppStore.open(':memory:', fake);
  store = opened;
  const credentials = opened.credentials;
  if (!credentials) throw new Error('test setup: credentials repository unavailable');
  const modelId = opened.models.save({
    name: '语言模型',
    provider: 'openai-compatible',
    baseUrl: 'https://example.invalid/v1',
    model: 'gpt-x',
    role: 'language',
    apiKey: 'sk-model-123',
    enabled: true,
    maxContextTokens: 8192,
    maxOutputTokens: 4096,
    temperature: 0.2,
  });
  opened.searchEngines.save({
    provider: 'baidu_qianfan',
    apiKey: 'sk-search-456',
    webTopK: 10,
    enabled: true,
  });
  opened.credentialJournal.ensurePending('model-profile', modelId, 'api-key');
  opened.credentialJournal.ensurePending('api-service-profile', 'baidu_qianfan', 'api-key');
  return {
    store: opened,
    store_: fake,
    credentials,
    service: new CredentialMigrationService(opened, credentials),
    modelId,
  };
};

const modelKey = (ctx: Ctx): string => ctx.store.models.readPlaintextApiKey(ctx.modelId) ?? '';
const searchKey = (ctx: Ctx): string =>
  ctx.store.searchEngines.readPlaintextApiKey('baidu_qianfan') ?? '';

afterEach(() => {
  store?.close();
  store = undefined;
});

describe('CredentialMigrationService', () => {
  it('seeds two pending owners and migrates model + search keys into credentials', async () => {
    const ctx = seeded();
    expect(ctx.store.credentialJournal.listPending()).toHaveLength(2);
    const result = await ctx.service.runPending();
    expect(result).toEqual({ done: 2, failed: 0, remaining: 0, skipped: false });
    expect(modelKey(ctx)).toBe('');
    expect(searchKey(ctx)).toBe('');
    expect(
      (
        await ctx.credentials.resolveForOwner({
          ownerKind: 'model-profile',
          ownerId: ctx.modelId,
          slot: 'api-key',
        })
      ).plaintext,
    ).toBe('sk-model-123');
    expect(
      ctx.store.credentialJournal.statusOf('api-service-profile', 'baidu_qianfan', 'api-key'),
    ).toBe('done');
  });

  it('is idempotent: a second run does not re-encrypt or bump versions', async () => {
    const ctx = seeded();
    await ctx.service.runPending();
    const before = await ctx.credentials.status({
      ownerKind: 'model-profile',
      ownerId: ctx.modelId,
      slot: 'api-key',
    });
    const again = await ctx.service.runPending();
    const after = await ctx.credentials.status({
      ownerKind: 'model-profile',
      ownerId: ctx.modelId,
      slot: 'api-key',
    });
    expect(again).toEqual({ done: 0, failed: 0, remaining: 0, skipped: false });
    expect(after.version).toBe(before.version);
  });

  it('skips everything and preserves plaintext when protected storage is unavailable', async () => {
    const ctx = seeded();
    ctx.store_.available = false;
    const result = await ctx.service.runPending();
    expect(result).toEqual({ done: 0, failed: 0, remaining: 2, skipped: true });
    expect(ctx.store.credentialJournal.listPending()).toHaveLength(2);
    expect(searchKey(ctx)).toBe('sk-search-456');
  });

  it('marks failed and never half-clears plaintext when the round-trip verification fails', async () => {
    const ctx = seeded();
    ctx.store_.corrupt = true;
    const result = await ctx.service.runPending();
    expect(result.failed).toBe(2);
    expect(result.done).toBe(0);
    expect(
      ctx.store.credentialJournal.statusOf('api-service-profile', 'baidu_qianfan', 'api-key'),
    ).toBe('failed');
    expect(searchKey(ctx)).toBe('sk-search-456');
  });

  it('collapses a vanished source row to done without writing a credential', async () => {
    const ctx = seeded();
    ctx.store.credentialJournal.ensurePending('mcp-connection', 'gone-conn', 'api-key');
    const status = await ctx.service.migrateOwner({
      ownerKind: 'mcp-connection',
      ownerId: 'gone-conn',
      slot: 'api-key',
      status: 'pending',
    });
    expect(status).toBe('done');
    expect(
      await ctx.credentials.status({
        ownerKind: 'mcp-connection',
        ownerId: 'gone-conn',
        slot: 'api-key',
      }),
    ).toEqual({ configured: false, available: false, version: 0 });
  });
});
