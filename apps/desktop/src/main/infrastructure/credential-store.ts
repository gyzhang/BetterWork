import { safeStorage } from 'electron';

/**
 * Electron `safeStorage` 里本模块实际用到的最小面。抽出来是为了让
 * `ElectronSafeStorageAdapter` 的解包/记忆化逻辑能在单测里用替身覆盖，
 * 不在测试环境触碰真机 Keychain（工程规范 §5、AGENTS：测试不触网/不触密钥链）。
 */
export interface SafeStorageLike {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ shouldReEncrypt: boolean; result: string }>;
}

/**
 * Main 唯一的凭据加解密入口契约（ADR-0024 §3）。加密/解密都发生在长 SQLite 事务之外；
 * 生产实现走 Electron 异步接口，测试注入 fake，绝不回退明文。
 */
export interface SafeStorageAdapter {
  /** 受保护存储是否可用。实现只检查一次并缓存（ADR-0024：启动时检查一次）。 */
  isAvailableAsync(): Promise<boolean>;
  /** 把明文加密成字节。失败时抛错，由调用方转成 credential_unavailable，不落半成品。 */
  encryptAsync(plaintext: string): Promise<Buffer>;
  /** 把密文解回明文。不可用或解密失败时抛错，调用方转成 credential_unavailable。 */
  decryptAsync(ciphertext: Buffer): Promise<string>;
}

/**
 * 生产实现：包一层 Electron `safeStorage` 的异步接口。
 * `isAvailableAsync` 结果只计算一次并缓存；`decryptAsync` 处理 Electron 的
 * `shouldReEncrypt`（密钥轮换时首次返回值仍属旧密钥），再解一次拿到稳定明文。
 */
export class ElectronSafeStorageAdapter implements SafeStorageAdapter {
  private availability: Promise<boolean> | undefined;

  constructor(private readonly storage: SafeStorageLike = safeStorage) {}

  isAvailableAsync(): Promise<boolean> {
    this.availability ??= this.storage.isAsyncEncryptionAvailable();
    return this.availability;
  }

  async encryptAsync(plaintext: string): Promise<Buffer> {
    return this.storage.encryptStringAsync(plaintext);
  }

  async decryptAsync(ciphertext: Buffer): Promise<string> {
    const first = await this.storage.decryptStringAsync(ciphertext);
    if (!first.shouldReEncrypt) return first.result;
    // 密钥已轮换：再解一次，返回新密钥下的明文；第二次仍要求重加密时以其结果为准（有界，避免死循环）。
    const second = await this.storage.decryptStringAsync(ciphertext);
    return second.result;
  }
}
