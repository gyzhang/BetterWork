import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});

function openStore(): AppStore {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return store;
}

const baseInput = {
  name: 'GPT-4o',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  role: 'language' as const,
  apiKey: 'sk-test-key',
  maxContextTokens: 8192,
  maxOutputTokens: 4096,
  temperature: 0.7,
  enabled: true,
};

describe('ModelRepository', () => {
  describe('save (insert)', () => {
    it('assigns auto-incremented priority when none provided', () => {
      const store = openStore();
      const id1 = store.models.save({ ...baseInput });
      const id2 = store.models.save({ ...baseInput, name: 'Second' });

      const all = store.models.list();
      const first = all.find((m) => m.id === id1);
      const second = all.find((m) => m.id === id2);
      expect(first?.priority).toBe(0);
      expect(second?.priority).toBe(1);
    });

    it('respects explicit priority', () => {
      const store = openStore();
      const id = store.models.save({ ...baseInput, priority: 5 });
      expect(store.models.list().find((m) => m.id === id)?.priority).toBe(5);
    });

    it('returns the provided id when given', () => {
      const store = openStore();
      const id = store.models.save({ ...baseInput, id: 'custom-id' });
      expect(id).toBe('custom-id');
    });

    it('generates a uuid when no id provided', () => {
      const store = openStore();
      const id = store.models.save({ ...baseInput });
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('sets connection_status to untested and lastTestedAt absent', () => {
      const store = openStore();
      const id = store.models.save({ ...baseInput });
      const summary = store.models.list().find((m) => m.id === id);
      expect(summary?.connectionStatus).toBe('untested');
      expect(summary?.lastTestedAt).toBeUndefined();
    });
  });

  describe('save (update / upsert)', () => {
    it('preserves existing apiKey when update sends empty string', () => {
      const store = openStore();
      const id = store.models.save({ ...baseInput, apiKey: 'sk-original' });
      store.models.save({ ...baseInput, id, apiKey: '' });

      const withSecret = store.models.getWithSecret(id);
      expect(withSecret?.apiKey).toBe('sk-original');
    });

    it('overwrites apiKey when update provides a new one', () => {
      const store = openStore();
      const id = store.models.save({ ...baseInput, apiKey: 'sk-old' });
      store.models.save({ ...baseInput, id, apiKey: 'sk-new' });

      expect(store.models.getWithSecret(id)?.apiKey).toBe('sk-new');
    });

    it('resets connection status on update', () => {
      const store = openStore();
      const id = store.models.save({ ...baseInput });
      store.models.recordConnection(id, 'connected');
      store.models.save({ ...baseInput, id });

      const summary = store.models.list().find((m) => m.id === id);
      expect(summary?.connectionStatus).toBe('untested');
      expect(summary?.lastTestedAt).toBeUndefined();
    });

    it('keeps original priority when update sends null', () => {
      const store = openStore();
      const id = store.models.save({ ...baseInput, priority: 3 });
      store.models.save({ ...baseInput, id, priority: undefined });

      expect(store.models.list().find((m) => m.id === id)?.priority).toBe(3);
    });
  });

  describe('list', () => {
    it('orders by priority ASC then created_at ASC', () => {
      const store = openStore();
      const idA = store.models.save({ ...baseInput, priority: 2 });
      const idB = store.models.save({ ...baseInput, name: 'B', priority: 0 });
      const idC = store.models.save({ ...baseInput, name: 'C', priority: 2 });

      const ids = store.models.list().map((m) => m.id);
      expect(ids[0]).toBe(idB);
      expect(ids.indexOf(idA)).toBeLessThan(ids.indexOf(idC));
    });
  });

  describe('getWithSecret', () => {
    it('returns undefined for nonexistent id', () => {
      const store = openStore();
      expect(store.models.getWithSecret('no-such-id')).toBeUndefined();
    });

    it('includes the plaintext apiKey', () => {
      const store = openStore();
      const id = store.models.save({ ...baseInput, apiKey: 'sk-secret' });
      const result = store.models.getWithSecret(id);
      expect(result?.apiKey).toBe('sk-secret');
      expect(result?.id).toBe(id);
    });
  });

  describe('getForRun', () => {
    it('returns the enabled profile with lowest priority for the role', () => {
      const store = openStore();
      store.models.save({ ...baseInput, priority: 5 });
      const expected = store.models.save({
        ...baseInput,
        name: 'Winner',
        model: 'gpt-4o-mini',
        priority: 1,
      });

      const result = store.models.getForRun('language');
      expect(result?.id).toBe(expected);
      expect(result?.model).toBe('gpt-4o-mini');
      expect(result?.baseUrl).toBe(baseInput.baseUrl);
      expect(result?.apiKey).toBe(baseInput.apiKey);
      expect(result?.temperature).toBe(baseInput.temperature);
      expect(result?.maxOutputTokens).toBe(baseInput.maxOutputTokens);
    });

    it('skips disabled profiles', () => {
      const store = openStore();
      store.models.save({ ...baseInput, priority: 0, enabled: false });
      const fallback = store.models.save({
        ...baseInput,
        name: 'Fallback',
        priority: 1,
      });

      expect(store.models.getForRun('language')?.id).toBe(fallback);
    });

    it('returns undefined when no profile matches the role', () => {
      const store = openStore();
      store.models.save({ ...baseInput, role: 'vision' });
      expect(store.models.getForRun('language')).toBeUndefined();
    });

    it('returns undefined when all matching profiles are disabled', () => {
      const store = openStore();
      store.models.save({ ...baseInput, enabled: false });
      expect(store.models.getForRun('language')).toBeUndefined();
    });
  });

  describe('getDefaultProfileId', () => {
    it('returns the enabled profile with lowest priority for the role', () => {
      const store = openStore();
      store.models.save({ ...baseInput, priority: 3 });
      const expected = store.models.save({
        ...baseInput,
        name: 'Default',
        priority: 0,
      });

      expect(store.models.getDefaultProfileId('language')).toBe(expected);
    });

    it('ignores disabled profiles', () => {
      const store = openStore();
      store.models.save({ ...baseInput, priority: 0, enabled: false });
      const fallback = store.models.save({
        ...baseInput,
        name: 'Fallback',
        priority: 1,
      });

      expect(store.models.getDefaultProfileId('language')).toBe(fallback);
    });

    it('returns undefined when no enabled profile exists for the role', () => {
      const store = openStore();
      expect(store.models.getDefaultProfileId('embedding')).toBeUndefined();
    });
  });

  describe('readPlaintextApiKey / clearPlaintextApiKey', () => {
    it('reads the key then clears it to empty', () => {
      const store = openStore();
      const id = store.models.save({ ...baseInput, apiKey: 'sk-legacy' });

      expect(store.models.readPlaintextApiKey(id)).toBe('sk-legacy');

      store.models.clearPlaintextApiKey(id);
      expect(store.models.readPlaintextApiKey(id)).toBe('');
    });

    it('returns undefined for nonexistent id', () => {
      const store = openStore();
      expect(store.models.readPlaintextApiKey('nope')).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('removes the profile and returns true', () => {
      const store = openStore();
      const id = store.models.save({ ...baseInput });
      expect(store.models.delete(id)).toBe(true);
      expect(store.models.list().find((m) => m.id === id)).toBeUndefined();
    });

    it('returns false for nonexistent id', () => {
      const store = openStore();
      expect(store.models.delete('ghost')).toBe(false);
    });
  });

  describe('setDefault', () => {
    it('sets target to priority 0 and shifts siblings up', () => {
      const store = openStore();
      const idA = store.models.save({ ...baseInput, priority: 0 });
      const idB = store.models.save({ ...baseInput, name: 'B', priority: 1 });
      const idC = store.models.save({ ...baseInput, name: 'C', priority: 2 });

      expect(store.models.setDefault(idB)).toBe(true);

      const list = store.models.list();
      expect(list.find((m) => m.id === idB)?.priority).toBe(0);
      expect(list.find((m) => m.id === idA)?.priority).toBe(1);
      expect(list.find((m) => m.id === idC)?.priority).toBe(3);
    });

    it('does not affect profiles of a different role', () => {
      const store = openStore();
      const langId = store.models.save({ ...baseInput, priority: 0 });
      const visionId = store.models.save({
        ...baseInput,
        name: 'Vision',
        role: 'vision',
        priority: 0,
      });

      store.models.setDefault(
        store.models.save({ ...baseInput, name: 'New Lang', priority: 5 }).id ?? '',
      );

      expect(store.models.list().find((m) => m.id === visionId)?.priority).toBe(0);
      expect(store.models.list().find((m) => m.id === langId)?.priority).toBeGreaterThanOrEqual(0);
    });

    it('returns false for disabled profile', () => {
      const store = openStore();
      const id = store.models.save({ ...baseInput, enabled: false });
      expect(store.models.setDefault(id)).toBe(false);
    });

    it('returns false for nonexistent id', () => {
      const store = openStore();
      expect(store.models.setDefault('ghost')).toBe(false);
    });
  });

  describe('setEnabled', () => {
    it('toggles the enabled flag', () => {
      const store = openStore();
      const id = store.models.save({ ...baseInput });
      expect(store.models.setEnabled(id, false)).toBe(true);
      expect(store.models.list().find((m) => m.id === id)?.enabled).toBe(false);

      expect(store.models.setEnabled(id, true)).toBe(true);
      expect(store.models.list().find((m) => m.id === id)?.enabled).toBe(true);
    });

    it('returns false for nonexistent id', () => {
      const store = openStore();
      expect(store.models.setEnabled('ghost', true)).toBe(false);
    });
  });

  describe('recordConnection', () => {
    it('updates connection_status and last_tested_at', () => {
      const store = openStore();
      const id = store.models.save({ ...baseInput });

      store.models.recordConnection(id, 'connected');
      const summary = store.models.list().find((m) => m.id === id);
      expect(summary?.connectionStatus).toBe('connected');
      expect(summary?.lastTestedAt).toBeGreaterThan(0);
    });

    it('overwrites previous status', () => {
      const store = openStore();
      const id = store.models.save({ ...baseInput });

      store.models.recordConnection(id, 'connected');
      store.models.recordConnection(id, 'error');
      expect(store.models.list().find((m) => m.id === id)?.connectionStatus).toBe('error');
    });
  });

  describe('apiKeyConfigured (dual-track)', () => {
    it('true when plaintext column is non-empty', () => {
      const store = openStore();
      const id = store.models.save({ ...baseInput, apiKey: 'sk-present' });
      expect(store.models.list().find((m) => m.id === id)?.apiKeyConfigured).toBe(true);
    });

    it('false when plaintext is empty and no credential row', () => {
      const store = openStore();
      const id = store.models.save({ ...baseInput, apiKey: '' });
      expect(store.models.list().find((m) => m.id === id)?.apiKeyConfigured).toBe(false);
    });

    it('true when plaintext is empty but hasCredential reports a credential', async () => {
      const store = openStore();
      const id = store.models.save({ ...baseInput, apiKey: '' });

      const db = (store as unknown as { db: Database.Database }).db;
      db.prepare(
        `INSERT INTO credentials (owner_kind, owner_id, slot, ciphertext, created_at, updated_at)
         VALUES ('model-profile', ?, 'api-key', 'encrypted-blob', 0, 0)`,
      ).run(id);

      const hasCredential = () => true;
      const { ModelRepository } = await import('./model-repository');
      const repo = new ModelRepository(db, hasCredential);
      expect(repo.list().find((m) => m.id === id)?.apiKeyConfigured).toBe(true);
    });
  });
});
