import type { ModelProfileInput, ModelRole } from '@betterwork/agent-protocol';
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

const baseInput: ModelProfileInput = {
  name: 'GPT-4o',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  roles: ['language'],
  apiKey: 'sk-test-key',
  maxContextTokens: 8192,
  maxOutputTokens: 4096,
  temperature: 0.7,
  enabled: true,
};

describe('ModelRepository', () => {
  it('assigns an independent priority for each selected role', () => {
    const store = openStore();
    const first = store.models.save({ ...baseInput, roles: ['language', 'vision'] });
    const second = store.models.save({
      ...baseInput,
      name: 'Second',
      roles: ['vision', 'language'],
    });

    expect(store.models.getWithSecret(first)?.roles).toEqual(['language', 'vision']);
    expect(store.models.getWithSecret(first)?.rolePriorities).toEqual({ language: 0, vision: 0 });
    expect(store.models.getWithSecret(second)?.rolePriorities).toEqual({ language: 1, vision: 1 });
    expect(store.models.getForRun('language')?.id).toBe(first);
    expect(store.models.getForRun('vision')?.id).toBe(first);
  });

  it('preserves role priorities that remain selected and appends a newly selected role', () => {
    const store = openStore();
    const languageFirst = store.models.save({ ...baseInput });
    const multi = store.models.save({ ...baseInput, name: 'Multi', roles: ['language', 'vision'] });
    store.models.setDefault(multi, 'language');

    store.models.save({ ...baseInput, id: multi, roles: ['language', 'vision', 'embedding'] });

    expect(store.models.getWithSecret(multi)?.rolePriorities).toEqual({
      language: 0,
      vision: 0,
      embedding: 0,
    });
    expect(store.models.getDefaultProfileId('language')).toBe(multi);
    expect(store.models.getDefaultProfileId('vision')).toBe(multi);
    expect(store.models.getDefaultProfileId('embedding')).toBe(multi);
    expect(store.models.getWithSecret(languageFirst)?.roles).toEqual(['language']);
  });

  it('removes role assignments when a model role is removed', () => {
    const store = openStore();
    const id = store.models.save({ ...baseInput, roles: ['language', 'vision'] });
    store.models.save({ ...baseInput, id, roles: ['language'] });

    expect(store.models.getWithSecret(id)?.roles).toEqual(['language']);
    expect(store.models.getForRun('vision')).toBeUndefined();
  });

  it('returns a provided id or generates a uuid', () => {
    const store = openStore();
    expect(store.models.save({ ...baseInput, id: 'custom-id' })).toBe('custom-id');
    expect(store.models.save({ ...baseInput })).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('resets connection status on update and retains an empty API key', () => {
    const store = openStore();
    const id = store.models.save({ ...baseInput, apiKey: 'sk-original' });
    store.models.recordConnection(id, 'connected');
    store.models.save({ ...baseInput, id, apiKey: '' });

    expect(store.models.getWithSecret(id)?.apiKey).toBe('sk-original');
    expect(store.models.list().find((model) => model.id === id)).toMatchObject({
      connectionStatus: 'untested',
    });
    expect(store.models.list().find((model) => model.id === id)?.lastTestedAt).toBeUndefined();
  });

  it('overwrites a saved API key when a replacement is provided', () => {
    const store = openStore();
    const id = store.models.save({ ...baseInput, apiKey: 'sk-old' });
    store.models.save({ ...baseInput, id, apiKey: 'sk-new' });
    expect(store.models.getWithSecret(id)?.apiKey).toBe('sk-new');
  });

  it('returns an enabled profile for any role it supports and skips disabled profiles', () => {
    const store = openStore();
    const disabled = store.models.save({
      ...baseInput,
      enabled: false,
      roles: ['language', 'vision'],
    });
    const enabled = store.models.save({ ...baseInput, name: 'Enabled', roles: ['vision'] });

    expect(store.models.getForRun('language')).toBeUndefined();
    expect(store.models.getForRun('vision')?.id).toBe(enabled);
    expect(store.models.getDefaultProfileId('vision')).toBe(enabled);
    expect(store.models.getWithSecret(disabled)?.enabled).toBe(false);
    expect(store.models.getDefaultProfileId('embedding')).toBeUndefined();
  });

  it('sets one role default and shifts only that role assignment order', () => {
    const store = openStore();
    const first = store.models.save({ ...baseInput, roles: ['language', 'vision'] });
    const second = store.models.save({
      ...baseInput,
      name: 'Second',
      roles: ['language', 'vision'],
    });
    const visionOnly = store.models.save({ ...baseInput, name: 'Vision', roles: ['vision'] });

    expect(store.models.setDefault(second, 'language')).toBe(true);
    expect(store.models.getDefaultProfileId('language')).toBe(second);
    expect(store.models.getDefaultProfileId('vision')).toBe(first);
    expect(store.models.getWithSecret(first)?.rolePriorities.language).toBe(1);
    expect(store.models.getWithSecret(first)?.rolePriorities.vision).toBe(0);
    expect(store.models.getWithSecret(visionOnly)?.rolePriorities.vision).toBe(2);
  });

  it('does not set a role default for disabled profiles or roles the profile lacks', () => {
    const store = openStore();
    const disabled = store.models.save({ ...baseInput, enabled: false });
    const languageOnly = store.models.save({ ...baseInput, name: 'Language only' });

    expect(store.models.setDefault(disabled, 'language')).toBe(false);
    expect(store.models.setDefault(languageOnly, 'vision')).toBe(false);
    expect(store.models.setDefault('ghost', 'language')).toBe(false);
  });

  it('reads and clears the legacy plaintext key', () => {
    const store = openStore();
    const id = store.models.save({ ...baseInput, apiKey: 'sk-legacy' });
    expect(store.models.readPlaintextApiKey(id)).toBe('sk-legacy');
    store.models.clearPlaintextApiKey(id);
    expect(store.models.readPlaintextApiKey(id)).toBe('');
    expect(store.models.readPlaintextApiKey('nope')).toBeUndefined();
  });

  it('deletes role assignments with the model profile', () => {
    const store = openStore();
    const id = store.models.save({ ...baseInput, roles: ['language', 'vision'] });
    expect(store.models.delete(id)).toBe(true);
    expect(store.models.list().find((model) => model.id === id)).toBeUndefined();
    expect(store.models.getForRun('language')).toBeUndefined();
    expect(store.models.delete('ghost')).toBe(false);
  });

  it('toggles enablement and records connection results', () => {
    const store = openStore();
    const id = store.models.save({ ...baseInput });
    expect(store.models.setEnabled(id, false)).toBe(true);
    expect(store.models.list().find((model) => model.id === id)?.enabled).toBe(false);
    expect(store.models.setEnabled(id, true)).toBe(true);
    store.models.recordConnection(id, 'connected');
    expect(store.models.list().find((model) => model.id === id)).toMatchObject({
      enabled: true,
      connectionStatus: 'connected',
      lastTestedAt: expect.any(Number),
    });
    expect(store.models.setEnabled('ghost', true)).toBe(false);
  });

  it('uses canonical roles in summaries even when the form order differs', () => {
    const store = openStore();
    const id = store.models.save({
      ...baseInput,
      roles: ['embedding', 'vision', 'language'] as ModelRole[],
    });
    expect(store.models.list().find((model) => model.id === id)?.roles).toEqual([
      'language',
      'vision',
      'embedding',
    ]);
  });
});
