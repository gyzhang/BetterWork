import { type CredentialErrorCode, searchProviderIdSchema } from '@betterwork/agent-protocol';

import {
  type CredentialJournalEntry,
  type CredentialMigrationStatus,
} from '../db/credential-migration-journal';
import type { AppStore } from '../persistence';
import {
  CredentialError,
  type CredentialOwnerRef,
  type CredentialRepository,
} from '../persistence/credential-repository';

export interface CredentialMigrationRunResult {
  done: number;
  failed: number;
  remaining: number;
  /** 受保护存储不可用而整体跳过时为 true，pending 项原样保留。 */
  skipped: boolean;
}

const errorCodeOf = (error: unknown): CredentialErrorCode =>
  error instanceof CredentialError ? error.code : 'credential_unavailable';

/**
 * Legacy 明文密钥（model_profiles.api_key / search_engine_configs.api_key）到 credentials 的
 * journaled 迁移。严格遵循 capability-contracts §10.2：读明文 → 事务外加密 → 回环校验 →
 * 单个事务内清空明文并标 done。任何失败都保留 recoverable（不回落明文、不半清），
 * 受保护存储不可用时整体跳过、pending 原样保留。崩溃重放靠 journal 状态保证幂等。
 *
 * 依赖注入 AppStore 与 CredentialRepository：明文读写走各自仓储（不越表），跨聚合的
 * 清空+标 done 用 `store.transaction`；不向持久层暴露 Electron 细节。
 */
export class CredentialMigrationService {
  constructor(
    private readonly store: AppStore,
    private readonly credentials: CredentialRepository,
  ) {}

  async runPending(): Promise<CredentialMigrationRunResult> {
    if (!(await this.credentials.isStorageAvailable())) {
      return {
        done: 0,
        failed: 0,
        remaining: this.store.credentialJournal.listPending().length,
        skipped: true,
      };
    }
    let done = 0;
    let failed = 0;
    for (const entry of this.store.credentialJournal.listPending()) {
      const status = await this.migrateOwner(entry);
      if (status === 'done') done += 1;
      else if (status === 'failed') failed += 1;
    }
    return {
      done,
      failed,
      remaining: this.store.credentialJournal.listPending().length,
      skipped: false,
    };
  }

  /** 推进单个 owner/slot；返回其最终状态。source 行已消失或明文为空按 done 收敛。 */
  async migrateOwner(entry: CredentialJournalEntry): Promise<CredentialMigrationStatus> {
    const ref: CredentialOwnerRef = {
      ownerKind: entry.ownerKind,
      ownerId: entry.ownerId,
      slot: entry.slot,
    };
    const plaintext = this.readPlaintext(entry);
    if (!plaintext) {
      this.store.credentialJournal.markDone(ref.ownerKind, ref.ownerId, ref.slot);
      return 'done';
    }
    try {
      await this.credentials.ensureSecret(ref, plaintext);
      // 回环校验放在事务外：解密结果必须与明文一致，否则不触碰明文列。
      const roundTrip = (await this.credentials.resolveForOwner(ref)).plaintext;
      if (roundTrip !== plaintext) {
        this.store.credentialJournal.markFailed(
          ref.ownerKind,
          ref.ownerId,
          ref.slot,
          'credential_unavailable',
        );
        return 'failed';
      }
    } catch (error) {
      this.store.credentialJournal.markFailed(
        ref.ownerKind,
        ref.ownerId,
        ref.slot,
        errorCodeOf(error),
      );
      return 'failed';
    }
    this.store.transaction(() => {
      this.clearPlaintext(entry);
      this.store.credentialJournal.markDone(ref.ownerKind, ref.ownerId, ref.slot);
    });
    return 'done';
  }

  private readPlaintext(entry: CredentialJournalEntry): string | null {
    if (entry.ownerKind === 'model-profile') {
      return this.store.models.readPlaintextApiKey(entry.ownerId) ?? null;
    }
    if (entry.ownerKind === 'api-service-profile') {
      return this.store.searchEngines.readPlaintextApiKey(this.provider(entry)) ?? null;
    }
    return null;
  }

  private clearPlaintext(entry: CredentialJournalEntry): void {
    if (entry.ownerKind === 'model-profile') {
      this.store.models.clearPlaintextApiKey(entry.ownerId);
    } else if (entry.ownerKind === 'api-service-profile') {
      this.store.searchEngines.clearPlaintextApiKey(this.provider(entry));
    } else {
      throw new Error(`不支持迁移的凭据归属：${entry.ownerKind}`);
    }
  }

  private provider(entry: CredentialJournalEntry): 'baidu_qianfan' {
    return searchProviderIdSchema.parse(entry.ownerId);
  }
}
