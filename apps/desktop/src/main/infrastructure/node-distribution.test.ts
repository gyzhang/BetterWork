import { describe, expect, it } from 'vitest';

import {
  findNodeDistribution,
  findNodeDistributionForPlatform,
  nodeDistributions,
} from './node-distribution';

describe('nodeDistributions data integrity', () => {
  it('contains at least one distribution for the supported platform', () => {
    expect(nodeDistributions.length).toBeGreaterThanOrEqual(1);
  });

  it.each(nodeDistributions.map((d) => [d.id, d]))(
    '%s: url matches fileName and points to nodejs.org',
    (_id, distribution) => {
      expect(distribution.url).toContain(distribution.fileName);
      expect(distribution.url).toMatch(/^https:\/\/nodejs\.org\/dist\//u);
    },
  );

  it.each(nodeDistributions.map((d) => [d.id, d]))(
    '%s: sha256 is a 64-character hex string',
    (_id, distribution) => {
      expect(distribution.sha256).toMatch(/^[0-9a-f]{64}$/u);
    },
  );

  it.each(nodeDistributions.map((d) => [d.id, d]))(
    '%s: entryRelativePath starts with the distribution directory',
    (_id, distribution) => {
      expect(distribution.entryRelativePath).toMatch(/^node-v/u);
      expect(distribution.entryRelativePath).toContain('/bin/node');
    },
  );

  it.each(nodeDistributions.map((d) => [d.id, d]))(
    '%s: id encodes version and platform',
    (_id, distribution) => {
      expect(distribution.id).toContain(distribution.version);
      expect(distribution.id).toContain(distribution.platform.os);
      expect(distribution.id).toContain(distribution.platform.arch);
    },
  );
});

describe('findNodeDistribution', () => {
  it('returns the distribution matching the given id', () => {
    const target = nodeDistributions[0];
    expect(target).toBeDefined();
    expect(findNodeDistribution(target!.id)).toBe(target);
  });

  it('returns undefined for an unknown id', () => {
    expect(findNodeDistribution('node-99.99.99-darwin-arm64')).toBeUndefined();
  });
});

describe('findNodeDistributionForPlatform', () => {
  it('returns the distribution for darwin/arm64', () => {
    const result = findNodeDistributionForPlatform({ os: 'darwin', arch: 'arm64' });
    expect(result).toBeDefined();
    expect(result!.platform.os).toBe('darwin');
    expect(result!.platform.arch).toBe('arm64');
  });

  it('returns undefined for an unsupported platform', () => {
    expect(findNodeDistributionForPlatform({ os: 'win32', arch: 'x64' })).toBeUndefined();
  });
});
