import { mkdirSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

/**
 * 一次不可逆的 schema 变更。version 必须从 1 开始连续递增且全局唯一，
 * `migrate()` 在启动时校验，避免迁移列表被写错后静默跳版本。
 */
export interface Migration {
  readonly version: number;
  readonly name: string;
  up(db: Database.Database): void;
}

export interface MigrationPlan {
  readonly migrations: readonly Migration[];
  /**
   * 迁移制度之前建立的历史库没有 `schema_migrations` 表。
   * 该探针用于识别它们，通常检查最早的那张业务表是否存在。
   */
  readonly detectLegacy?: (db: Database.Database) => boolean;
  /**
   * 把历史库对账到 `legacyBaseline` 版本的形状。
   * 只在探针命中时执行一次，之后正常走增量迁移，
   * 因此历史库不会漏掉 baseline 之后的任何迁移。
   */
  readonly reconcileLegacy?: (db: Database.Database) => void;
  readonly legacyBaseline?: number;
}

const MIGRATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )
`;

interface VersionRow {
  version: number;
}

interface TableInfoRow {
  name: string;
}

function assertValidPlan(plan: MigrationPlan): readonly Migration[] {
  const sorted = [...plan.migrations].sort((a, b) => a.version - b.version);
  const seen = new Set<number>();
  for (const [index, migration] of sorted.entries()) {
    if (seen.has(migration.version)) {
      throw new Error(`Duplicate migration version ${migration.version}`);
    }
    seen.add(migration.version);
    const expected = index + 1;
    if (migration.version !== expected) {
      throw new Error(
        `Migration versions must be contiguous from 1, found ${migration.version} where ${expected} was expected`,
      );
    }
  }
  const baseline = plan.legacyBaseline ?? 0;
  if (baseline > sorted.length) {
    throw new Error(`Legacy baseline ${baseline} exceeds the migration count ${sorted.length}`);
  }
  return sorted;
}

export function readSchemaVersion(db: Database.Database): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
    .get() as VersionRow;
  return row.version;
}

/** 列名探针：SQLite 无法用 ALTER 判断列是否存在，只能读 PRAGMA。 */
export function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[];
  return rows.some((row) => row.name === column);
}

export function hasTable(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name?: string } | undefined;
  return row !== undefined;
}

function stamp(db: Database.Database, migration: Migration): void {
  db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
    migration.version,
    migration.name,
    Date.now(),
  );
}

/**
 * 按 SQLite 官方推荐流程重建一张表（用于补外键这类无法 ALTER 的变更）：
 * 外键开关在事务外关闭，建新表、拷数据、删旧表、改名，
 * 悬空引用的清理由调用方在重建前完成。
 *
 * 旧表上的索引会随 DROP 一起消失，调用方必须在 `recreateIndexes` 里补回。
 */
export function rebuildTable(
  db: Database.Database,
  table: string,
  createSql: string,
  columns: readonly string[],
  recreateIndexes: readonly string[] = [],
): void {
  const temporaryName = `${table}_migration_new`;
  const columnList = columns.join(', ');
  const declaration = new RegExp(`CREATE TABLE\\s+${table}\\s*\\(`, 'iu');
  if (!declaration.test(createSql)) {
    throw new Error(`rebuildTable expects createSql to declare the table "${table}"`);
  }
  const temporaryDdl = createSql.replace(declaration, `CREATE TABLE ${temporaryName} (`);
  // 已在外层迁移事务中时，pragma 由 migrate() 统一管理：
  // PRAGMA foreign_keys 在事务内是 no-op，重复设置只会静默失效。
  const ownsForeignKeySwitch = !db.inTransaction;
  if (ownsForeignKeySwitch) db.pragma('foreign_keys = OFF');
  try {
    const run = db.transaction(() => {
      db.exec(temporaryDdl);
      db.exec(`INSERT INTO ${temporaryName} (${columnList}) SELECT ${columnList} FROM ${table}`);
      db.exec(`DROP TABLE ${table}`);
      db.exec(`ALTER TABLE ${temporaryName} RENAME TO ${table}`);
      for (const indexSql of recreateIndexes) db.exec(indexSql);
    });
    run();
  } finally {
    if (ownsForeignKeySwitch) db.pragma('foreign_keys = ON');
  }
}

/**
 * 在事务外关闭外键后执行一段迁移逻辑，结束后恢复。
 * 外键必须在事务外开关，而迁移本身又要原子，所以由这一层统一编排。
 */
function runWithoutForeignKeys(db: Database.Database, body: () => void): void {
  db.pragma('foreign_keys = OFF');
  try {
    const run = db.transaction(body);
    run();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/**
 * 把库推进到迁移列表的最新版本。幂等：重复调用不会重复执行已应用的迁移。
 * 每条迁移单独一个原子事务，失败时整条回滚且不打版本戳，
 * 已应用的版本保持有效，下次启动会从失败的那条重新开始。
 */
export function migrate(db: Database.Database, plan: MigrationPlan): void {
  const sorted = assertValidPlan(plan);
  db.exec(MIGRATION_TABLE_SQL);

  let version = readSchemaVersion(db);
  const baseline = plan.legacyBaseline ?? 0;

  if (version === 0 && baseline > 0 && plan.detectLegacy?.(db) === true) {
    runWithoutForeignKeys(db, () => {
      plan.reconcileLegacy?.(db);
      for (const migration of sorted) {
        if (migration.version > baseline) break;
        stamp(db, migration);
      }
    });
    version = baseline;
  }

  for (const migration of sorted) {
    if (migration.version <= version) continue;
    runWithoutForeignKeys(db, () => {
      migration.up(db);
      stamp(db, migration);
    });
  }
}

export interface OpenDatabaseOptions extends MigrationPlan {
  /** 迁移完成后是否开启外键约束，默认开启 */
  readonly foreignKeys?: boolean;
}

/**
 * 打开（必要时创建）一个 SQLite 库并推进到最新 schema。
 * 统一在此处设置 PRAGMA，避免各调用点各写一套。
 */
export function openDatabase(filePath: string, options: OpenDatabaseOptions): Database.Database {
  if (filePath !== ':memory:') mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db, options);
    if (options.foreignKeys === false) db.pragma('foreign_keys = OFF');
    return db;
  } catch (error) {
    // 迁移失败时不能把句柄和文件锁留在进程里
    db.close();
    throw error;
  }
}
