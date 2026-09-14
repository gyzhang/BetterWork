import { randomUUID } from 'node:crypto';

import {
  type BuiltinToolPolicy,
  builtinToolPolicySchema,
  type ExpertModelReference,
  expertModelReferenceSchema,
  MAX_RUN_SKILL_BINDINGS,
  type McpToolBinding,
  mcpToolBindingSchema,
  type TaskContextExecutor,
  taskContextExecutorSchema,
  type TaskContextRevision,
  type TaskContextSkillBinding,
  taskContextSkillBindingSchema,
  type TaskMaterialSelection,
  taskMaterialSelectionSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface TaskContextRow {
  id: string;
  task_id: string;
  revision: number;
  executor_json: string;
  skill_bindings_json: string;
  model_reference_json: string | null;
  builtin_tool_policy_json: string | null;
  created_at: number;
  updated_at: number;
  materials_json: string;
  excluded_memory_ids_json: string;
  mcp_tool_bindings_json: string;
}

export interface SaveTaskContextInput {
  executor: TaskContextExecutor;
  skillBindings: TaskContextSkillBinding[];
  modelReference?: ExpertModelReference;
  builtinToolPolicy?: BuiltinToolPolicy;
  materials?: TaskMaterialSelection[];
  excludedMemoryIds?: string[];
  mcpToolBindings?: McpToolBinding[];
}

const parseSkillBindings = (value: string): TaskContextSkillBinding[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('Stored TaskContext skill bindings must be an array');
  return parsed.map((item) => taskContextSkillBindingSchema.parse(item));
};

const parseMaterials = (value: string): TaskMaterialSelection[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('Stored TaskContext materials must be an array');
  return parsed.map((item) => taskMaterialSelectionSchema.parse(item));
};

const parseMemoryIds = (value: string): string[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('Stored TaskContext memory exclusions must be an array');
  }
  const ids: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') throw new Error('Stored TaskContext memory exclusion is invalid');
    ids.push(item);
  }
  return ids;
};

const parseMcpToolBindings = (value: string): McpToolBinding[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('Stored TaskContext MCP bindings must be an array');
  return parsed.map((item) => mcpToolBindingSchema.parse(item));
};

const toRevision = (row: TaskContextRow): TaskContextRevision => {
  const excludedMemoryIds = parseMemoryIds(row.excluded_memory_ids_json);
  const mcpToolBindings = parseMcpToolBindings(row.mcp_tool_bindings_json);
  return {
    id: row.id,
    taskId: row.task_id,
    revision: row.revision,
    executor: taskContextExecutorSchema.parse(JSON.parse(row.executor_json)),
    skillBindings: parseSkillBindings(row.skill_bindings_json),
    ...(row.model_reference_json
      ? { modelReference: expertModelReferenceSchema.parse(JSON.parse(row.model_reference_json)) }
      : {}),
    ...(row.builtin_tool_policy_json
      ? {
          builtinToolPolicy: builtinToolPolicySchema.parse(
            JSON.parse(row.builtin_tool_policy_json),
          ),
        }
      : {}),
    materials: parseMaterials(row.materials_json),
    ...(excludedMemoryIds.length > 0 ? { excludedMemoryIds } : {}),
    ...(mcpToolBindings.length > 0 ? { mcpToolBindings } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export class TaskContextRepository {
  constructor(private readonly db: Database.Database) {}

  private getRow(id: string, taskId?: string): TaskContextRow | undefined {
    const query = taskId
      ? 'SELECT * FROM task_context_revisions WHERE id = ? AND task_id = ?'
      : 'SELECT * FROM task_context_revisions WHERE id = ?';
    return (taskId ? this.db.prepare(query).get(id, taskId) : this.db.prepare(query).get(id)) as
      TaskContextRow | undefined;
  }

  get(id: string, taskId?: string): TaskContextRevision | undefined {
    const row = this.getRow(id, taskId);
    return row ? toRevision(row) : undefined;
  }

  getLatest(taskId: string): TaskContextRevision | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM task_context_revisions
         WHERE task_id = ? ORDER BY revision DESC, rowid DESC LIMIT 1`,
      )
      .get(taskId) as TaskContextRow | undefined;
    return row ? toRevision(row) : undefined;
  }

  save(
    taskId: string,
    input: SaveTaskContextInput,
    expectedRevision?: number,
  ): TaskContextRevision {
    const executor = taskContextExecutorSchema.parse(input.executor);
    const skillBindings = taskContextSkillBindingSchema
      .array()
      .max(MAX_RUN_SKILL_BINDINGS)
      .refine(
        (bindings) => new Set(bindings.map((binding) => binding.skillId)).size === bindings.length,
        { message: 'Task context skill bindings must not repeat a skill' },
      )
      .parse(input.skillBindings);
    const modelReference = input.modelReference
      ? expertModelReferenceSchema.parse(input.modelReference)
      : undefined;
    const builtinToolPolicy = input.builtinToolPolicy
      ? builtinToolPolicySchema.parse(input.builtinToolPolicy)
      : undefined;
    const materials = taskMaterialSelectionSchema
      .array()
      .max(50)
      .parse(input.materials ?? []);
    const excludedMemoryIds = [...new Set(input.excludedMemoryIds ?? [])];
    if (excludedMemoryIds.length > 100 || excludedMemoryIds.some((id) => !id)) {
      throw new Error('Task context memory exclusions are invalid');
    }
    const mcpToolBindings = mcpToolBindingSchema
      .array()
      .max(50)
      .parse(input.mcpToolBindings ?? []);
    if (
      new Set(mcpToolBindings.map((binding) => `${binding.connectionId}\u0000${binding.toolId}`))
        .size !== mcpToolBindings.length
    ) {
      throw new Error('Task context MCP bindings must not repeat a tool');
    }
    const latest = this.getLatest(taskId);
    if (expectedRevision !== undefined && latest && latest.revision !== expectedRevision) {
      throw new Error(
        `Task context revision conflict: expected ${expectedRevision}, current ${latest.revision}`,
      );
    }
    const revision = (latest?.revision ?? 0) + 1;
    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO task_context_revisions (
           id, task_id, revision, executor_json, skill_bindings_json,
           model_reference_json, builtin_tool_policy_json, created_at, updated_at, materials_json,
           excluded_memory_ids_json, mcp_tool_bindings_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        taskId,
        revision,
        JSON.stringify(executor),
        JSON.stringify(skillBindings),
        modelReference ? JSON.stringify(modelReference) : null,
        builtinToolPolicy ? JSON.stringify(builtinToolPolicy) : null,
        now,
        now,
        JSON.stringify(materials),
        JSON.stringify(excludedMemoryIds),
        JSON.stringify(mcpToolBindings),
      );
    const saved = this.get(id, taskId);
    if (!saved) throw new Error('Task context was not available after save');
    return saved;
  }
}
