import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});

describe('RunSettingsRepository', () => {
  it('returns the seeded default row', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const settings = store.runSettings.get();
    expect(settings.maxSkillToolRounds).toBeGreaterThanOrEqual(1);
    expect(typeof settings.enableBuiltinSkills).toBe('boolean');
    expect(typeof settings.enableBuiltinExperts).toBe('boolean');
    expect(settings.updatedAt).toBeGreaterThanOrEqual(0);
  });

  it('round-trips boolean values through integer storage', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const saved = store.runSettings.save({
      maxSkillToolRounds: 50,
      enableBuiltinSkills: false,
      enableBuiltinExperts: false,
    });
    expect(saved.enableBuiltinSkills).toBe(false);
    expect(saved.enableBuiltinExperts).toBe(false);
    expect(saved.maxSkillToolRounds).toBe(50);

    const restored = store.runSettings.save({
      maxSkillToolRounds: 50,
      enableBuiltinSkills: true,
      enableBuiltinExperts: true,
    });
    expect(restored.enableBuiltinSkills).toBe(true);
    expect(restored.enableBuiltinExperts).toBe(true);
  });

  it('updates the timestamp on save', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const before = store.runSettings.get();
    const saved = store.runSettings.save({
      maxSkillToolRounds: 100,
      enableBuiltinSkills: true,
      enableBuiltinExperts: true,
    });
    expect(saved.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it('persists the saved values for subsequent reads', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    store.runSettings.save({
      maxSkillToolRounds: 75,
      enableBuiltinSkills: false,
      enableBuiltinExperts: true,
    });
    const result = store.runSettings.get();
    expect(result.maxSkillToolRounds).toBe(75);
    expect(result.enableBuiltinSkills).toBe(false);
    expect(result.enableBuiltinExperts).toBe(true);
  });

  it('is a singleton row: save does not create a second row', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    store.runSettings.save({
      maxSkillToolRounds: 10,
      enableBuiltinSkills: true,
      enableBuiltinExperts: false,
    });
    const first = store.runSettings.get();
    store.runSettings.save({
      maxSkillToolRounds: 20,
      enableBuiltinSkills: false,
      enableBuiltinExperts: true,
    });
    const second = store.runSettings.get();
    expect(second.maxSkillToolRounds).toBe(20);
    expect(first.maxSkillToolRounds).toBe(10);
  });
});
