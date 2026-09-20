import { afterEach, describe, expect, it } from 'vitest';

import type { SafeStorageAdapter } from '../infrastructure/credential-store';
import { AppStore } from '../persistence';
import type { CredentialOwnerRef } from '../persistence/credential-repository';
import { API_KEY_SLOT, CredentialAccess } from './credential-access';

class FakeStore implements SafeStorageAdapter {
  available = true;
  async isAvailableAsync(): Promise<boolean> {
    return this.available;
  }
  async encryptAsync(plaintext: string): Promise<Buffer> {
    return Buffer.from(`enc:${plaintext}`, 'utf8');
  }
  async decryptAsync(ciphertext: Buffer): Promise<string> {
    return ciphertext.toString('utf8').replace(/^enc:/u, '');
  }
}

let store: AppStore | undefined;

const access = (): { a: CredentialAccess; ref: CredentialOwnerRef } => {
  const opened = AppStore.open(':memory:', new FakeStore());
  store = opened;
  if (!opened.credentials) throw new Error('test setup: credentials repository unavailable');
  const ref: CredentialOwnerRef = {
    ownerKind: 'model-profile',
    ownerId: 'model-1',
    slot: API_KEY_SLOT,
  };
  return { a: new CredentialAccess(opened.credentials, opened.credentialJournal), ref };
};

afterEach(() => {
  store?.close();
  store = undefined;
});

describe('CredentialAccess', () => {
  it('reports none until provisioned, then done after dual-write', async () => {
    const { a, ref } = access();
    expect(a.migrationStatus(ref)).toBe('none');
    await a.provision(ref, 'sk-new');
    expect(a.migrationStatus(ref)).toBe('done');
    await expect(a.resolveSecret(ref)).resolves.toBe('sk-new');
  });

  it('is a no-op for an empty plaintext (keeps existing credential untouched)', async () => {
    const { a, ref } = access();
    await a.provision(ref, 'sk-existing');
    const before = a.migrationStatus(ref);
    await a.provision(ref, '');
    expect(a.migrationStatus(ref)).toBe(before);
    await expect(a.resolveSecret(ref)).resolves.toBe('sk-existing');
  });

  it('rotates to a new value on repeated provisioning without duplicating', async () => {
    const { a, ref } = access();
    await a.provision(ref, 'v1');
    await a.provision(ref, 'v2');
    await expect(a.resolveSecret(ref)).resolves.toBe('v2');
  });
});
