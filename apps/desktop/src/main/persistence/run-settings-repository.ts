import type { RunSettings, SaveRunSettingsRequest } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface RunSettingsRow {
  max_skill_tool_rounds: number;
  enable_builtin_skills: number;
  enable_builtin_experts: number;
  updated_at: number;
}

/** 全局执行与内置资源设置；单行存储，Run 轮数在启动时读取为本次执行快照。 */
export class RunSettingsRepository {
  constructor(private readonly db: Database.Database) {}

  get(): RunSettings {
    const row = this.db
      .prepare(
        `SELECT max_skill_tool_rounds, enable_builtin_skills, enable_builtin_experts, updated_at
         FROM run_settings WHERE id = 1`,
      )
      .get() as RunSettingsRow | undefined;
    if (!row) throw new Error('Run 设置缺失；请重启应用以完成数据库迁移。');
    return {
      maxSkillToolRounds: row.max_skill_tool_rounds,
      enableBuiltinSkills: row.enable_builtin_skills === 1,
      enableBuiltinExperts: row.enable_builtin_experts === 1,
      updatedAt: row.updated_at,
    };
  }

  save(settings: SaveRunSettingsRequest): RunSettings {
    this.db
      .prepare(
        `UPDATE run_settings
         SET max_skill_tool_rounds = ?, enable_builtin_skills = ?, enable_builtin_experts = ?, updated_at = ?
         WHERE id = 1`,
      )
      .run(
        settings.maxSkillToolRounds,
        settings.enableBuiltinSkills ? 1 : 0,
        settings.enableBuiltinExperts ? 1 : 0,
        Date.now(),
      );
    return this.get();
  }
}
