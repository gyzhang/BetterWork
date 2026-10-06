import { describe, expect, it } from 'vitest';

import type { SkillAdapterFactory } from './skill-adapter';
import { buildToolchainEnvironment, SkillAdapterService } from './skill-adapter';

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

describe('buildToolchainEnvironment', () => {
  it('maps each declared requirement to its own verified snapshot root', () => {
    expect(
      buildToolchainEnvironment(
        [
          { id: 'ppt-master', name: 'PPT Master', environmentVariable: 'PPTM_HOME' },
          { id: 'svg-tools', name: 'SVG Tools', environmentVariable: 'SVG_TOOLS_HOME' },
        ],
        {
          'ppt-master': '/managed/ppt-master',
          'svg-tools': '/managed/svg-tools',
        },
        [],
      ),
    ).toEqual({
      PPTM_HOME: '/managed/ppt-master',
      SVG_TOOLS_HOME: '/managed/svg-tools',
    });
  });

  it('preserves PPTM_HOME mapping for legacy profile requirements', () => {
    expect(
      buildToolchainEnvironment(undefined, { 'ppt-master': '/managed/ppt-master' }, ['ppt-master']),
    ).toEqual({
      PPTM_HOME: '/managed/ppt-master',
    });
  });

  it('does not infer a legacy mapping when the profile explicitly declares no toolchains', () => {
    expect(
      buildToolchainEnvironment([], { 'ppt-master': '/managed/ppt-master' }, ['ppt-master']),
    ).toEqual({});
  });
});
