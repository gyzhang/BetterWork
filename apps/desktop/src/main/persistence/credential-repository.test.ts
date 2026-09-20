import { type CredentialErrorCode, MAX_CREDENTIAL_LENGTH } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { openAppDatabase } from '../db';
import type { SafeStorageAdapter } from '../infrastructure/credential-store';
import {
  CredentialError,
  type CredentialOwnerRef,
  CredentialRepository,
} from './credential-repository';

const ref = (slot = 'api-key', ownerId = 'profile-1'): CredentialOwnerRef => ({
  ownerKind: 'api-service-profile',
  ownerId,
  slot,
});

class FakeCredentialStore implements SafeStorageAdapter {
  available = true;
  failEncrypt = false;
  failDecrypt = false;

  async isAvailableAsync(): Promise<boolean> {
    return this.available;
  }
  async encryptAsync(plaintext: string): Promise<Buffer> {
    if (this.failEncrypt) throw new Error('encrypt boom');
    return Buffer.from(`enc:${plaintext}`, 'utf8');
  }
  async decryptAsync(ciphertext: Buffer): Promise<string> {
    if (this.failDecrypt) throw new Error('decrypt boom');
    return ciphertext.toString('utf8').replace(/^enc:/u, '');
  }
}

let db: Database.Database | undefined;

const freshRepository = (store: FakeCredentialStore): CredentialRepository => {
  db = openAppDatabase(':memory:');
  return new CredentialRepository(db, store);
};

afterEach(() => {
  db?.close();
  db = undefined;
});

const expectCode = (error: unknown, code: CredentialErrorCode): void => {
  if (error instanceof CredentialError) {
    expect(error.code).toBe(code);
  } else {
    throw error;
  }
};

describe('CredentialRepository', () => {
  it('round-trips a secret and never returns plaintext from put', async () => {
    const store = new FakeCredentialStore();
    const repo = freshRepository(store);
    const created = await repo.put(ref(), 'sk-live-123');
    expect(created.version).toBe(1);
    expect(Object.keys(created).sort()).toEqual(['id', 'version']);
    const resolved = await repo.resolveForOwner(ref());
    expect(resolved).toEqual({ version: 1, plaintext: 'sk-live-123' });
  });

  it('reports unconfigured status as version 0 with no availability', async () => {
    const repo = freshRepository(new FakeCredentialStore());
    expect(await repo.status(ref('missing-slot'))).toEqual({
      configured: false,
      available: false,
      version: 0,
    });
  });

  it('rotates the secret, bumps the version and fires the superseded callback with the prior version', async () => {
    const store = new FakeCredentialStore();
    const repo = freshRepository(store);
    await repo.put(ref(), 'first');
    const seen: { supersededVersion: number }[] = [];
    const unsubscribe = repo.onSuperseded((_ownerRef, supersededVersion) => {
      seen.push({ supersededVersion });
    });
    const rotated = await repo.rotateAndCancel(ref(), 'second');
    expect(rotated.version).toBe(2);
    expect(await repo.resolveForOwner(ref())).toEqual({ version: 2, plaintext: 'second' });
    expect(seen).toEqual([{ supersededVersion: 1 }]);
    unsubscribe();
    await repo.rotateAndCancel(ref(), 'third');
    expect(seen).toHaveLength(1); // 取消订阅后不再触发
  });

  it('clear keeps identity/version but makes the secret resolve as missing', async () => {
    const store = new FakeCredentialStore();
    const repo = freshRepository(store);
    await repo.put(ref(), 'secret');
    let superseded: number | undefined;
    repo.onSuperseded((_r, version) => {
      superseded = version;
    });
    const cleared = await repo.clear(ref());
    expect(cleared.version).toBe(2);
    expect(superseded).toBe(1);
    expect(await repo.status(ref())).toEqual({ configured: false, available: false, version: 2 });
    await expect(repo.resolveForOwner(ref())).rejects.toThrow(CredentialError);
    try {
      await repo.resolveForOwner(ref());
    } catch (error) {
      expectCode(error, 'credential_missing');
    }
  });

  it('rejects empty and oversized plaintext without writing any row', async () => {
    const store = new FakeCredentialStore();
    const repo = freshRepository(store);
    await expect(repo.put(ref(), '')).rejects.toThrow('不能为空');
    await expect(repo.put(ref(), 'x'.repeat(MAX_CREDENTIAL_LENGTH + 1))).rejects.toThrow(
      '长度上限',
    );
    expect(await repo.status(ref())).toEqual({ configured: false, available: false, version: 0 });
  });

  it('throws credential_unavailable and writes nothing when protected storage is locked', async () => {
    const store = new FakeCredentialStore();
    store.available = false;
    const repo = freshRepository(store);
    try {
      await repo.put(ref(), 'secret');
      throw new Error('expected put to reject');
    } catch (error) {
      expectCode(error, 'credential_unavailable');
    }
    expect(await repo.status(ref())).toEqual({ configured: false, available: false, version: 0 });
  });

  it('does not write a half product when encryption fails mid-rotation', async () => {
    const store = new FakeCredentialStore();
    const repo = freshRepository(store);
    await repo.put(ref(), 'A');
    store.failEncrypt = true;
    try {
      await repo.rotateAndCancel(ref(), 'B');
      throw new Error('expected rotate to reject');
    } catch (error) {
      expectCode(error, 'credential_unavailable');
    }
    store.failEncrypt = false;
    expect(await repo.resolveForOwner(ref())).toEqual({ version: 1, plaintext: 'A' });
  });

  it('maps decryption failure to credential_unavailable instead of falling back to plaintext', async () => {
    const store = new FakeCredentialStore();
    const repo = freshRepository(store);
    await repo.put(ref(), 'A');
    store.failDecrypt = true;
    try {
      await repo.resolveForOwner(ref());
      throw new Error('expected resolve to reject');
    } catch (error) {
      expectCode(error, 'credential_unavailable');
    }
  });

  it('rejects a duplicate put on an existing owner/slot', async () => {
    const store = new FakeCredentialStore();
    const repo = freshRepository(store);
    await repo.put(ref(), 'A');
    await expect(repo.put(ref(), 'B')).rejects.toThrow('rotateAndCancel');
  });

  it('enforces a unique (owner_kind, owner_id, slot) index at the storage layer', () => {
    const localDb = openAppDatabase(':memory:');
    const insert = localDb.prepare(
      `INSERT INTO credentials (id, owner_kind, owner_id, slot, ciphertext, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run('c-1', 'model-profile', 'm-1', 'api-key', null, 1, 1, 1);
    expect(() => insert.run('c-2', 'model-profile', 'm-1', 'api-key', null, 1, 1, 1)).toThrow(
      /UNIQUE/iu,
    );
    localDb.close();
  });

  it('rejects an owner_kind outside the allowed vocabulary', () => {
    const localDb = openAppDatabase(':memory:');
    expect(() =>
      localDb
        .prepare(
          `INSERT INTO credentials (id, owner_kind, owner_id, slot, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('c-x', 'not-a-real-owner', 'o', 'api-key', 1, 1, 1),
    ).toThrow(/CHECK/iu);
    localDb.close();
  });
});
