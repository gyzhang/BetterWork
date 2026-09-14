import {
  type BuiltinToolPolicy,
  builtinToolPolicySchema,
  type ExpertModelReference,
  expertModelReferenceSchema,
  materialReferenceSchema,
  type McpToolBinding,
  mcpToolBindingSchema,
  type TaskMaterialSelection,
  taskMaterialSelectionSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

export interface RunContextSnapshot {
  runId: string;
  taskId: string;
  workspaceId: string;
  taskContextRevisionId?: string;
  expertId?: string;
  expertRevisionId?: string;
  modelReference?: ExpertModelReference;
  builtinToolPolicy?: BuiltinToolPolicy;
  mcpToolBindings?: McpToolBinding[];
  contextSegmentId: string;
  materials: TaskMaterialSelection[];
  createdAt: number;
}

interface RunContextSnapshotRow {
  run_id: string;
  task_id: string;
  workspace_id: string;
  task_context_revision_id: string | null;
  expert_id: string | null;
  expert_revision_id: string | null;
  model_reference_json: string | null;
  builtin_tool_policy_json: string | null;
  mcp_tool_bindings_json: string | null;
  context_segment_id: string;
  materials_json: string;
  created_at: number;
}

const parseMaterials = (value: string): TaskMaterialSelection[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('Stored run materials must be an array');
  return parsed.map((item) => taskMaterialSelectionSchema.parse(item));
};

const parseOptionalJson = (value: string | null): unknown =>
  value === null ? undefined : JSON.parse(value);

const toSnapshot = (row: RunContextSnapshotRow): RunContextSnapshot => ({
  runId: row.run_id,
  taskId: row.task_id,
  workspaceId: row.workspace_id,
  ...(row.task_context_revision_id ? { taskContextRevisionId: row.task_context_revision_id } : {}),
  ...(row.expert_id ? { expertId: row.expert_id } : {}),
  ...(row.expert_revision_id ? { expertRevisionId: row.expert_revision_id } : {}),
  ...(row.model_reference_json
    ? { modelReference: expertModelReferenceSchema.parse(JSON.parse(row.model_reference_json)) }
    : {}),
  ...(row.builtin_tool_policy_json
    ? {
        builtinToolPolicy: builtinToolPolicySchema.parse(JSON.parse(row.builtin_tool_policy_json)),
      }
    : {}),
  ...(row.mcp_tool_bindings_json
    ? {
        mcpToolBindings: mcpToolBindingSchema
          .array()
          .max(50)
          .parse(parseOptionalJson(row.mcp_tool_bindings_json)),
      }
    : {}),
  contextSegmentId: row.context_segment_id,
  materials: parseMaterials(row.materials_json),
  createdAt: row.created_at,
});

export class RunContextSnapshotRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: RunContextSnapshot): void {
    if ((input.expertId === undefined) !== (input.expertRevisionId === undefined)) {
      throw new Error('Run expert snapshot must include both expertId and expertRevisionId');
    }
    if (input.expertId && input.expertRevisionId) {
      const revision = this.db
        .prepare('SELECT expert_id FROM expert_revisions WHERE id = ?')
        .get(input.expertRevisionId) as { expert_id: string } | undefined;
      if (!revision) throw new Error('Run expert revision does not exist');
      if (revision.expert_id !== input.expertId) {
        throw new Error('Run expert revision does not belong to expert');
      }
    }
    const modelReference =
      input.modelReference === undefined
        ? undefined
        : expertModelReferenceSchema.parse(input.modelReference);
    const builtinToolPolicy =
      input.builtinToolPolicy === undefined
        ? undefined
        : builtinToolPolicySchema.parse(input.builtinToolPolicy);
    const mcpToolBindings =
      input.mcpToolBindings === undefined
        ? undefined
        : mcpToolBindingSchema.array().max(50).parse(input.mcpToolBindings);
    const materials = taskMaterialSelectionSchema.array().max(50).parse(input.materials);
    this.db
      .prepare(
        `INSERT INTO run_context_snapshots (
           run_id, task_id, workspace_id, task_context_revision_id,
           expert_id, expert_revision_id, model_reference_json,
           builtin_tool_policy_json, mcp_tool_bindings_json,
           context_segment_id, materials_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.runId,
        input.taskId,
        input.workspaceId,
        input.taskContextRevisionId ?? null,
        input.expertId ?? null,
        input.expertRevisionId ?? null,
        modelReference ? JSON.stringify(modelReference) : null,
        builtinToolPolicy ? JSON.stringify(builtinToolPolicy) : null,
        mcpToolBindings ? JSON.stringify(mcpToolBindings) : null,
        input.contextSegmentId,
        JSON.stringify(materials),
        input.createdAt,
      );
  }

  get(runId: string): RunContextSnapshot | undefined {
    const row = this.db
      .prepare('SELECT * FROM run_context_snapshots WHERE run_id = ?')
      .get(runId) as RunContextSnapshotRow | undefined;
    return row ? toSnapshot(row) : undefined;
  }

  listByTask(taskId: string): RunContextSnapshot[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM run_context_snapshots WHERE task_id = ? ORDER BY created_at ASC, rowid ASC',
      )
      .all(taskId) as RunContextSnapshotRow[];
    return rows.map(toSnapshot);
  }

  /** 供上下文收缩比较使用；没有快照的历史 Run 不会被误当作当前材料段。 */
  latestByTask(taskId: string): RunContextSnapshot | undefined {
    const row = this.db
      .prepare(
        'SELECT * FROM run_context_snapshots WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      )
      .get(taskId) as RunContextSnapshotRow | undefined;
    return row ? toSnapshot(row) : undefined;
  }
}

/** 只比较稳定材料身份；用途和备注变化不会伪造上下文范围变化。 */
export const materialReferenceKey = (selection: TaskMaterialSelection): string => {
  const reference = materialReferenceSchema.parse(selection.reference);
  if (reference.kind === 'knowledge-revision')
    return `${reference.kind}:${reference.knowledgeRevisionId}`;
  if (reference.kind === 'artifact-version')
    return `${reference.kind}:${reference.artifactVersionId}`;
  return `${reference.kind}:${reference.snapshotId}`;
};
