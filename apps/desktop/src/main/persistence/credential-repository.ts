import { randomUUID } from 'node:crypto';

import { describeError } from '@betterwork/agent-core';
import {
  type CredentialErrorCode,
  type CredentialOwnerKind,
  type CredentialStatus,
  MAX_CREDENTIAL_LENGTH,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

import type { SafeStorageAdapter } from '../infrastructure/credential-store';

/** 一条凭据的归属：owner 类别 + owner 身份 + 命名槽位。三者唯一定位一行。 */
export interface CredentialOwnerRef {
  readonly ownerKind: CredentialOwnerKind;
  readonly ownerId: string;
  readonly slot: string;
}

/**
 * 凭据子系统错误：只携带 §6 定义的三个码之一，绝不回退明文。
 * 与 `ExpertServiceError` 同构——code 是共享协议枚举，消息面向修复动作。
 */
export class CredentialError extends Error {
  constructor(
    readonly code: CredentialErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CredentialError';
  }
}

/** 轮换/清空后被取代的旧版本订阅者；CF11 起在此注册取消使用该版本的活跃 Run。 */
export type CredentialSupersededListener = (
  ref: CredentialOwnerRef,
  supersededVersion: number,
) => void;

interface CredentialRow {
  id: string;
  owner_kind: CredentialOwnerKind;
  owner_id: string;
  slot: string;
  ciphertext: Buffer | null;
  version: number;
  created_at: number;
  updated_at: number;
}

const assertPlaintext = (plaintext: string): void => {
  if (plaintext.length === 0) throw new Error('凭据明文不能为空');
  if (plaintext.length > MAX_CREDENTIAL_LENGTH) throw new Error('凭据明文超出长度上限');
};

/**
 * Main 唯一的凭据存取与保护入口（CF10）。只提供 put / rotateAndCancel / clear / status /
 * resolveForOwner；永不返回明文给 IPC，也不接受 Renderer 直连。加密在事务外完成，
 * 失败即抛错且不写半成品；解密失败按 credential_unavailable 处理，绝不回退明文。
 */
export class CredentialRepository {
  private readonly listeners = new Set<CredentialSupersededListener>();

  constructor(
    private readonly db: Database.Database,
    private readonly store: SafeStorageAdapter,
  ) {}

  /** 订阅版本被取代事件（轮换或清空）；返回取消订阅函数。 */
  onSuperseded(listener: CredentialSupersededListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private find(ref: CredentialOwnerRef): CredentialRow | undefined {
    return this.db
      .prepare('SELECT * FROM credentials WHERE owner_kind = ? AND owner_id = ? AND slot = ?')
      .get(ref.ownerKind, ref.ownerId, ref.slot) as CredentialRow | undefined;
  }

  /** 为尚不存在的 owner/slot 建立初始凭据，version 从 1 起。受保护存储不可用时抛错且不写入。 */
  async put(ref: CredentialOwnerRef, plaintext: string): Promise<{ id: string; version: number }> {
    assertPlaintext(plaintext);
    if (this.find(ref)) {
      throw new Error('该 owner/slot 已存在凭据，请改用 rotateAndCancel');
    }
    const ciphertext = await this.encrypt(plaintext);
    const id = randomUUID();
    const now = Date.now();
    const write = this.db.transaction(() => {
      if (this.find(ref)) {
        throw new CredentialError('credential_unavailable', '并发写入：凭据已存在');
      }
      this.db
        .prepare(
          `INSERT INTO credentials
             (id, owner_kind, owner_id, slot, ciphertext, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(id, ref.ownerKind, ref.ownerId, ref.slot, ciphertext, now, now);
    });
    write();
    return { id, version: 1 };
  }

  /** 替换已存在的凭据：版本自增，提交后以旧版本触发订阅者取消；无既有行时抛 credential_missing。 */
  async rotateAndCancel(
    ref: CredentialOwnerRef,
    plaintext: string,
  ): Promise<{ id: string; version: number }> {
    assertPlaintext(plaintext);
    const existing = this.find(ref);
    if (!existing) throw new CredentialError('credential_missing', '没有可轮换的凭据');
    const ciphertext = await this.encrypt(plaintext);
    const nextVersion = existing.version + 1;
    const now = Date.now();
    const write = this.db.transaction(() => {
      this.db
        .prepare('UPDATE credentials SET ciphertext = ?, version = ?, updated_at = ? WHERE id = ?')
        .run(ciphertext, nextVersion, now, existing.id);
    });
    write();
    this.notify(ref, existing.version);
    return { id: existing.id, version: nextVersion };
  }

  /** 清空密文但保留身份/版本元数据：版本自增并以旧版本触发取消；无既有行时抛 credential_missing。 */
  async clear(ref: CredentialOwnerRef): Promise<{ id: string; version: number }> {
    const existing = this.find(ref);
    if (!existing) throw new CredentialError('credential_missing', '没有可清空的凭据');
    const nextVersion = existing.version + 1;
    const now = Date.now();
    const write = this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE credentials SET ciphertext = NULL, version = ?, updated_at = ? WHERE id = ?',
        )
        .run(nextVersion, now, existing.id);
    });
    write();
    this.notify(ref, existing.version);
    return { id: existing.id, version: nextVersion };
  }

  /** 公开状态：只回版本与 configured/availability，不含明文或密文。 */
  async status(ref: CredentialOwnerRef): Promise<CredentialStatus> {
    const row = this.find(ref);
    if (!row) return { configured: false, available: false, version: 0 };
    const configured = row.ciphertext !== null;
    const available = configured && (await this.store.isAvailableAsync());
    return { configured, available, version: row.version };
  }

  /**
   * Main 内部解析明文供消费方使用（不进 IPC 响应）。
   * 缺失或已清空 → credential_missing；受保护存储不可用或解密失败 → credential_unavailable。
   */
  async resolveForOwner(ref: CredentialOwnerRef): Promise<{ version: number; plaintext: string }> {
    const row = this.find(ref);
    if (!row || row.ciphertext === null) {
      throw new CredentialError('credential_missing', '凭据缺失或已被清空');
    }
    if (!(await this.store.isAvailableAsync())) {
      throw new CredentialError('credential_unavailable', '受保护存储当前不可用');
    }
    try {
      const plaintext = await this.store.decryptAsync(row.ciphertext);
      return { version: row.version, plaintext };
    } catch (error) {
      throw new CredentialError('credential_unavailable', '凭据解密失败', { cause: error });
    }
  }

  private async encrypt(plaintext: string): Promise<Buffer> {
    if (!(await this.store.isAvailableAsync())) {
      throw new CredentialError('credential_unavailable', '受保护存储不可用，无法写入凭据');
    }
    try {
      return await this.store.encryptAsync(plaintext);
    } catch (error) {
      throw new CredentialError('credential_unavailable', `凭据加密失败：${describeError(error)}`, {
        cause: error,
      });
    }
  }

  private notify(ref: CredentialOwnerRef, supersededVersion: number): void {
    for (const listener of this.listeners) {
      listener(ref, supersededVersion);
    }
  }
}
