import type {
  CredentialMigrationJournalRepository,
  CredentialMigrationStatus,
} from '../db/credential-migration-journal';
import type {
  CredentialOwnerRef,
  CredentialRepository,
} from '../persistence/credential-repository';

/** 迁移状态；`none` 表示该 owner/slot 没有迁移记录（未加密的旧数据或无凭据）。 */
export type CredentialGateStatus = CredentialMigrationStatus | 'none';

/** 解析面：run-service 只需要迁移状态与明文解析。 */
export interface CredentialResolver {
  migrationStatus(ref: CredentialOwnerRef): CredentialGateStatus;
  resolveSecret(ref: CredentialOwnerRef): Promise<string>;
}

/** 双写面：保存新 Key 时写入 credentials 并登记 done。 */
export interface CredentialProvisioner {
  provision(ref: CredentialOwnerRef, plaintext: string): Promise<void>;
}

/**
 * Main 侧凭据访问点，供 run-service 与保存路径使用：
 * - 解析前先查迁移状态；pending/failed 让派发被拒（不回落明文）；
 * - done 的 owner 从 credentials 解析明文（永不回传密文）；
 * - 保存新 Key 时双写：写密文进 credentials 并登记 done，明文列留作回滚窗口。
 * 受保护存储不可用时 resolveSecret 抛 credential_unavailable，调用方不得吞掉回退明文。
 */
export class CredentialAccess implements CredentialResolver, CredentialProvisioner {
  constructor(
    private readonly credentials: CredentialRepository,
    private readonly journal: CredentialMigrationJournalRepository,
  ) {}

  migrationStatus(ref: CredentialOwnerRef): CredentialGateStatus {
    return this.journal.statusOf(ref.ownerKind, ref.ownerId, ref.slot);
  }

  /** 已完成迁移的 owner 解析明文；缺失/不可用抛 CredentialError，调用方不得吞掉回退明文。 */
  resolveSecret(ref: CredentialOwnerRef): Promise<string> {
    return this.credentials.resolveForOwner(ref).then((resolved) => resolved.plaintext);
  }

  /** 供 save 双写：空明文不动；否则写入/轮换 credentials 并登记 done。 */
  async provision(ref: CredentialOwnerRef, plaintext: string): Promise<void> {
    if (plaintext === '') return;
    await this.credentials.ensureSecret(ref, plaintext);
    this.journal.markDone(ref.ownerKind, ref.ownerId, ref.slot);
  }
}
