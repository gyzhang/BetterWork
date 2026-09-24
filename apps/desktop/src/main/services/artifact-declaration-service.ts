import {
  type ArtifactInputRelationInput,
  artifactInputRelationInputSchema,
  type ArtifactSourceDeclarationKind,
  knowledgeMaterialReferenceSchema,
  type MaterialReference,
  type RunArtifactSourceDeclaration,
  sameKnowledgeReference,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import type { WritableDeclarationKind } from '../persistence/artifact-repository';

/** 声明校验统一失败码：越界、未读整份材料或重复冲突（契约 §13.1）。 */
export class SourceDeclarationError extends Error {
  readonly code = 'SOURCE_DECLARATION_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'SourceDeclarationError';
  }
}

export interface DeclarationWritePlan {
  kind: WritableDeclarationKind | 'legacy';
  /** 显式声明时用于校验与写关系的 Run（user-edit 为最近一次 Assistant Run）。 */
  runId: string;
  /** null = 本次不写新关系；inherited/legacy 由仓储从前版复制。 */
  inputs: ArtifactInputRelationInput[] | null;
  previousVersionId?: string;
  /** 需要把前版关系作为本版记录复制时给出前版 id（inherited 与 legacy）。 */
  copyRelationsFromVersionId?: string;
}

const DECLARED_KINDS = new Set<ArtifactSourceDeclarationKind>(['model', 'user', 'inherited']);

type DeclaredInput = MaterialReference | { kind: 'evidence'; evidenceId: string };

/**
 * 成果采用声明（知识契约 §6.1/§6.2）。材料登记、搜索/读取足迹、声明采用是三种
 * 分开的事实：只有声明进入 `artifact_input_relations`，运行访问记录不再自动映射。
 *
 * 校验口径：
 * - material 声明必须完整匹配该 Run 固定材料，且有实际读取足迹（parse/read/正文）；
 *   只有搜索摘要时拒绝，避免「搜过 = 读过」。
 * - evidence 声明必须属于承载声明的那个 Run，且是精确知识来源（摘要/正文皆可作依据）。
 * - 完全重复的条目幂等合并；同一输入配两种关系无法表达，直接拒绝。
 */
export class ArtifactDeclarationService {
  constructor(private readonly store: AppStore) {}

  validate(
    inputs: readonly ArtifactInputRelationInput[],
    runId: string,
  ): ArtifactInputRelationInput[] {
    const out: ArtifactInputRelationInput[] = [];
    const relations = new Map<string, string>();
    for (const raw of inputs) {
      const input = artifactInputRelationInputSchema.parse(raw);
      const key = JSON.stringify(input.input);
      const previous = relations.get(key);
      if (previous !== undefined) {
        if (previous !== input.relation) {
          throw new SourceDeclarationError('同一输入不能声明两种关系。');
        }
        continue;
      }
      relations.set(key, input.relation);
      this.validateInput(input.input, runId);
      out.push(input);
    }
    return out;
  }

  declare(
    runId: string,
    inputs: readonly ArtifactInputRelationInput[],
  ): RunArtifactSourceDeclaration {
    return this.store.transaction(() =>
      this.store.runArtifactDeclarations.upsert(runId, this.validate(inputs, runId)),
    );
  }

  /**
   * 版本落库前的声明计划；种类由宿主判定，模型与 Renderer 都不能自报（§6.1）：
   * - assistant-run：显式输入为 model，省略或空为 none；
   * - user-edit：显式输入为 user（按前版来源 Run 校验归属，用户选择不越出已核验范围）；
   *   省略时按矩阵继承——legacy/none 原样，model/user/inherited 一律 inherited。
   */
  planForWrite(
    origin: 'assistant-run' | 'user-edit',
    runId: string | undefined,
    previousVersionId: string | undefined,
    inputs: ArtifactInputRelationInput[] | null | undefined,
  ): DeclarationWritePlan {
    const explicit = inputs ?? undefined;
    if (origin === 'assistant-run') {
      if (!runId) throw new SourceDeclarationError('Assistant Run 成果缺少来源运行。');
      const validated = explicit ? this.validate(explicit, runId) : [];
      return {
        kind: validated.length > 0 ? 'model' : 'none',
        runId,
        inputs: validated,
        ...(previousVersionId ? { previousVersionId } : {}),
      };
    }
    if (!previousVersionId) {
      if (explicit && explicit.length > 0) {
        throw new SourceDeclarationError('新建成果没有可核验的来源运行，无法声明采用依据。');
      }
      return { kind: 'none', runId: '', inputs: explicit ?? [] };
    }
    const previousKind = this.store.artifacts.getVersionDeclarationKind(previousVersionId);
    if (explicit) {
      const sourceRunId = this.resolveDeclarationRun(previousVersionId);
      if (!sourceRunId) {
        throw new SourceDeclarationError('该成果没有来源运行，用户选择必须沿已核验的声明链。');
      }
      return {
        kind: 'user',
        runId: sourceRunId,
        inputs: this.validate(explicit, sourceRunId),
        previousVersionId,
      };
    }
    const kind: WritableDeclarationKind | 'legacy' =
      previousKind === 'legacy'
        ? 'legacy'
        : DECLARED_KINDS.has(previousKind)
          ? 'inherited'
          : 'none';
    // 继承与历史关联都保留前版关系；none 没有可复制的内容。
    return kind === 'none'
      ? { kind, runId: '', inputs: null, previousVersionId }
      : {
          kind,
          runId: '',
          inputs: null,
          previousVersionId,
          copyRelationsFromVersionId: previousVersionId,
        };
  }

  /** 关系是否确由该 Run 实际读取：搜索摘要不算（§6.2）。 */
  wasReadDuring = (input: DeclaredInput, runId: string): boolean => {
    if (input.kind === 'evidence') {
      const evidence = this.store.evidence.get(input.evidenceId);
      return evidence?.runId === runId && Boolean(evidence.knowledgeSource);
    }
    return this.readReference(runId, input);
  };

  /** 用户编辑链上最近的 Assistant Run：归属校验只认它实际读过的东西。 */
  private resolveDeclarationRun(versionId: string): string | undefined {
    let cursor: string | undefined = versionId;
    while (cursor) {
      const runId = this.store.artifacts.getVersionSourceRunId(cursor);
      if (runId) return runId;
      cursor = this.store.artifacts.getPreviousVersionId(cursor);
    }
    return undefined;
  }

  private validateInput(input: DeclaredInput, runId: string): void {
    if (input.kind === 'evidence') {
      const evidence = this.store.evidence.get(input.evidenceId);
      if (!evidence || evidence.runId !== runId) {
        throw new SourceDeclarationError('证据不存在或不属于本次运行。');
      }
      if (!evidence.knowledgeSource) {
        throw new SourceDeclarationError('只有精确知识来源（摘要/正文）可以作为采用依据。');
      }
      return;
    }
    if (!this.readReference(runId, input)) {
      throw new SourceDeclarationError(
        '声明的整份材料必须有本 Run 的实际读取足迹；仅搜索摘要不足以声明全文。',
      );
    }
  }

  private readReference(runId: string, reference: MaterialReference): boolean {
    const snapshot = this.store.runContextSnapshots.get(runId);
    const inScope =
      snapshot?.materials.some(
        (selection) =>
          selection.reference.kind === reference.kind &&
          sameReferenceLoose(selection.reference, reference),
      ) ?? false;
    if (!inScope) return false;
    if (reference.kind === 'knowledge-revision') {
      return this.store.materialReads.hasKnowledgeBodyRead(runId, reference);
    }
    return this.store.materialReads.hasMaterialRead(
      runId,
      `${reference.kind}:${referenceId(reference)}`,
      reference.contentHash,
    );
  }
}

const sameReferenceLoose = (left: MaterialReference, right: MaterialReference): boolean => {
  if (left.kind === 'knowledge-revision' && right.kind === 'knowledge-revision') {
    return sameKnowledgeReference(left, right);
  }
  return JSON.stringify(left) === JSON.stringify(right);
};

const referenceId = (reference: MaterialReference): string => {
  const knowledge = knowledgeMaterialReferenceSchema.safeParse(reference);
  if (knowledge.success) return knowledge.data.knowledgeRevisionId;
  const artifact = reference as { artifactVersionId?: string; snapshotId?: string };
  return artifact.artifactVersionId ?? artifact.snapshotId ?? '';
};
