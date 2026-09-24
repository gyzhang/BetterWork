import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  type ArtifactInputRelationInput,
  type KnowledgeEvidenceSource,
  type KnowledgeMaterialReference,
  type TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { ArtifactDeclarationService, SourceDeclarationError } from './artifact-declaration-service';

const HASH = 'a'.repeat(64);
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const task of cleanup.splice(0)) task();
});

interface Fixture {
  store: AppStore;
  databasePath: string;
  declarations: ArtifactDeclarationService;
  runId: string;
  secondRunId: string;
  taskId: string;
  reference: KnowledgeMaterialReference;
  knowledgeEvidenceId: string;
  webEvidenceId: string;
}

const setup = (): Fixture => {
  const directory = mkdtempSync(path.join(tmpdir(), 'betterwork-declare-'));
  const databasePath = path.join(directory, 'app.db');
  const store = AppStore.open(databasePath);
  cleanup.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const workspace = store.workspaces.getOrCreate('/tmp/km05', '声明测试');
  const created = store.tasks.create(workspace.id, '采用声明', 'KM05');
  const taskId = created.task.id;
  const buildRun = (prompt: string): string => {
    const runId = randomUUID();
    store.runs.create({
      id: runId,
      taskId,
      sessionId: created.sessionId,
      prompt,
      status: 'completed',
      createdAt: Date.now(),
    });
    return runId;
  };
  const runId = buildRun('第一轮');
  const secondRunId = buildRun('第二轮');

  const reference: KnowledgeMaterialReference = {
    kind: 'knowledge-revision',
    knowledgeDocumentId: 'doc-1',
    knowledgeRevisionId: 'revision-1',
    contentHash: HASH,
    sourcePath: '/vault/合同模板.md',
  };
  const material: TaskMaterialSelection = {
    reference,
    purpose: 'current-input',
    addedFrom: 'user-input',
  };
  for (const id of [runId, secondRunId]) {
    store.runContextSnapshots.create({
      runId: id,
      taskId,
      workspaceId: workspace.id,
      contextSegmentId: randomUUID(),
      materials: [material],
      createdAt: Date.now(),
    });
  }
  const knowledgeSource: KnowledgeEvidenceSource = {
    reference,
    textHash: HASH,
    span: { sectionOrdinal: 0, start: 0, end: 60 },
    operation: 'search',
  };
  const excerpt = '违约金上限为合同金额的百分之二十。';
  const knowledgeEvidence = store.evidence.saveKnowledge({
    taskId,
    runId,
    sourceUri: reference.sourcePath,
    title: '合同模板',
    locator: '第 1 段',
    excerpt,
    contentHash: HASH,
    knowledgeSource,
  });
  const excerptHash = createHash('sha256').update(excerpt).digest('hex');
  // 只有第一个 Run 真正读过正文；第二个 Run 只搜过摘要。
  store.materialReads.save({
    id: randomUUID(),
    runId,
    material: reference,
    operation: 'read',
    locator: '第 1 段',
    contentHash: HASH,
    excerptHash,
    toolCallId: 'call-read-1',
    knowledgePartIndex: 0,
    knowledgeSpan: { sectionOrdinal: 0, start: 0, end: 120 },
    textHash: HASH,
    evidenceId: knowledgeEvidence.id,
    capturedAt: Date.now(),
  });
  store.materialReads.save({
    id: randomUUID(),
    runId: secondRunId,
    material: reference,
    operation: 'search',
    locator: '第 1 段',
    contentHash: HASH,
    excerptHash,
    toolCallId: 'call-search-1',
    knowledgePartIndex: 0,
    knowledgeSpan: { sectionOrdinal: 0, start: 0, end: 60 },
    textHash: HASH,
    evidenceId: knowledgeEvidence.id,
    capturedAt: Date.now(),
  });

  store.evidence.saveWeb({
    taskId,
    runId,
    sourceUri: 'https://example.com/a',
    title: '网页',
    locator: 'https://example.com/a',
    excerpt: '网页片段',
    contentHash: HASH,
  });
  const webEvidenceId = store.evidence
    .listByTask(taskId)
    .find((item) => item.sourceType === 'web-page')?.id;
  if (!webEvidenceId) throw new Error('web evidence missing');

  return {
    store,
    databasePath,
    declarations: new ArtifactDeclarationService(store),
    runId,
    secondRunId,
    taskId,
    reference,
    knowledgeEvidenceId: knowledgeEvidence.id,
    webEvidenceId,
  };
};

const onlyArtifactId = (fixture: Fixture): string => {
  const id = fixture.store.artifacts.list(fixture.taskId)[0]?.id;
  if (!id) throw new Error('artifact missing');
  return id;
};

const materialRelation = (reference: KnowledgeMaterialReference): ArtifactInputRelationInput => ({
  input: reference,
  relation: 'data',
});

describe('ArtifactDeclarationService.validate', () => {
  it('accepts a read material and an exact knowledge evidence, and dedupes identical entries', () => {
    const fixture = setup();
    const inputs = [
      materialRelation(fixture.reference),
      materialRelation(fixture.reference),
      {
        input: { kind: 'evidence' as const, evidenceId: fixture.knowledgeEvidenceId },
        relation: 'background' as const,
      },
    ];
    expect(fixture.declarations.validate(inputs, fixture.runId)).toHaveLength(2);
  });

  it('rejects a whole-document declaration backed only by a search footprint', () => {
    const fixture = setup();
    expect(() =>
      fixture.declarations.validate([materialRelation(fixture.reference)], fixture.secondRunId),
    ).toThrowError(SourceDeclarationError);
  });

  it('rejects evidence from another run and non-knowledge evidence', () => {
    const fixture = setup();
    expect(() =>
      fixture.declarations.validate(
        [
          {
            input: { kind: 'evidence', evidenceId: fixture.knowledgeEvidenceId },
            relation: 'data',
          },
        ],
        fixture.secondRunId,
      ),
    ).toThrow('不属于本次运行');
    expect(() =>
      fixture.declarations.validate(
        [{ input: { kind: 'evidence', evidenceId: fixture.webEvidenceId }, relation: 'data' }],
        fixture.runId,
      ),
    ).toThrow('精确知识来源');
  });

  it('rejects the same input declared with two relations', () => {
    const fixture = setup();
    expect(() =>
      fixture.declarations.validate(
        [materialRelation(fixture.reference), { input: fixture.reference, relation: 'background' }],
        fixture.runId,
      ),
    ).toThrow('两种关系');
  });
});

describe('ArtifactDeclarationService ledger', () => {
  it('keeps the last successful declaration per run and an empty list clears it', () => {
    const fixture = setup();
    fixture.declarations.declare(fixture.runId, [materialRelation(fixture.reference)]);
    const cleared = fixture.declarations.declare(fixture.runId, []);
    expect(cleared.inputs).toEqual([]);
    expect(fixture.store.runArtifactDeclarations.get(fixture.runId)?.inputs).toEqual([]);
    const rewritten = fixture.declarations.declare(fixture.runId, [
      { input: { kind: 'evidence', evidenceId: fixture.knowledgeEvidenceId }, relation: 'data' },
    ]);
    expect(rewritten.inputs).toHaveLength(1);
    expect(rewritten.updatedAt).toBeGreaterThanOrEqual(rewritten.createdAt);
  });
});

describe('ArtifactDeclarationService inheritance matrix', () => {
  const saveVersion = (
    fixture: Fixture,
    input: {
      artifactId?: string;
      origin: 'assistant-run' | 'user-edit';
      runId?: string;
      inputs: ArtifactInputRelationInput[] | null | undefined;
    },
  ): { versionId: string; kind: string; relations: number } => {
    const previousVersionId = input.artifactId
      ? fixture.store.artifacts.getDetail(input.artifactId)?.currentVersionId
      : undefined;
    const plan = fixture.declarations.planForWrite(
      input.origin,
      input.runId,
      previousVersionId,
      input.inputs,
    );
    return fixture.store.transaction(() => {
      const saved = fixture.store.artifacts.saveMarkdown(
        {
          taskId: fixture.taskId,
          origin: input.origin,
          ...(input.runId ? { runId: input.runId } : {}),
          ...(input.artifactId ? { artifactId: input.artifactId } : {}),
          title: '成果',
          content: `正文 ${Date.now()} ${Math.random()}`,
        },
        plan.kind,
      );
      if (plan.copyRelationsFromVersionId) {
        fixture.store.artifactInputRelations.inheritFromVersion(
          saved.currentVersionId,
          plan.copyRelationsFromVersionId,
          plan.kind,
        );
      } else if (plan.inputs && plan.inputs.length > 0) {
        fixture.store.artifactInputRelations.saveForRun(
          saved.currentVersionId,
          plan.runId,
          plan.inputs,
          fixture.declarations.wasReadDuring,
          plan.kind === 'user' ? 'user' : 'model',
        );
      }
      return {
        versionId: saved.currentVersionId,
        kind: fixture.store.artifacts.getVersionDeclarationKind(saved.currentVersionId),
        relations: fixture.store.artifactInputRelations.listByVersion(saved.currentVersionId)
          .length,
      };
    });
  };

  it('model declaration becomes the version relation; empty declaration produces none', () => {
    const fixture = setup();
    const declared = saveVersion(fixture, {
      origin: 'assistant-run',
      runId: fixture.runId,
      inputs: [materialRelation(fixture.reference)],
    });
    expect(declared.kind).toBe('model');
    expect(declared.relations).toBe(1);
    const empty = saveVersion(fixture, {
      origin: 'assistant-run',
      runId: fixture.runId,
      inputs: [],
    });
    expect(empty.kind).toBe('none');
    expect(empty.relations).toBe(0);
  });

  it('legacy 版本连续人工编辑仍是 legacy，不会被洗成声明', () => {
    const fixture = setup();
    const first = saveVersion(fixture, {
      origin: 'assistant-run',
      runId: fixture.runId,
      inputs: [materialRelation(fixture.reference)],
    });
    // 模拟 v32 迁移前的历史数据：已有关系但声明种类是 legacy。
    const external = new Database(fixture.databasePath);
    external
      .prepare("UPDATE artifact_versions SET source_declaration = 'legacy' WHERE id = ?")
      .run(first.versionId);
    external.close();
    const edited = saveVersion(fixture, {
      artifactId: onlyArtifactId(fixture),
      origin: 'user-edit',
      inputs: null,
    });
    expect(edited.kind).toBe('legacy');
    expect(edited.relations).toBe(1);
    const again = saveVersion(fixture, {
      artifactId: onlyArtifactId(fixture),
      origin: 'user-edit',
      inputs: null,
    });
    expect(again.kind).toBe('legacy');
  });

  it('none stays none and only a declared ancestor inherits as declared', () => {
    const fixture = setup();
    const none = saveVersion(fixture, {
      origin: 'assistant-run',
      runId: fixture.runId,
      inputs: null,
    });
    expect(none.kind).toBe('none');
    const artifactId = onlyArtifactId(fixture);
    const inherited = saveVersion(fixture, {
      artifactId,
      origin: 'user-edit',
      inputs: null,
    });
    expect(inherited.kind).toBe('none');
    expect(inherited.relations).toBe(0);

    const declared = saveVersion(fixture, {
      artifactId,
      origin: 'user-edit',
      inputs: [
        { input: { kind: 'evidence', evidenceId: fixture.knowledgeEvidenceId }, relation: 'data' },
      ],
    });
    expect(declared.kind).toBe('user');
    const afterUser = saveVersion(fixture, {
      artifactId,
      origin: 'user-edit',
      inputs: null,
    });
    expect(afterUser.kind).toBe('inherited');
    expect(afterUser.relations).toBe(1);
    // 旧版本的声明不被回写
    expect(fixture.store.artifacts.getVersionDeclarationKind(declared.versionId)).toBe('user');
  });

  it('rejects user selection when the source run never read the material', () => {
    const fixture = setup();
    saveVersion(fixture, {
      origin: 'assistant-run',
      runId: fixture.secondRunId,
      inputs: [],
    });
    const artifactId = onlyArtifactId(fixture);
    expect(() =>
      saveVersion(fixture, {
        artifactId,
        origin: 'user-edit',
        inputs: [materialRelation(fixture.reference)],
      }),
    ).toThrowError(SourceDeclarationError);
  });
});
