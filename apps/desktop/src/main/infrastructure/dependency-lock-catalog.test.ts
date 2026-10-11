import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DependencyFileSystem } from './dependency-adapters';
import {
  DependencyLockError,
  listDependencyLocks,
  loadDependencyLock,
} from './dependency-lock-catalog';

afterEach(() => {
  vi.restoreAllMocks();
});

const createFakeFileSystem = (
  overrides: Partial<DependencyFileSystem> = {},
): DependencyFileSystem => ({
  exists: vi.fn().mockResolvedValue(false),
  mkdir: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(new Uint8Array()),
  readdir: vi.fn().mockResolvedValue([]),
  readdirEntries: vi.fn().mockResolvedValue([]),
  size: vi.fn().mockResolvedValue(0),
  realpath: vi.fn().mockResolvedValue(''),
  ...overrides,
});

const validLockJson = JSON.stringify({
  lockVersion: 1,
  platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
  pythonRequirement: '3.12',
  packages: [
    {
      name: 'python-pptx',
      version: '1.0.2',
      wheel: 'python_pptx-1.0.2-py3-none-any.whl',
      sha256: 'a'.repeat(64),
      source: 'wheelhouse',
    },
  ],
  importProbes: ['pptx'],
});

describe('DependencyLockError carries a stable error code', () => {
  it('sets .name to "DependencyLockError"', () => {
    const error = new DependencyLockError('lock-missing', 'not found');
    expect(error.name).toBe('DependencyLockError');
  });

  it('stores the code on .code', () => {
    const error = new DependencyLockError('invalid-lock-id', 'bad id');
    expect(error.code).toBe('invalid-lock-id');
  });

  it('is an instance of Error', () => {
    const error = new DependencyLockError('lock-invalid', 'bad json');
    expect(error).toBeInstanceOf(Error);
  });

  it('propagates cause when provided', () => {
    const cause = new Error('root');
    const error = new DependencyLockError('lock-missing', 'missing', { cause });
    expect(error.cause).toBe(cause);
  });
});

describe('listDependencyLocks returns sorted lock IDs from the directory', () => {
  it('returns only .json entries that match the lock ID pattern', async () => {
    const fs = createFakeFileSystem({
      readdir: vi
        .fn()
        .mockResolvedValue([
          'alpha.json',
          'beta.json',
          'not-json.txt',
          'INVALID.json',
          'gamma.json',
        ]),
    });
    const result = await listDependencyLocks('/locks', fs);
    expect(result).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('returns an empty array when the directory does not exist', async () => {
    const fs = createFakeFileSystem({
      readdir: vi.fn().mockRejectedValue(new Error('ENOENT')),
    });
    const result = await listDependencyLocks('/nonexistent', fs);
    expect(result).toEqual([]);
  });

  it('returns an empty array when the directory is empty', async () => {
    const fs = createFakeFileSystem({
      readdir: vi.fn().mockResolvedValue([]),
    });
    const result = await listDependencyLocks('/locks', fs);
    expect(result).toEqual([]);
  });

  it('filters out entries with path traversal characters', async () => {
    const fs = createFakeFileSystem({
      readdir: vi.fn().mockResolvedValue(['../etc/passwd.json', 'valid-lock.json']),
    });
    const result = await listDependencyLocks('/locks', fs);
    // '../etc/passwd' does not match the pattern because it starts with '.'
    expect(result).toEqual(['valid-lock']);
  });

  it('returns sorted results', async () => {
    const fs = createFakeFileSystem({
      readdir: vi.fn().mockResolvedValue(['charlie.json', 'alpha.json', 'bravo.json']),
    });
    const result = await listDependencyLocks('/locks', fs);
    expect(result).toEqual(['alpha', 'bravo', 'charlie']);
  });
});

describe('loadDependencyLock validates the lock ID to prevent path traversal', () => {
  it('rejects lock IDs containing path separators', async () => {
    const fs = createFakeFileSystem();
    await expect(loadDependencyLock('/locks', '../etc/passwd', fs)).rejects.toThrow(
      DependencyLockError,
    );
    await expect(loadDependencyLock('/locks', '../etc/passwd', fs)).rejects.toThrow(
      '非法的依赖锁标识',
    );
  });

  it('rejects lock IDs with uppercase characters', async () => {
    const fs = createFakeFileSystem();
    await expect(loadDependencyLock('/locks', 'MyLock', fs)).rejects.toThrow('非法的依赖锁标识');
  });

  it('rejects lock IDs starting with a hyphen', async () => {
    const fs = createFakeFileSystem();
    await expect(loadDependencyLock('/locks', '-invalid', fs)).rejects.toThrow('非法的依赖锁标识');
  });

  it('rejects empty lock IDs', async () => {
    const fs = createFakeFileSystem();
    await expect(loadDependencyLock('/locks', '', fs)).rejects.toThrow('非法的依赖锁标识');
  });

  it('rejects lock IDs exceeding 121 characters', async () => {
    const fs = createFakeFileSystem();
    await expect(loadDependencyLock('/locks', 'a'.repeat(122), fs)).rejects.toThrow(
      '非法的依赖锁标识',
    );
  });

  it('accepts lock IDs at the maximum length of 121 characters', async () => {
    const lockId = 'a'.repeat(121);
    const fs = createFakeFileSystem({
      readFile: vi.fn().mockResolvedValue(new TextEncoder().encode(validLockJson)),
    });
    const result = await loadDependencyLock('/locks', lockId, fs);
    expect(result.lockVersion).toBe(1);
  });

  it('does not call readFile when the lock ID is invalid', async () => {
    const readFile = vi.fn().mockResolvedValue(new Uint8Array());
    const fs = createFakeFileSystem({ readFile });
    await expect(loadDependencyLock('/locks', '../escape', fs)).rejects.toThrow();
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe('loadDependencyLock reads and validates the lock file', () => {
  it('returns a parsed DependencyLock for valid JSON', async () => {
    const fs = createFakeFileSystem({
      readFile: vi.fn().mockResolvedValue(new TextEncoder().encode(validLockJson)),
    });
    const result = await loadDependencyLock('/locks', 'my-lock', fs);
    expect(result.lockVersion).toBe(1);
    expect(result.platform).toEqual({ os: 'darwin', arch: 'arm64', abi: 'cp312' });
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]!.name).toBe('python-pptx');
    expect(result.importProbes).toEqual(['pptx']);
  });

  it('constructs the file path from locksRoot and lockId', async () => {
    const readFile = vi.fn().mockResolvedValue(new TextEncoder().encode(validLockJson));
    const fs = createFakeFileSystem({ readFile });
    await loadDependencyLock('/my/locks', 'test-lock', fs);
    expect(readFile).toHaveBeenCalledWith('/my/locks/test-lock.json');
  });

  it('throws lock-missing when readFile rejects', async () => {
    const fs = createFakeFileSystem({
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
    });
    try {
      await loadDependencyLock('/locks', 'missing-lock', fs);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DependencyLockError);
      expect((error as DependencyLockError).code).toBe('lock-missing');
      expect((error as DependencyLockError).message).toContain('missing-lock');
    }
  });

  it('throws lock-invalid when the file is not valid JSON', async () => {
    const fs = createFakeFileSystem({
      readFile: vi.fn().mockResolvedValue(new TextEncoder().encode('{broken json')),
    });
    try {
      await loadDependencyLock('/locks', 'bad-json', fs);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DependencyLockError);
      expect((error as DependencyLockError).code).toBe('lock-invalid');
      expect((error as DependencyLockError).message).toContain('不是合法 JSON');
    }
  });

  it('throws lock-invalid when the JSON does not match the schema', async () => {
    const invalidSchema = JSON.stringify({ lockVersion: 99 });
    const fs = createFakeFileSystem({
      readFile: vi.fn().mockResolvedValue(new TextEncoder().encode(invalidSchema)),
    });
    try {
      await loadDependencyLock('/locks', 'bad-schema', fs);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DependencyLockError);
      expect((error as DependencyLockError).code).toBe('lock-invalid');
      expect((error as DependencyLockError).message).toContain('不符合协议');
    }
  });

  it('includes the original error as cause for lock-missing', async () => {
    const originalError = new Error('ENOENT: no such file');
    const fs = createFakeFileSystem({
      readFile: vi.fn().mockRejectedValue(originalError),
    });
    try {
      await loadDependencyLock('/locks', 'gone', fs);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DependencyLockError).cause).toBe(originalError);
    }
  });

  it('includes the original error as cause for lock-invalid JSON', async () => {
    const fs = createFakeFileSystem({
      readFile: vi.fn().mockResolvedValue(new TextEncoder().encode('not json')),
    });
    try {
      await loadDependencyLock('/locks', 'broken', fs);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DependencyLockError).cause).toBeDefined();
    }
  });
});
