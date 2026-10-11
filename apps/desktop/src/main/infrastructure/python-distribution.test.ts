import { describe, expect, it } from 'vitest';

import {
  abiTagOf,
  findDistribution,
  findDistributionForPlatform,
  pythonDistributions,
} from './python-distribution';

describe('pythonDistributions data integrity', () => {
  it('contains at least one distribution for the supported platform', () => {
    expect(pythonDistributions.length).toBeGreaterThanOrEqual(1);
  });

  it.each(pythonDistributions.map((d) => [d.id, d]))(
    '%s: url matches fileName and points to github.com',
    (_id, distribution) => {
      expect(distribution.url).toContain(distribution.fileName);
      expect(distribution.url).toContain('github.com');
    },
  );

  it.each(pythonDistributions.map((d) => [d.id, d]))(
    '%s: sha256 is a 64-character hex string',
    (_id, distribution) => {
      expect(distribution.sha256).toMatch(/^[0-9a-f]{64}$/u);
    },
  );

  it.each(pythonDistributions.map((d) => [d.id, d]))(
    '%s: entryRelativePath points to a python interpreter',
    (_id, distribution) => {
      expect(distribution.entryRelativePath).toContain('python');
    },
  );

  it.each(pythonDistributions.map((d) => [d.id, d]))(
    '%s: abi tag matches the declared version',
    (_id, distribution) => {
      expect(distribution.platform.abi).toBe(abiTagOf(distribution.version));
    },
  );
});

describe('findDistribution', () => {
  it('returns the distribution matching the given id', () => {
    const target = pythonDistributions[0];
    expect(target).toBeDefined();
    expect(findDistribution(target!.id)).toBe(target);
  });

  it('returns undefined for an unknown id', () => {
    expect(findDistribution('python-99.99.99-darwin-arm64')).toBeUndefined();
  });
});

describe('findDistributionForPlatform', () => {
  it('returns the distribution for darwin/arm64/cp312', () => {
    const result = findDistributionForPlatform({ os: 'darwin', arch: 'arm64', abi: 'cp312' });
    expect(result).toBeDefined();
    expect(result!.platform).toEqual({ os: 'darwin', arch: 'arm64', abi: 'cp312' });
  });

  it('returns undefined for a mismatched ABI', () => {
    expect(
      findDistributionForPlatform({ os: 'darwin', arch: 'arm64', abi: 'cp311' }),
    ).toBeUndefined();
  });

  it('returns undefined for an unsupported OS', () => {
    expect(findDistributionForPlatform({ os: 'linux', arch: 'x64', abi: 'cp312' })).toBeUndefined();
  });
});

describe('abiTagOf', () => {
  it.each([
    ['3.12.14', 'cp312'],
    ['3.11.0', 'cp311'],
    ['3.10.8', 'cp310'],
    ['4.0.0', 'cp40'],
  ])('derives %s → %s', (version, expected) => {
    expect(abiTagOf(version)).toBe(expected);
  });

  it.each(['', 'abc', '3', '.12'])('returns null for invalid version %s', (version) => {
    expect(abiTagOf(version)).toBeNull();
  });
});
