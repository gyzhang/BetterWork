import { describe, expect, it } from 'vitest';

import { ElectronSafeStorageAdapter, type SafeStorageLike } from './credential-store';

/** 可控的 safeStorage 替身；记录解密调用次数以验证有界重解密。 */
class FakeSafeStorage implements SafeStorageLike {
  availabilityCalls = 0;
  decryptCalls = 0;
  constructor(
    private readonly options: {
      available: boolean;
      reEncryptOnce?: boolean;
      failEncrypt?: boolean;
    },
  ) {}

  async isAsyncEncryptionAvailable(): Promise<boolean> {
    this.availabilityCalls += 1;
    return this.options.available;
  }

  async encryptStringAsync(plainText: string): Promise<Buffer> {
    if (this.options.failEncrypt) throw new Error('boom');
    return Buffer.from(`enc:${plainText}`, 'utf8');
  }

  async decryptStringAsync(
    encrypted: Buffer,
  ): Promise<{ shouldReEncrypt: boolean; result: string }> {
    this.decryptCalls += 1;
    const result = encrypted.toString('utf8').replace(/^enc:/u, '');
    const shouldReEncrypt = this.options.reEncryptOnce === true && this.decryptCalls === 1;
    return { shouldReEncrypt, result };
  }
}

describe('ElectronSafeStorageAdapter', () => {
  it('checks async availability once and caches the result', async () => {
    const storage = new FakeSafeStorage({ available: true });
    const adapter = new ElectronSafeStorageAdapter(storage);
    await expect(adapter.isAvailableAsync()).resolves.toBe(true);
    await expect(adapter.isAvailableAsync()).resolves.toBe(true);
    expect(storage.availabilityCalls).toBe(1);
  });

  it('encrypts to bytes and decrypts back without re-encryption', async () => {
    const storage = new FakeSafeStorage({ available: true });
    const adapter = new ElectronSafeStorageAdapter(storage);
    const ciphertext = await adapter.encryptAsync('sk-secret');
    expect(ciphertext.toString('utf8')).toBe('enc:sk-secret');
    await expect(adapter.decryptAsync(ciphertext)).resolves.toBe('sk-secret');
    expect(storage.decryptCalls).toBe(1);
  });

  it('decrypts a second time when the key was rotated and returns the stable plaintext', async () => {
    const storage = new FakeSafeStorage({ available: true, reEncryptOnce: true });
    const adapter = new ElectronSafeStorageAdapter(storage);
    const ciphertext = await adapter.encryptAsync('rotated');
    await expect(adapter.decryptAsync(ciphertext)).resolves.toBe('rotated');
    expect(storage.decryptCalls).toBe(2);
  });

  it('reports unavailability and surfaces encryption failure', async () => {
    const locked = new FakeSafeStorage({ available: false });
    await expect(new ElectronSafeStorageAdapter(locked).isAvailableAsync()).resolves.toBe(false);
    const failing = new FakeSafeStorage({ available: true, failEncrypt: true });
    await expect(new ElectronSafeStorageAdapter(failing).encryptAsync('x')).rejects.toThrow();
  });
});
