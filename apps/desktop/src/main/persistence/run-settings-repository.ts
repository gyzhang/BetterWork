import type { RunSettings } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface RunSettingsRow {
  max_skill_tool_rounds: number;
  updated_at: number;
}

/** 全局 Run 参数；单行存储，按 Run 开始时读取为本次执行快照。 */
export class RunSettingsRepository {
  constructor(private readonly db: Database.Database) {}

  get(): RunSettings {
    const row = this.db
      .prepare('SELECT max_skill_tool_rounds, updated_at FROM run_settings WHERE id = 1')
      .get() as RunSettingsRow | undefined;
    if (!row) throw new Error('Run 设置缺失；请重启应用以完成数据库迁移。');
    return { maxSkillToolRounds: row.max_skill_tool_rounds, updatedAt: row.updated_at };
  }

  save(maxSkillToolRounds: number): RunSettings {
    this.db
      .prepare('UPDATE run_settings SET max_skill_tool_rounds = ?, updated_at = ? WHERE id = 1')
      .run(maxSkillToolRounds, Date.now());
    return this.get();
  }
}
