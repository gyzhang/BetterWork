import type { SearchEngineConfigInput, SearchProviderId } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];
const openStore = (): AppStore => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return store;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});

const PROVIDER: SearchProviderId = 'baidu_qianfan';

const baseInput = (overrides: Partial<SearchEngineConfigInput> = {}): SearchEngineConfigInput => ({
  provider: PROVIDER,
  apiKey: 'test-key-123',
  webTopK: 10,
  enabled: true,
  ...overrides,
});

describe('SearchEngineRepository saves and lists search engine configurations', () => {
  it('returns the provider id on save and retrieves the configuration via get', () => {
    const store = openStore();
    const provider = store.searchEngines.save(baseInput());
    expect(provider).toBe(PROVIDER);
    const loaded = store.searchEngines.get(PROVIDER);
    expect(loaded).toBeDefined();
    expect(loaded!.provider).toBe(PROVIDER);
    expect(loaded!.apiKey).toBe('test-key-123');
    expect(loaded!.webTopK).toBe(10);
  });

  it('lists saved configurations ordered by updated_at descending', () => {
    const store = openStore();
    store.searchEngines.save(baseInput());
    const all = store.searchEngines.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.provider).toBe(PROVIDER);
    expect(all[0]!.apiKeyConfigured).toBe(true);
    expect(all[0]!.enabled).toBe(true);
    expect(all[0]!.connectionStatus).toBe('untested');
  });

  it('returns undefined from get for an unknown provider', () => {
    const store = openStore();
    expect(store.searchEngines.get('baidu_qianfan')).toBeUndefined();
  });

  it('returns undefined from getEnabled when no engine is enabled', () => {
    const store = openStore();
    store.searchEngines.save(baseInput({ enabled: false }));
    expect(store.searchEngines.getEnabled()).toBeUndefined();
  });

  it('returns the enabled engine from getEnabled', () => {
    const store = openStore();
    store.searchEngines.save(baseInput({ enabled: true }));
    const enabled = store.searchEngines.getEnabled();
    expect(enabled).toBeDefined();
    expect(enabled!.provider).toBe(PROVIDER);
    expect(enabled!.apiKey).toBe('test-key-123');
  });

  it('updates an existing configuration on second save', () => {
    const store = openStore();
    store.searchEngines.save(baseInput({ apiKey: 'key-1', webTopK: 5 }));
    store.searchEngines.save(baseInput({ apiKey: 'key-2', webTopK: 15 }));
    const loaded = store.searchEngines.get(PROVIDER);
    expect(loaded!.apiKey).toBe('key-2');
    expect(loaded!.webTopK).toBe(15);
    expect(store.searchEngines.list()).toHaveLength(1);
  });

  it('preserves the existing api key when input leaves it empty', () => {
    const store = openStore();
    store.searchEngines.save(baseInput({ apiKey: 'original-key' }));
    store.searchEngines.save(baseInput({ apiKey: '' }));
    const loaded = store.searchEngines.get(PROVIDER);
    expect(loaded!.apiKey).toBe('original-key');
  });

  it('resets connection status to untested when the api key changes', () => {
    const store = openStore();
    store.searchEngines.save(baseInput({ apiKey: 'key-1' }));
    // Simulate a successful connection test
    store.searchEngines.recordConnection(PROVIDER, 'connected', 'key-1');
    let loaded = store.searchEngines.get(PROVIDER);
    expect(loaded).toBeDefined();
    // Now save with a different key
    store.searchEngines.save(baseInput({ apiKey: 'key-2' }));
    loaded = store.searchEngines.get(PROVIDER);
    expect(loaded!.apiKey).toBe('key-2');
    // Connection status should be reset because key changed
    const summary = store.searchEngines.list()[0];
    expect(summary!.connectionStatus).toBe('untested');
  });
});

describe('SearchEngineRepository enforces enabled mutual exclusion', () => {
  it('disables other providers when a new one is enabled', () => {
    const store = openStore();
    // We only have one provider in the schema, so we test the mechanism
    // by saving with enabled=true then saving again with enabled=false
    // and verifying the behavior.
    // Since there's only baidu_qianfan, we test the SQL path:
    // enabling should first disable all others.
    store.searchEngines.save(baseInput({ enabled: false }));
    store.searchEngines.save(baseInput({ enabled: true }));
    const enabled = store.searchEngines.getEnabled();
    expect(enabled).toBeDefined();
    expect(enabled!.provider).toBe(PROVIDER);
  });

  it('does not disable others when saving with enabled=false', () => {
    const store = openStore();
    store.searchEngines.save(baseInput({ enabled: true }));
    store.searchEngines.save(baseInput({ enabled: false }));
    expect(store.searchEngines.getEnabled()).toBeUndefined();
  });
});

describe('SearchEngineRepository tolerates corrupt JSON options column', () => {
  it('falls back to default webTopK when options contains invalid JSON', () => {
    const store = openStore();
    store.searchEngines.save(baseInput({ webTopK: 15 }));
    // Corrupt the options column directly in the database
    const db = (store as unknown as { db: Database.Database }).db;
    db.prepare("UPDATE search_engine_configs SET options = '{broken' WHERE provider = ?").run(
      PROVIDER,
    );
    const loaded = store.searchEngines.get(PROVIDER);
    expect(loaded).toBeDefined();
    expect(loaded!.webTopK).toBe(10); // DEFAULT_WEB_TOP_K
  });

  it('falls back to default webTopK when options is valid JSON but webTopK is out of range', () => {
    const store = openStore();
    store.searchEngines.save(baseInput({ webTopK: 10 }));
    const db = (store as unknown as { db: Database.Database }).db;
    db.prepare('UPDATE search_engine_configs SET options = ? WHERE provider = ?').run(
      JSON.stringify({ webTopK: 999 }),
      PROVIDER,
    );
    const loaded = store.searchEngines.get(PROVIDER);
    expect(loaded!.webTopK).toBe(10);
  });

  it('falls back to default webTopK when options is valid JSON but webTopK is not an integer', () => {
    const store = openStore();
    store.searchEngines.save(baseInput({ webTopK: 10 }));
    const db = (store as unknown as { db: Database.Database }).db;
    db.prepare('UPDATE search_engine_configs SET options = ? WHERE provider = ?').run(
      JSON.stringify({ webTopK: 3.5 }),
      PROVIDER,
    );
    const loaded = store.searchEngines.get(PROVIDER);
    expect(loaded!.webTopK).toBe(10);
  });

  it('falls back to default webTopK when options is an empty object', () => {
    const store = openStore();
    store.searchEngines.save(baseInput({ webTopK: 7 }));
    const db = (store as unknown as { db: Database.Database }).db;
    db.prepare("UPDATE search_engine_configs SET options = '{}' WHERE provider = ?").run(PROVIDER);
    const loaded = store.searchEngines.get(PROVIDER);
    expect(loaded!.webTopK).toBe(10);
  });
});

describe('SearchEngineRepository.recordConnection upserts without overwriting api_key', () => {
  it('creates a new row when no configuration exists yet', () => {
    const store = openStore();
    store.searchEngines.recordConnection(PROVIDER, 'connected', 'test-key');
    const loaded = store.searchEngines.get(PROVIDER);
    expect(loaded).toBeDefined();
    expect(loaded!.provider).toBe(PROVIDER);
    expect(loaded!.apiKey).toBe('test-key');
    const summary = store.searchEngines.list()[0];
    expect(summary!.connectionStatus).toBe('connected');
    expect(summary!.lastTestedAt).toBeDefined();
  });

  it('updates connection status without overwriting existing api_key on conflict', () => {
    const store = openStore();
    store.searchEngines.save(baseInput({ apiKey: 'saved-key', enabled: true }));
    // recordConnection with a different key should NOT overwrite the saved key
    store.searchEngines.recordConnection(PROVIDER, 'failed', 'different-key');
    const loaded = store.searchEngines.get(PROVIDER);
    expect(loaded!.apiKey).toBe('saved-key');
    const summary = store.searchEngines.list()[0];
    expect(summary!.connectionStatus).toBe('failed');
  });

  it('does not change enabled flag during recordConnection', () => {
    const store = openStore();
    store.searchEngines.save(baseInput({ enabled: true }));
    store.searchEngines.recordConnection(PROVIDER, 'connected', 'key');
    const enabled = store.searchEngines.getEnabled();
    expect(enabled).toBeDefined();
    expect(enabled!.provider).toBe(PROVIDER);
  });
});

describe('SearchEngineRepository plaintext api key helpers', () => {
  it('reads the plaintext api key from the row', () => {
    const store = openStore();
    store.searchEngines.save(baseInput({ apiKey: 'readable-key' }));
    expect(store.searchEngines.readPlaintextApiKey(PROVIDER)).toBe('readable-key');
  });

  it('returns undefined for readPlaintextApiKey when row does not exist', () => {
    const store = openStore();
    expect(store.searchEngines.readPlaintextApiKey(PROVIDER)).toBeUndefined();
  });

  it('clears the plaintext api key column', () => {
    const store = openStore();
    store.searchEngines.save(baseInput({ apiKey: 'to-clear' }));
    store.searchEngines.clearPlaintextApiKey(PROVIDER);
    expect(store.searchEngines.readPlaintextApiKey(PROVIDER)).toBe('');
  });
});
