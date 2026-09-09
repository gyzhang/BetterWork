import { describe, expect, it } from 'vitest';

import type { SkillAdapterFactory } from './skill-adapter';
import { SkillAdapterService } from './skill-adapter';

describe('SkillAdapterService', () => {
  const makeFactory = (name: string): SkillAdapterFactory => ({
    create(contentHashes) {
      return {
        name,
        isCompatible(contentHash: string) {
          return contentHashes.includes(contentHash);
        },
        resolveCommand() {
          return undefined;
        },
      };
    },
  });

  it('returns undefined when no adapters are registered', () => {
    const service = new SkillAdapterService();
    expect(service.findAdapter('any-hash')).toBeUndefined();
  });

  it('finds adapter by matching content hash', () => {
    const service = new SkillAdapterService();
    service.register(makeFactory('alpha'), ['hash-a', 'hash-b']);
    const found = service.findAdapter('hash-a');
    expect(found).toBeDefined();
    expect(found?.name).toBe('alpha');
  });

  it('returns undefined for unknown content hash', () => {
    const service = new SkillAdapterService();
    service.register(makeFactory('alpha'), ['hash-a']);
    expect(service.findAdapter('hash-unknown')).toBeUndefined();
  });

  it('returns the first matching adapter when multiple are registered', () => {
    const service = new SkillAdapterService();
    service.register(makeFactory('alpha'), ['hash-a']);
    service.register(makeFactory('beta'), ['hash-a', 'hash-b']);
    const found = service.findAdapter('hash-a');
    expect(found?.name).toBe('alpha');
  });

  it('falls through to second adapter when first does not match', () => {
    const service = new SkillAdapterService();
    service.register(makeFactory('alpha'), ['hash-a']);
    service.register(makeFactory('beta'), ['hash-b']);
    const found = service.findAdapter('hash-b');
    expect(found?.name).toBe('beta');
  });
});
