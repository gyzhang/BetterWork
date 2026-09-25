import { describe, expect, it } from 'vitest';

import {
  artifactInputRelationSchema,
  countCodePoints,
  createMemoryRequestSchema,
  deleteSkillRequestSchema,
  dependencyLockSchema,
  dependencyOperationSchema,
  expertReferenceMaterialSchema,
  exportMarkdownArtifactRequestSchema,
  facetToKind,
  importSkillRequestSchema,
  jobResultSchema,
  jobSpecSchema,
  listPageSchema,
  MAX_RUN_SKILL_BINDINGS,
  mcpToolBindingSchema,
  mcpToolSummarySchema,
  MEMORY_RECALL_TOTAL_ITEM_LIMIT,
  MEMORY_RECALL_VERSION,
  memoryEditPatchSchema,
  memoryErrorCodeSchema,
  memoryGovernanceActionSchema,
  memoryOperationRecordSchema,
  memoryProvenanceSchema,
  memoryRecordSchema,
  memorySourceRefSchema,
  memorySourceSelectorSchema,
  memoryWriteReceiptSchema,
  resolveMemoryConflictRequestSchema,
  resultSchema,
  runMaterialReadSchema,
  runtimeEnvironmentSchema,
  runtimeProfileDraftSchema,
  scriptExecutionSchema,
  setSkillTrustRequestSchema,
  skillBindingSchema,
  skillRevisionSummarySchema,
  skillSummarySchema,
  startRunRequestSchema,
  taskContextRevisionSchema,
  taskMemoryExclusionItemSchema,
  taskMemoryExclusionsDataSchema,
  taskMemoryExclusionsRequestSchema,
  updateWindowThemeRequestSchema,
  workspaceBriefSchema,
} from './index';

describe('run protocol', () => {
  it('models scoped memory records and rejects invalid validity windows', () => {
    const hash = 'a'.repeat(64);
    const record = memoryRecordSchema.parse({
      id: 'memory-1',
      revisionId: 'memory-1-r1',
      revision: 1,
      recallPolicy: 'relevant',
      scope: { kind: 'expert-workspace', expertId: 'expert-1', workspaceId: 'workspace-1' },
      kind: 'procedural',
      facet: 'method',
      content: '月报先核对财务规则。',
      sourceType: 'user-explicit',
      confidence: 1,
      status: 'confirmed',
      validFrom: 10,
      validUntil: 20,
      contentHash: hash,
      normalizedHash: hash,
      provenance: {
        schemaVersion: 1,
        verification: 'legacy-unverified',
        sourceType: 'user-explicit',
      },
      createdAt: 10,
      updatedAt: 10,
    });
    expect(record.scope.kind).toBe('expert-workspace');
    expect(() => memoryRecordSchema.parse({ ...record, validFrom: 20, validUntil: 20 })).toThrow();
    // 客户端不能提交与 facet 矛盾的 kind，映射由宿主决定。
    expect(() => memoryRecordSchema.parse({ ...record, kind: 'semantic' })).toThrow();
  });

  it('accepts the new user-instruction create shape', () => {
    const created = createMemoryRequestSchema.parse({
      operationId: '11111111-1111-4111-8111-111111111111',
      content: '收入按回款金额统计，不使用签约金额。',
      facet: 'constraint',
      scope: { kind: 'workspace', workspaceId: 'ws-1' },
      asUserInstruction: true,
    });
    expect(created.facet).toBe('constraint');
    expect(created.topicKey).toBeUndefined();
    // §5.3：重新表述只多带一条审计线索，不接受凭空字符串。
    expect(
      createMemoryRequestSchema.parse({ ...created, fromMemoryRevisionId: 'rev-1' })
        .fromMemoryRevisionId,
    ).toBe('rev-1');
    expect(
      createMemoryRequestSchema.safeParse({ ...created, fromMemoryRevisionId: '' }).success,
    ).toBe(false);
    expect(
      memoryOperationRecordSchema.safeParse({
        operationId: '11111111-1111-4111-8111-111111111111',
        operationKind: 'create',
        requestHash: 'a'.repeat(64),
        effect: 'created',
        committedRevisionIds: ['rev-2'],
        fromMemoryRevisionId: 'rev-1',
        committedAt: 1,
      }).success,
    ).toBe(true);
    expect(() =>
      createMemoryRequestSchema.parse({
        operationId: 'not-a-uuid',
        content: 'x',
        facet: 'constraint',
        scope: { kind: 'user' },
        asUserInstruction: true,
      }),
    ).toThrow();
  });

  it('projects task exclusions without a prompt and hides out-of-scope detail', () => {
    // 请求不要求 prompt：换问法或清空草稿后仍能读到排除清单（契约 §11.2）。
    expect(
      taskMemoryExclusionsRequestSchema.safeParse({
        taskId: 't-1',
        taskContextRevisionId: 'ctx-1',
        expectedTaskContextRevision: 3,
      }).success,
    ).toBe(true);
    expect(
      taskMemoryExclusionsRequestSchema.safeParse({
        taskId: 't-1',
        taskContextRevisionId: 'ctx-1',
        expectedTaskContextRevision: 0,
        prompt: '多余字段',
      }).success,
    ).toBe(false);
    const data = taskMemoryExclusionsDataSchema.parse({
      taskId: 't-1',
      taskContextRevisionId: 'ctx-1',
      taskContextRevision: 3,
      items: [
        {
          visibility: 'visible',
          memoryId: 'm-1',
          revisionId: 'm-1-r1',
          content: '金额按万元保留两位。',
          scope: { kind: 'workspace', workspaceId: 'ws-1' },
          effectiveStatus: 'confirmed',
        },
        { visibility: 'unavailable', memoryId: 'm-2' },
      ],
    });
    expect(data.items).toHaveLength(2);
    // 不可见分支不接受正文：越范围记录不能借投影泄露。
    expect(
      taskMemoryExclusionItemSchema.safeParse({
        visibility: 'unavailable',
        memoryId: 'm-2',
        content: '别的空间的口径。',
      }).success,
    ).toBe(false);
  });

  it('keeps a provenance selector and a user instruction mutually exclusive', () => {
    const selector = { kind: 'run-assistant', runId: 'r-1', eventId: 'e-7', start: 0, end: 4 };
    const base = {
      operationId: '22222222-2222-4222-8222-222222222222',
      content: '汇总收入前先核对回款口径与单位。',
      facet: 'method',
      scope: { kind: 'workspace', workspaceId: 'ws-1' },
    } as const;
    // 保留来源的普通保存：asUserInstruction=false ＋ selector。
    expect(
      createMemoryRequestSchema.safeParse({
        ...base,
        asUserInstruction: false,
        sourceSelector: selector,
      }).success,
    ).toBe(true);
    // 自主口径不得同时携带来源选择器，防止普通保存被降级成空依赖。
    expect(
      createMemoryRequestSchema.safeParse({
        ...base,
        asUserInstruction: true,
        genericDeclaration: true,
        sourceSelector: selector,
      }).success,
    ).toBe(false);
    // 显式自主重述只带审计线索，不带 selector。
    expect(
      createMemoryRequestSchema.safeParse({
        ...base,
        asUserInstruction: true,
        genericDeclaration: true,
        fromMemoryRevisionId: 'rev-1',
      }).success,
    ).toBe(true);
  });

  it('keeps material reads and artifact inputs tied to exact revisions', () => {
    const material = {
      kind: 'knowledge-revision' as const,
      knowledgeDocumentId: 'doc-1',
      knowledgeRevisionId: 'revision-1',
      contentHash: 'hash-1',
      sourcePath: '/rules.md',
    };
    expect(
      runMaterialReadSchema.parse({
        id: 'read-1',
        runId: 'run-1',
        material,
        operation: 'search',
        locator: '全文',
        contentHash: 'hash-1',
        capturedAt: 1,
      }),
    ).toMatchObject({ material, operation: 'search' });
    expect(
      artifactInputRelationSchema.parse({
        outputVersionId: 'version-1',
        input: material,
        relation: 'rule',
        createdAt: 2,
      }),
    ).toMatchObject({ input: material, relation: 'rule' });
    expect(
      artifactInputRelationSchema.parse({
        outputVersionId: 'version-1',
        input: material,
        relation: 'other',
        createdAt: 2,
      }),
    ).toMatchObject({ input: material, relation: 'other' });
    expect(() =>
      artifactInputRelationSchema.parse({
        outputVersionId: 'version-1',
        input: material,
        relation: 'citation',
        createdAt: 2,
      }),
    ).toThrow();
  });

  it('allows a task to exclude selected memory identities without changing memory scope', () => {
    const context = taskContextRevisionSchema.parse({
      id: 'context-1',
      taskId: 'task-1',
      revision: 1,
      executor: { kind: 'general' },
      skillBindings: [],
      excludedMemoryIds: ['memory-1'],
      createdAt: 1,
      updatedAt: 1,
    });
    expect(context.excludedMemoryIds).toEqual(['memory-1']);
  });

  it('keeps MCP tool bindings stable and separate from discovered descriptions', () => {
    const tool = mcpToolSummarySchema.parse({
      id: 'connection-1/finance.monthly_summary',
      connectionId: 'connection-1',
      name: 'finance.monthly_summary',
      description: '只读查询',
      inputSchema: { type: 'object' },
      schemaHash: 'hash-1',
      discoveredAt: 1,
    });
    expect(
      mcpToolBindingSchema.parse({ connectionId: tool.connectionId, toolId: tool.id }),
    ).toEqual({
      connectionId: 'connection-1',
      toolId: tool.id,
    });
  });

  it('limits expert reference materials to reusable knowledge and artifact versions', () => {
    expect(
      expertReferenceMaterialSchema.parse({
        reference: {
          kind: 'knowledge-revision',
          knowledgeDocumentId: 'rules',
          knowledgeRevisionId: 'rules-v1',
          contentHash: 'hash-rules',
          sourcePath: '/rules.md',
        },
        purpose: 'rule',
      }),
    ).toMatchObject({ purpose: 'rule' });
    expect(() =>
      expertReferenceMaterialSchema.parse({
        reference: {
          kind: 'workspace-input-snapshot',
          snapshotId: 'snapshot-1',
          workspaceId: 'workspace-1',
          contentHash: 'hash-input',
          format: 'csv',
          fileKey: 'input.csv',
        },
        purpose: 'current-input',
      }),
    ).toThrow();
  });

  it('accepts only identifiers and prompt, leaving the workspace boundary to Main', () => {
    expect(
      startRunRequestSchema.parse({
        taskId: 'task-1',
        sessionId: 'session-1',
        prompt: '研究客户风险',
      }),
    ).toEqual({ taskId: 'task-1', sessionId: 'session-1', prompt: '研究客户风险' });
    expect(() =>
      startRunRequestSchema.parse({
        taskId: 'task-1',
        sessionId: 'session-1',
        prompt: '研究客户风险',
        workspacePath: '/',
      }),
    ).toThrow();
  });

  it('accepts 1..6 skill bindings and keeps the selected order as the injection order', () => {
    expect(
      startRunRequestSchema.parse({
        taskId: 'task-1',
        sessionId: 'session-1',
        prompt: '生成 PPT',
        skillBindings: [{ skillId: 'skill-1' }],
      }),
    ).toEqual({
      taskId: 'task-1',
      sessionId: 'session-1',
      prompt: '生成 PPT',
      skillBindings: [{ skillId: 'skill-1' }],
    });
    expect(
      startRunRequestSchema.parse({
        taskId: 'task-1',
        sessionId: 'session-1',
        prompt: '生成 PPT',
        skillBindings: [{ skillId: 'skill-1', revisionId: 'rev-1' }, { skillId: 'skill-2' }],
      }).skillBindings,
    ).toEqual([{ skillId: 'skill-1', revisionId: 'rev-1' }, { skillId: 'skill-2' }]);
    expect(
      startRunRequestSchema.parse({
        taskId: 'task-1',
        sessionId: 'session-1',
        prompt: '生成 PPT',
        skillBindings: Array.from({ length: MAX_RUN_SKILL_BINDINGS }, (_, index) => ({
          skillId: `skill-${index + 1}`,
        })),
      }).skillBindings,
    ).toHaveLength(MAX_RUN_SKILL_BINDINGS);
    expect(() =>
      startRunRequestSchema.parse({
        taskId: 'task-1',
        sessionId: 'session-1',
        prompt: '生成 PPT',
        skillBindings: [],
      }),
    ).toThrow();
    expect(() =>
      startRunRequestSchema.parse({
        taskId: 'task-1',
        sessionId: 'session-1',
        prompt: '生成 PPT',
        skillBindings: Array.from({ length: MAX_RUN_SKILL_BINDINGS + 1 }, (_, index) => ({
          skillId: `skill-${index + 1}`,
        })),
      }),
    ).toThrow();
    // 重复 skillId 会让同一份指令注入两次，且绑定快照无法去重回溯。
    expect(() =>
      startRunRequestSchema.parse({
        taskId: 'task-1',
        sessionId: 'session-1',
        prompt: '生成 PPT',
        skillBindings: [{ skillId: 'skill-1' }, { skillId: 'skill-1', revisionId: 'rev-1' }],
      }),
    ).toThrow();
    expect(() =>
      startRunRequestSchema.parse({
        taskId: 'task-1',
        sessionId: 'session-1',
        prompt: '生成 PPT',
        skillBinding: { skillId: 'skill-1' },
      }),
    ).toThrow();
    expect(() =>
      startRunRequestSchema.parse({
        taskId: 'task-1',
        sessionId: 'session-1',
        prompt: '生成 PPT',
        skillBindings: [{ skillId: '' }],
      }),
    ).toThrow();
    expect(() =>
      startRunRequestSchema.parse({
        taskId: 'task-1',
        sessionId: 'session-1',
        prompt: '生成 PPT',
        skillBindings: [{ skillId: 'skill-1', extra: true }],
      }),
    ).toThrow();
    expect(() => skillBindingSchema.parse({ skillId: '' })).toThrow();
    expect(() => skillBindingSchema.parse({ skillId: 'skill-1', revisionId: '' })).toThrow();
  });
});

describe('task material protocol', () => {
  it('accepts an explicitly unspecified material purpose', () => {
    const context = taskContextRevisionSchema.parse({
      id: 'context-other',
      taskId: 'task-1',
      revision: 1,
      executor: { kind: 'general' },
      skillBindings: [],
      materials: [
        {
          reference: {
            kind: 'knowledge-revision',
            knowledgeDocumentId: 'doc-1',
            knowledgeRevisionId: 'revision-1',
            contentHash: 'hash-1',
            sourcePath: '/notes.md',
          },
          purpose: 'other',
          addedFrom: 'workspace-candidate',
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    });

    expect(context.materials?.[0]).toMatchObject({ purpose: 'other' });
  });

  it('keeps exact source revisions at the IPC boundary', () => {
    const context = taskContextRevisionSchema.parse({
      id: 'context-1',
      taskId: 'task-1',
      revision: 1,
      executor: { kind: 'general' },
      skillBindings: [],
      materials: [
        {
          reference: {
            kind: 'artifact-version',
            artifactId: 'artifact-1',
            artifactVersionId: 'version-1',
            contentHash: 'hash-1',
            originWorkspaceId: 'workspace-1',
          },
          purpose: 'historical-comparison',
          addedFrom: 'workspace-candidate',
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    });
    expect(context.materials?.[0]).toMatchObject({
      purpose: 'historical-comparison',
      reference: { artifactVersionId: 'version-1' },
    });
    expect(() =>
      taskContextRevisionSchema.parse({
        ...context,
        materials: [context.materials?.[0], context.materials?.[0]],
      }),
    ).not.toThrow();
  });
});

describe('window theme protocol', () => {
  it('allows only explicit six-digit color values across the IPC boundary', () => {
    expect(
      updateWindowThemeRequestSchema.parse({ backgroundColor: '#F6F7F5', symbolColor: '#1D2420' }),
    ).toEqual({ backgroundColor: '#F6F7F5', symbolColor: '#1D2420' });
    expect(() =>
      updateWindowThemeRequestSchema.parse({
        backgroundColor: 'rgba(0,0,0,.4)',
        symbolColor: '#fff',
      }),
    ).toThrow();
  });
});

describe('artifact export protocol', () => {
  it('accepts an Artifact with an optional explicit historical version', () => {
    expect(exportMarkdownArtifactRequestSchema.parse({ artifactId: 'artifact-1' })).toEqual({
      artifactId: 'artifact-1',
    });
    expect(
      exportMarkdownArtifactRequestSchema.parse({
        artifactId: 'artifact-1',
        versionId: 'version-2',
      }),
    ).toEqual({ artifactId: 'artifact-1', versionId: 'version-2' });
    expect(() => exportMarkdownArtifactRequestSchema.parse({ artifactId: '' })).toThrow();
  });
});

describe('skill management protocol', () => {
  const skill = {
    id: 'skill-1',
    name: 'PPT generation',
    description: 'Generate editable presentations',
    sourceKind: 'user' as const,
    enabled: true,
    currentRevisionId: 'revision-1',
    trustStatus: 'untrusted' as const,
    environmentStatus: 'unprepared' as const,
    blockedReasons: ['untrusted' as const, 'environment-unprepared' as const],
  };

  it('keeps trust, enabled, and environment state independent', () => {
    expect(skillSummarySchema.parse(skill)).toEqual(skill);
    expect(() => skillSummarySchema.parse({ ...skill, canRun: false })).toThrow();
    expect(
      skillSummarySchema.parse({
        ...skill,
        enabled: false,
        trustStatus: 'trusted',
        environmentStatus: 'ready',
        blockedReasons: ['disabled'],
      }),
    ).toMatchObject({ enabled: false, trustStatus: 'trusted', environmentStatus: 'ready' });
  });

  it('rejects client-supplied trust fingerprints and arbitrary source paths', () => {
    expect(setSkillTrustRequestSchema.parse({ skillId: 'skill-1', trusted: true })).toEqual({
      skillId: 'skill-1',
      trusted: true,
    });
    expect(() =>
      setSkillTrustRequestSchema.parse({
        skillId: 'skill-1',
        trusted: true,
        contentHash: 'forged',
      }),
    ).toThrow();
    expect(importSkillRequestSchema.parse({})).toEqual({});
    expect(() => importSkillRequestSchema.parse({ sourcePath: '/Users/private/skill' })).toThrow();
  });

  it('preserves non-semver versions and allows a pure instruction profile', () => {
    expect(
      skillRevisionSummarySchema.parse({
        id: 'revision-1',
        skillId: 'skill-1',
        contentHash: 'sha256:content',
        originalVersion: 'v20260907',
        resourceKey: 'user/skill-1/sha256-content',
        frontmatter: { version: 'v20260907', custom: 'preserved' },
        createdAt: 1,
      }).originalVersion,
    ).toBe('v20260907');
    expect(
      runtimeProfileDraftSchema.parse({
        commands: [],
        environmentRequirements: [],
        outputContract: { outputPaths: [] },
      }),
    ).toEqual({ commands: [], environmentRequirements: [], outputContract: { outputPaths: [] } });
    expect(() =>
      runtimeProfileDraftSchema.parse({
        commands: [],
        environmentRequirements: [],
        outputContract: {},
        extra: 1,
      }),
    ).toThrow();
  });

  it('limits Skill deletion to an application-owned identifier', () => {
    expect(deleteSkillRequestSchema.parse({ skillId: 'skill-1' })).toEqual({ skillId: 'skill-1' });
    expect(() =>
      deleteSkillRequestSchema.parse({ skillId: 'skill-1', sourcePath: '/tmp' }),
    ).toThrow();
  });
});

describe('script execution protocol', () => {
  const jobSpec = {
    protocolVersion: 1,
    executionId: 'exec-1',
    runId: 'run-1',
    toolCallId: 'tool-1',
    bindingId: 'binding-1',
    commandId: 'svg-export',
    executable: '/managed/python/bin/python3',
    argv: ['export.py', '--out', 'deck.svg'],
    cwd: '/workspace/tasks/t1/runs/run-1/work',
    env: { PPTM_HOME: '/managed/snapshot' },
    timeoutMs: 300_000,
    maxOutputBytes: 32_768,
    maxLogBytes: 10_485_760,
    expectedOutputs: ['deck.svg'],
  };

  it('pins the host-owned job spec and rejects shell strings or extra fields', () => {
    expect(jobSpecSchema.parse(jobSpec)).toEqual(jobSpec);
    expect(() => jobSpecSchema.parse({ ...jobSpec, protocolVersion: 2 })).toThrow();
    expect(() => jobSpecSchema.parse({ ...jobSpec, shell: 'python3 export.py' })).toThrow();
    expect(() => jobSpecSchema.parse({ ...jobSpec, env: { DEBUG: true } })).toThrow();
    expect(() => jobSpecSchema.parse({ ...jobSpec, argv: 'export.py' })).toThrow();
  });

  it('discriminates job results by kind and keeps the failure phase vocabulary closed', () => {
    expect(
      jobResultSchema.parse({
        kind: 'succeeded',
        exitCode: 0,
        outputIds: ['out-1'],
        durationMs: 42,
      }),
    ).toEqual({ kind: 'succeeded', exitCode: 0, outputIds: ['out-1'], durationMs: 42 });
    expect(
      jobResultSchema.parse({
        kind: 'failed',
        phase: 'validate',
        code: 'quality-gate',
        summary: '结构校验未通过',
        retryable: true,
      }),
    ).toMatchObject({ phase: 'validate' });
    expect(() =>
      jobResultSchema.parse({
        kind: 'failed',
        phase: 'download',
        code: 'x',
        summary: 's',
        retryable: false,
      }),
    ).toThrow();
    expect(() => jobResultSchema.parse({ kind: 'cancelled', diagnosticOutputIds: [] })).toThrow();
    expect(
      jobResultSchema.parse({ kind: 'timed-out', cleanupCompleted: true, diagnosticOutputIds: [] }),
    ).toMatchObject({ kind: 'timed-out' });
  });

  it('keeps execution status vocabulary closed and reason optional', () => {
    const execution = {
      id: 'exec-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      bindingId: 'binding-1',
      commandId: 'svg-export',
      argumentDigest: 'sha256:args',
      inputHashes: [],
      workDirKey: 'tasks/t1/runs/run-1/work',
      attemptKey: 'attempt-1',
      status: 'queued',
      outputIds: [],
      createdAt: 1,
    };
    expect(scriptExecutionSchema.parse(execution)).toEqual(execution);
    expect(() => scriptExecutionSchema.parse({ ...execution, status: 'stopping' })).toThrow();
    expect(() => scriptExecutionSchema.parse({ ...execution, status: 'ready' })).toThrow();
    expect(
      scriptExecutionSchema.parse({ ...execution, status: 'failed', reason: 'cleanup-failed' }),
    ).toMatchObject({ reason: 'cleanup-failed' });
  });
});

describe('dependency and environment protocol', () => {
  const wheelHash = 'a'.repeat(64);
  const lock = {
    lockVersion: 1,
    platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
    pythonRequirement: '3.12',
    packages: [
      {
        name: 'python-pptx',
        version: '1.0.2',
        wheel: 'python_pptx-1.0.2-py3-none-any.whl',
        sha256: wheelHash,
        source: 'wheelhouse',
      },
    ],
    importProbes: ['pptx'],
  };

  it('accepts a fully pinned lock and rejects loose or unhashed entries', () => {
    expect(dependencyLockSchema.parse(lock)).toEqual(lock);
    expect(() => dependencyLockSchema.parse({ ...lock, lockVersion: 2 })).toThrow();
    expect(() =>
      dependencyLockSchema.parse({
        ...lock,
        packages: [{ ...lock.packages[0], sha256: 'not-a-hash' }],
      }),
    ).toThrow();
    expect(() =>
      dependencyLockSchema.parse({
        ...lock,
        packages: [{ ...lock.packages[0], source: 'any-index' }],
      }),
    ).toThrow();
  });

  it('only approves https origins without embedded credentials', () => {
    const approved = {
      ...lock,
      packages: [
        { ...lock.packages[0], source: 'approved-index', origin: 'https://pypi.org/simple' },
      ],
    };
    expect(dependencyLockSchema.parse(approved).packages[0]).toMatchObject({
      source: 'approved-index',
    });
    for (const origin of [
      'http://pypi.org/simple',
      'file:///wheels',
      'https://user:pass@pypi.org/simple',
    ]) {
      expect(() =>
        dependencyLockSchema.parse({
          ...lock,
          packages: [{ ...lock.packages[0], source: 'approved-index', origin }],
        }),
      ).toThrow();
    }
  });

  it('keeps environment and operation status vocabularies closed', () => {
    const environment = {
      id: 'env-1',
      environmentKey: 'key-1',
      base: { kind: 'local', path: '/usr/bin/python3', version: '3.12.14' },
      platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
      lockHash: 'hash-1',
      lock,
      pathKey: 'environments/key-1/instance-1',
      status: 'preparing',
      createdAt: 1,
      updatedAt: 1,
    };
    expect(runtimeEnvironmentSchema.parse(environment)).toEqual(environment);
    expect(() => runtimeEnvironmentSchema.parse({ ...environment, status: 'broken' })).toThrow();
    expect(() =>
      runtimeEnvironmentSchema.parse({
        ...environment,
        base: { kind: 'managed', distributionId: 'd', version: '3.12.14', sha256: 'short' },
      }),
    ).toThrow();
    expect(
      runtimeEnvironmentSchema.parse({
        ...environment,
        base: { kind: 'managed', distributionId: 'd', version: '3.12.14', sha256: wheelHash },
      }).base,
    ).toMatchObject({ kind: 'managed' });

    const operation = {
      id: 'op-1',
      environmentId: 'env-1',
      environmentKey: 'key-1',
      kind: 'prepare',
      status: 'running',
      step: 'install-packages',
      createdAt: 1,
    };
    expect(dependencyOperationSchema.parse(operation)).toEqual(operation);
    expect(() => dependencyOperationSchema.parse({ ...operation, status: 'done' })).toThrow();
    expect(() => dependencyOperationSchema.parse({ ...operation, step: 'pip-install' })).toThrow();
  });
});

describe('工作型记忆契约不变量', () => {
  const hash64 = 'a'.repeat(64);
  const baseRecord = {
    id: 'memory-1',
    revisionId: 'memory-1-r1',
    revision: 1,
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    kind: 'procedural',
    facet: 'method',
    content: '月报先核对财务规则。',
    sourceType: 'user-explicit',
    confidence: 1,
    status: 'confirmed',
    contentHash: hash64,
    normalizedHash: hash64,
    recallPolicy: 'relevant',
    provenance: {
      schemaVersion: 1,
      verification: 'legacy-unverified',
      sourceType: 'user-explicit',
    },
    createdAt: 10,
    updatedAt: 10,
  };

  it('按 Unicode 码点而不是 UTF-16 长度计量', () => {
    expect(countCodePoints('记忆abc')).toBe(5);
    expect(countCodePoints('\u4e2d\u6587')).toBe(2);
    expect(MEMORY_RECALL_VERSION).toBe('memory-recall-v1');
    expect(MEMORY_RECALL_TOTAL_ITEM_LIMIT).toBe(16);
  });

  it('契约写死的正文与适用条件上限都要真的卡住', () => {
    expect(
      memoryRecordSchema.safeParse({ ...baseRecord, content: '记'.repeat(2_000) }).success,
    ).toBe(true);
    expect(
      memoryRecordSchema.safeParse({ ...baseRecord, content: '记'.repeat(2_001) }).success,
    ).toBe(false);
    const keepBoth = {
      operationId: '6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b',
      left: { id: 'memory-1', expectedRevision: 1 },
      right: { id: 'memory-2', expectedRevision: 3 },
      decision: 'keep-both',
    };
    expect(
      resolveMemoryConflictRequestSchema.safeParse({
        ...keepBoth,
        applicabilityNote: '条'.repeat(300),
      }).success,
    ).toBe(true);
    expect(
      resolveMemoryConflictRequestSchema.safeParse({
        ...keepBoth,
        applicabilityNote: '条'.repeat(301),
      }).success,
    ).toBe(false);
  });

  it('召回策略只认 relevant / pinned 两个值', () => {
    // 契约 §11.3：新列用 CHECK 约束枚举，协议层同样不接受第三种值或缺字段。
    expect(memoryRecordSchema.safeParse({ ...baseRecord, recallPolicy: 'pinned' }).success).toBe(
      true,
    );
    expect(memoryRecordSchema.safeParse({ ...baseRecord, recallPolicy: 'always' }).success).toBe(
      false,
    );
    const withoutPolicy: Record<string, unknown> = { ...baseRecord };
    delete withoutPolicy.recallPolicy;
    expect(memoryRecordSchema.safeParse(withoutPolicy).success).toBe(false);
  });

  it('facet 与 kind 由宿主映射，客户端不能提交矛盾组合', () => {
    expect(facetToKind.method).toBe('procedural');
    expect(facetToKind.preference).toBe('preference');
    expect(facetToKind.experience).toBe('episodic');
    expect(
      memoryRecordSchema.safeParse({ ...baseRecord, facet: 'method', kind: 'preference' }).success,
    ).toBe(false);
    expect(memoryRecordSchema.safeParse(baseRecord).success).toBe(true);
  });

  it('来源摘录必须与 start/end 区间按码点一致', () => {
    expect(
      memorySourceRefSchema.safeParse({
        kind: 'run-user',
        runId: 'r-1',
        promptHash: hash64,
        excerpt: '收入',
        excerptHash: hash64,
        start: 0,
        end: 3,
      }).success,
    ).toBe(false);
    expect(
      memorySourceRefSchema.safeParse({
        kind: 'run-user',
        runId: 'r-1',
        promptHash: hash64,
        excerpt: '收入',
        excerptHash: hash64,
        start: 0,
        end: 2,
      }).success,
    ).toBe(true);
    expect(
      memorySourceSelectorSchema.safeParse({ kind: 'run-user', runId: 'r-1', start: 4, end: 2 })
        .success,
    ).toBe(false);
  });

  it('来源必须是 verified 或 legacy 两种形状之一', () => {
    expect(
      memoryProvenanceSchema.safeParse({ schemaVersion: 1, verification: 'verified' }).success,
    ).toBe(false);
    expect(
      memoryProvenanceSchema.safeParse({
        schemaVersion: 1,
        verification: 'legacy-unverified',
        sourceType: 'conversation',
      }).success,
    ).toBe(true);
  });

  it('EditPatch 至少一个字段，日期支持显式 clear', () => {
    expect(memoryEditPatchSchema.safeParse({}).success).toBe(false);
    expect(memoryEditPatchSchema.safeParse({ validUntil: { action: 'clear' } }).success).toBe(true);
    expect(
      memoryEditPatchSchema.safeParse({
        validFrom: { action: 'set', value: 200 },
        validUntil: { action: 'set', value: 100 },
      }).success,
    ).toBe(false);
  });

  it('治理动作与错误码是封闭枚举', () => {
    expect(memoryGovernanceActionSchema.safeParse('confirm').success).toBe(true);
    expect(memoryGovernanceActionSchema.safeParse('model-confirm').success).toBe(false);
    expect(memoryErrorCodeSchema.safeParse('IDEMPOTENCY_CONFLICT').success).toBe(true);
    expect(memoryErrorCodeSchema.safeParse('IPC_FAILURE').success).toBe(false);
  });

  it('写回执只能表达已提交，Result 只表达成功或领域失败', () => {
    const receipt = {
      operationId: '6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b',
      commit: 'committed',
      effect: 'created',
      committedRevisionIds: [hash64],
      projectionState: 'synced',
    };
    expect(memoryWriteReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(memoryWriteReceiptSchema.safeParse({ ...receipt, commit: 'pending' }).success).toBe(
      false,
    );
    const schema = resultSchema(memoryWriteReceiptSchema);
    expect(schema.safeParse({ ok: true, data: receipt, warnings: [] }).success).toBe(true);
    expect(
      schema.safeParse({
        ok: false,
        error: { code: 'NOT_FOUND', message: '记忆不存在。', retryable: false },
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ ok: true, data: receipt }).success).toBe(false);
  });

  it('分页只带版本化游标，简报拒绝缺字段的对象', () => {
    expect(listPageSchema(memoryRecordSchema).safeParse({ items: [] }).success).toBe(true);
    expect(
      listPageSchema(memoryRecordSchema).safeParse({ items: [], nextCursor: { updatedAt: 1 } })
        .success,
    ).toBe(false);
    expect(workspaceBriefSchema.safeParse({}).success).toBe(false);
  });
});
