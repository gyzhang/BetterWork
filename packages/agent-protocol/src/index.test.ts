import { describe, expect, it } from 'vitest';

import {
  artifactInputRelationSchema,
  artifactTypeSchema,
  countCodePoints,
  createMemoryRequestSchema,
  deleteSkillRequestSchema,
  dependencyLockSchema,
  dependencyOperationSchema,
  executeMissedScheduleRequestSchema,
  executeScheduleNowRequestSchema,
  expertReferenceMaterialSchema,
  exportMarkdownArtifactRequestSchema,
  facetToKind,
  importSkillRequestSchema,
  jobResultSchema,
  jobSpecSchema,
  listPageSchema,
  listScheduleOccurrencesRequestSchema,
  listScheduleSourceItemsRequestSchema,
  listSchedulesRequestSchema,
  MAX_RUN_SKILL_BINDINGS,
  mcpToolBindingSchema,
  mcpToolSummarySchema,
  MEMORY_RECALL_BLOCK_CODE_POINT_BUDGET,
  MEMORY_RECALL_CONTENT_CODE_POINT_BUDGET,
  MEMORY_RECALL_PINNED_CODE_POINT_BUDGET,
  MEMORY_RECALL_PINNED_ITEM_LIMIT,
  MEMORY_RECALL_PREFERENCE_CODE_POINT_BUDGET,
  MEMORY_RECALL_PREFERENCE_ITEM_LIMIT,
  MEMORY_RECALL_TOTAL_ITEM_LIMIT,
  MEMORY_RECALL_VERSION,
  MEMORY_RECALL_VERSION_V2,
  MEMORY_RECALL_WRAPPER_CODE_POINT_BUDGET,
  MEMORY_TASK_EXCLUSION_MAX,
  memoryConflictPairSchema,
  memoryEditPatchSchema,
  memoryErrorCodeSchema,
  memoryGovernanceActionSchema,
  memoryOperationRecordSchema,
  memoryProvenanceSchema,
  memoryQueryContextSchema,
  memoryRecallPolicyV1,
  memoryRecallPolicyV2,
  memoryRecordSchema,
  memorySourceRefSchema,
  memorySourceSelectorSchema,
  memoryWriteReceiptSchema,
  resolveMemoryConflictRequestSchema,
  resultSchema,
  retryScheduleOutputRequestSchema,
  runMaterialReadSchema,
  runMemoryContextSchema,
  runtimeEnvironmentSchema,
  runtimeProfileDraftSchema,
  saveScheduleRequestSchema,
  saveTaskContextRequestSchema,
  saveTaskContinuityBriefRequestSchema,
  SCHEDULE_KNOWLEDGE_SOURCE_MAX,
  SCHEDULE_PREPARATION_TIMEOUT_MS,
  SCHEDULE_PREVIEW_COUNT,
  SCHEDULE_SOURCE_ITEM_MAX,
  SCHEDULE_WORKSPACE_DIRECTORY_DEPTH_MAX,
  SCHEDULE_WORKSPACE_FILE_MAX,
  SCHEDULE_WORKSPACE_SINGLE_FILE_BYTES_MAX,
  SCHEDULE_WORKSPACE_TOTAL_FILE_BYTES_MAX,
  scheduleCasConflictSchema,
  scheduleConfigDraftSchema,
  scheduleConfigSchema,
  scheduleDomainErrorSchema,
  scheduleKnowledgeSourcesSchema,
  scheduleOccurrenceResultSchema,
  scheduleOccurrenceSchema,
  scheduleOutputReceiptSchema,
  scheduleResolvedPeriodSchema,
  scheduleSchema,
  scheduleSourceItemSchema,
  scheduleSourceSnapshotSchema,
  scheduleTimingSchema,
  scriptExecutionSchema,
  setScheduleLifecycleRequestSchema,
  setSkillTrustRequestSchema,
  skillBindingSchema,
  skillRevisionSummarySchema,
  skillSummarySchema,
  startRunRequestSchema,
  taskContextRevisionSchema,
  taskContinuityBriefSchema,
  taskContinuityRevisionSchema,
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

  it('splits conflict view states so only coexistence carries a condition', () => {
    const pair = { leftRevisionId: 'r-1', rightRevisionId: 'r-2' };
    // 并存裁决离开适用条件就不成立：缺字段必须拒绝，不能显示成已裁决。
    expect(memoryConflictPairSchema.safeParse({ ...pair, state: 'keep-both' }).success).toBe(false);
    expect(
      memoryConflictPairSchema.safeParse({
        ...pair,
        state: 'keep-both',
        applicabilityNote: '集团口径用万元，合同明细用元。',
      }).success,
    ).toBe(true);
    expect(memoryConflictPairSchema.safeParse({ ...pair, state: 'unresolved' }).success).toBe(true);
    // 未裁决与替代不携带说明：strict 分支拒绝多余字段，避免把空串当说明。
    expect(
      memoryConflictPairSchema.safeParse({
        ...pair,
        state: 'replaced',
        applicabilityNote: '',
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

describe('scheduled task protocol', () => {
  const period = {
    rule: 'previous-month',
    timeZone: 'Asia/Shanghai',
    anchorAt: 1_790_000_000_000,
    startAt: 1_787_000_000_000,
    endAt: 1_789_000_000_000,
    label: '2026 年 9 月',
  } as const;

  const config = {
    name: '月度经营回顾',
    expertId: 'expert-1',
    expertRevisionId: 'expert-revision-3',
    requirements: '核对上月经营变化并列出证据。',
    expectedArtifactTypes: ['markdown'],
    timing: {
      frequency: 'monthly',
      day: 5,
      hour: 9,
      minute: 0,
      timeZone: 'Asia/Shanghai',
    },
    periodRule: 'previous-month',
    knowledgeSources: [],
    outputSubdirectory: '定时成果',
  } as const;

  const missedOccurrence = {
    id: 'occurrence-1',
    scheduleId: 'schedule-1',
    configVersion: 1,
    trigger: 'scheduled',
    scheduledAt: 1_790_000_000_000,
    requestedAt: 1_790_000_000_000,
    period,
    phase: 'closed',
    preparationOutcome: 'missed',
    createdAt: 1_790_000_000_000,
    finishedAt: 1_790_000_000_001,
  } as const;

  it('accepts every timing and period branch and rejects invalid dates or zones', () => {
    expect(
      scheduleTimingSchema.safeParse({
        frequency: 'daily',
        hour: 23,
        minute: 59,
        timeZone: 'UTC',
      }).success,
    ).toBe(true);
    expect(
      scheduleTimingSchema.safeParse({
        frequency: 'weekly',
        weekday: 7,
        hour: 9,
        minute: 0,
        timeZone: 'Asia/Tokyo',
      }).success,
    ).toBe(true);
    expect(scheduleTimingSchema.safeParse(config.timing).success).toBe(true);
    expect(scheduleTimingSchema.safeParse({ ...config.timing, day: 32 }).success).toBe(false);
    expect(
      scheduleTimingSchema.safeParse({ ...config.timing, timeZone: 'America/New_York' }).success,
    ).toBe(false);
    expect(
      scheduleTimingSchema.safeParse({
        frequency: 'daily',
        hour: 9,
        minute: 60,
        timeZone: 'UTC',
      }).success,
    ).toBe(false);

    for (const rule of ['previous-month', 'rolling-seven-days', 'current-week', 'previous-week']) {
      expect(scheduleResolvedPeriodSchema.safeParse({ ...period, rule }).success, rule).toBe(true);
    }
    expect(
      scheduleResolvedPeriodSchema.safeParse({
        rule: 'none',
        timeZone: 'UTC',
        anchorAt: 1_790_000_000_000,
        label: '不指定期间',
      }).success,
    ).toBe(true);
    expect(
      scheduleResolvedPeriodSchema.safeParse({ ...period, startAt: period.endAt }).success,
    ).toBe(false);
    const mondayMidnight = Date.UTC(2026, 0, 5);
    const emptyCurrentWeek = {
      rule: 'current-week',
      timeZone: 'UTC',
      anchorAt: mondayMidnight,
      startAt: mondayMidnight,
      endAt: mondayMidnight,
      label: '本周（空期间）',
    } as const;
    expect(scheduleResolvedPeriodSchema.safeParse(emptyCurrentWeek).success).toBe(true);
    expect(
      scheduleResolvedPeriodSchema.safeParse({
        ...emptyCurrentWeek,
        rule: 'previous-week',
      }).success,
    ).toBe(false);
    expect(
      scheduleResolvedPeriodSchema.safeParse({ ...emptyCurrentWeek, anchorAt: mondayMidnight + 1 })
        .success,
    ).toBe(false);
    expect(scheduleResolvedPeriodSchema.safeParse({ ...period, endAt: -1 }).success).toBe(false);
  });

  it('validates fixed scope descriptions and rejects duplicate or out-of-scope sources', () => {
    expect(
      scheduleKnowledgeSourcesSchema.safeParse([
        { kind: 'document', documentId: 'doc-1', purpose: 'background' },
        { kind: 'collection', collectionId: 'collection-1', purpose: 'template' },
        { kind: 'vault', vaultId: 'default', purpose: 'other' },
      ]).success,
    ).toBe(true);
    expect(
      scheduleKnowledgeSourcesSchema.safeParse([
        { kind: 'document', documentId: 'doc-1', purpose: 'background' },
        { kind: 'document', documentId: 'doc-1', purpose: 'template' },
      ]).success,
    ).toBe(false);
    expect(
      scheduleKnowledgeSourcesSchema.safeParse([
        { kind: 'vault', vaultId: 'another-vault', purpose: 'background' },
      ]).success,
    ).toBe(false);
    expect(
      scheduleKnowledgeSourcesSchema.safeParse([
        { kind: 'document', documentId: '', purpose: 'background' },
      ]).success,
    ).toBe(false);
    expect(
      scheduleKnowledgeSourcesSchema.safeParse([
        { kind: 'document', documentId: 'doc-2', purpose: 'background', unexpected: true },
      ]).success,
    ).toBe(false);
    const sourceSetOf = (count: number) =>
      Array.from({ length: count }, (_unused, index) => ({
        kind: 'document' as const,
        documentId: `document-${index}`,
        purpose: 'background' as const,
      }));
    expect(SCHEDULE_KNOWLEDGE_SOURCE_MAX).toBe(50);
    expect(SCHEDULE_SOURCE_ITEM_MAX).toBe(2_000);
    expect(SCHEDULE_PREVIEW_COUNT).toBe(3);
    expect(SCHEDULE_PREPARATION_TIMEOUT_MS).toBe(120_000);
    expect(SCHEDULE_WORKSPACE_FILE_MAX).toBe(500);
    expect(SCHEDULE_WORKSPACE_SINGLE_FILE_BYTES_MAX).toBe(100 * 1024 * 1024);
    expect(SCHEDULE_WORKSPACE_TOTAL_FILE_BYTES_MAX).toBe(500 * 1024 * 1024);
    expect(SCHEDULE_WORKSPACE_DIRECTORY_DEPTH_MAX).toBe(12);
    expect(scheduleKnowledgeSourcesSchema.safeParse(sourceSetOf(50)).success).toBe(true);
    expect(scheduleKnowledgeSourcesSchema.safeParse(sourceSetOf(51)).success).toBe(false);

    expect(scheduleConfigDraftSchema.safeParse(config).success).toBe(true);
    expect(
      scheduleConfigDraftSchema.safeParse({
        ...config,
        expectedArtifactTypes: ['markdown', 'markdown'],
      }).success,
    ).toBe(false);
    expect(
      scheduleConfigDraftSchema.safeParse({ ...config, expectedArtifactTypes: ['spreadsheet'] })
        .success,
    ).toBe(false);
    expect(artifactTypeSchema.parse('presentation')).toBe('presentation');
    expect(scheduleConfigDraftSchema.safeParse({ ...config, unrecognized: 'value' }).success).toBe(
      false,
    );

    const pinnedConfig = {
      ...config,
      scheduleId: 'schedule-1',
      version: 1,
      createdAt: 1_790_000_000_000,
    } as const;
    expect(scheduleConfigSchema.safeParse(pinnedConfig).success).toBe(true);
    expect(scheduleConfigSchema.safeParse({ ...pinnedConfig, version: 0 }).success).toBe(false);
    expect(
      scheduleSourceItemSchema.safeParse({
        snapshotId: 'source-1',
        ordinal: 0,
        reference: {
          kind: 'knowledge-revision',
          knowledgeDocumentId: 'document-1',
          knowledgeRevisionId: 'document-revision-3',
          contentHash: 'content-hash-1',
          sourcePath: '/virtual/合成材料.md',
        },
        purpose: 'background',
        origin: 'selected-document',
        displayName: '合成材料.md',
        sourcePath: '/virtual/合成材料.md',
      }).success,
    ).toBe(true);
  });

  it('enforces automatic and manual occurrence identities and phase relationships', () => {
    expect(scheduleOccurrenceSchema.safeParse(missedOccurrence).success).toBe(true);
    expect(
      scheduleOccurrenceSchema.safeParse({
        ...missedOccurrence,
        trigger: 'scheduled',
        requestKey: 'should-not-appear',
      }).success,
    ).toBe(false);
    expect(
      scheduleOccurrenceSchema.safeParse({
        ...missedOccurrence,
        trigger: 'manual-now',
        requestKey: 'request-1',
      }).success,
    ).toBe(false);
    expect(
      scheduleOccurrenceSchema.safeParse({
        ...missedOccurrence,
        scheduledAt: undefined,
        trigger: 'manual-missed',
        requestKey: 'request-2',
        originalOccurrenceId: 'occurrence-original',
        preparationOutcome: 'cancelled',
      }).success,
    ).toBe(true);
    expect(
      scheduleOccurrenceSchema.safeParse({
        ...missedOccurrence,
        scheduledAt: undefined,
        trigger: 'manual-missed',
        requestKey: 'request-2',
        originalOccurrenceId: 'occurrence-original',
        preparationOutcome: 'missed',
      }).success,
    ).toBe(false);
    expect(
      scheduleOccurrenceSchema.safeParse({
        ...missedOccurrence,
        scheduledAt: undefined,
        trigger: 'manual-missed',
        requestKey: 'request-2',
      }).success,
    ).toBe(false);

    const preparing = {
      ...missedOccurrence,
      phase: 'preparing',
      preparationOutcome: undefined,
      finishedAt: undefined,
    } as const;
    expect(scheduleOccurrenceSchema.safeParse(preparing).success).toBe(true);
    expect(scheduleOccurrenceSchema.safeParse({ ...preparing, taskId: 'task-1' }).success).toBe(
      false,
    );
    const preparingAfterT3 = {
      ...preparing,
      taskId: 'task-1',
      sessionId: 'session-1',
      sourceSnapshotId: 'source-1',
      preparedAt: 1_790_000_000_001,
    } as const;
    expect(scheduleOccurrenceSchema.safeParse(preparingAfterT3).success).toBe(true);
    expect(
      scheduleOccurrenceSchema.safeParse({
        ...preparingAfterT3,
        sourceSnapshotId: undefined,
      }).success,
    ).toBe(false);
    expect(
      scheduleOccurrenceSchema.safeParse({
        ...preparingAfterT3,
        phase: 'closed',
        preparationOutcome: 'interrupted-before-run',
        finishedAt: 1_790_000_000_002,
      }).success,
    ).toBe(true);

    const dispatched = {
      ...missedOccurrence,
      phase: 'dispatched',
      preparationOutcome: undefined,
      taskId: 'task-1',
      sessionId: 'session-1',
      firstRunId: 'run-1',
      sourceSnapshotId: 'source-1',
      preparedAt: 1_790_000_000_001,
      finishedAt: undefined,
    } as const;
    expect(scheduleOccurrenceSchema.safeParse(dispatched).success).toBe(true);
    expect(
      scheduleOccurrenceSchema.safeParse({ ...dispatched, firstRunId: undefined }).success,
    ).toBe(false);
    expect(
      scheduleOccurrenceSchema.safeParse({
        ...missedOccurrence,
        preparationOutcome: undefined,
      }).success,
    ).toBe(false);
    expect(
      scheduleOccurrenceSchema.safeParse({
        ...missedOccurrence,
        preparationOutcome: 'needs-material',
        taskId: 'task-1',
      }).success,
    ).toBe(true);
  });

  it('requires enabled schedule records to retain their authorization basis', () => {
    const enabledSchedule = {
      id: 'schedule-1',
      workspaceId: 'workspace-1',
      revision: 3,
      currentConfigVersion: 2,
      lifecycle: 'enabled',
      nextScheduledAt: 1_790_000_000_000,
      enabledAt: 1_789_000_000_000,
      enabledConfigVersion: 2,
      capabilityFingerprint: 'fingerprint-1',
      createdAt: 1_788_000_000_000,
      updatedAt: 1_789_000_000_000,
    } as const;
    expect(scheduleSchema.safeParse(enabledSchedule).success).toBe(true);
    expect(
      scheduleSchema.safeParse({ ...enabledSchedule, capabilityFingerprint: undefined }).success,
    ).toBe(false);
    expect(
      scheduleSchema.safeParse({
        id: 'schedule-1',
        workspaceId: 'workspace-1',
        revision: 3,
        currentConfigVersion: 2,
        lifecycle: 'paused',
        createdAt: 1_788_000_000_000,
        updatedAt: 1_789_000_000_000,
        unknown: true,
      }).success,
    ).toBe(false);
  });

  it('validates snapshot/output failure facts and structured CAS responses', () => {
    const hash = 'a'.repeat(64);
    const readySnapshot = {
      id: 'source-1',
      occurrenceId: 'occurrence-1',
      workspaceId: 'workspace-1',
      status: 'ready',
      configVersion: 1,
      evaluatedAt: 1_790_000_000_000,
      manifestHash: hash,
      itemCount: 1,
      totalFileBytes: 42,
      createdAt: 1_790_000_000_000,
      completedAt: 1_790_000_000_001,
    } as const;
    expect(scheduleSourceSnapshotSchema.safeParse(readySnapshot).success).toBe(true);
    expect(
      scheduleSourceSnapshotSchema.safeParse({
        ...readySnapshot,
        status: 'failed',
        failureCode: undefined,
      }).success,
    ).toBe(false);
    expect(
      scheduleSourceSnapshotSchema.safeParse({ ...readySnapshot, unknown: true }).success,
    ).toBe(false);

    const receipt = {
      id: 'receipt-1',
      occurrenceId: 'occurrence-1',
      artifactVersionId: 'artifact-version-1',
      workspaceId: 'workspace-1',
      relativePath: '定时成果/月度回顾.md',
      contentHash: hash,
      status: 'saved',
      attempt: 1,
      createdAt: 1_790_000_000_000,
      updatedAt: 1_790_000_000_001,
    } as const;
    expect(scheduleOutputReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(
      scheduleOutputReceiptSchema.safeParse({
        ...receipt,
        status: 'failed',
        failureCode: 'schedule_output_save_failed',
      }).success,
    ).toBe(true);
    expect(scheduleOutputReceiptSchema.safeParse({ ...receipt, contentHash: 'bad' }).success).toBe(
      false,
    );

    expect(
      scheduleDomainErrorSchema.safeParse({
        code: 'schedule_busy',
        message: '已有运行中的实例。',
        existingOccurrenceId: 'occurrence-1',
        problems: [{ code: 'run_busy', message: 'Run 尚未结束。' }],
      }).success,
    ).toBe(true);
    expect(
      scheduleDomainErrorSchema.safeParse({
        code: 'schedule_capacity',
        message: '后台准备容量已占用。',
      }).success,
    ).toBe(true);
    expect(
      scheduleDomainErrorSchema.safeParse({
        code: 'schedule_preparation_failed',
        message: '自动派发准备失败。',
      }).success,
    ).toBe(true);
    expect(
      scheduleCasConflictSchema.safeParse({
        code: 'schedule_conflict',
        message: '配置已被另一操作更新。',
        currentRevision: 4,
      }).success,
    ).toBe(true);
    expect(
      scheduleCasConflictSchema.safeParse({
        code: 'schedule_conflict',
        message: '配置已被另一操作更新。',
      }).success,
    ).toBe(false);
  });

  it('keeps save, lifecycle, execute and page requests strict and versioned', () => {
    expect(
      saveScheduleRequestSchema.safeParse({
        operation: 'create',
        workspaceId: 'workspace-1',
        config,
        targetLifecycle: 'paused',
      }).success,
    ).toBe(true);
    expect(
      saveScheduleRequestSchema.safeParse({
        operation: 'create',
        workspaceId: 'workspace-1',
        config,
        targetLifecycle: 'enabled',
      }).success,
    ).toBe(false);
    expect(
      saveScheduleRequestSchema.safeParse({
        operation: 'create',
        workspaceId: 'workspace-1',
        config,
        targetLifecycle: 'enabled',
        preflightFingerprint: 'fingerprint-1',
      }).success,
    ).toBe(true);
    expect(
      saveScheduleRequestSchema.safeParse({
        operation: 'update',
        scheduleId: 'schedule-1',
        expectedRevision: 2,
        config,
        targetLifecycle: 'paused',
      }).success,
    ).toBe(true);
    expect(
      saveScheduleRequestSchema.safeParse({
        operation: 'update',
        scheduleId: 'schedule-1',
        expectedRevision: 0,
        config,
        targetLifecycle: 'paused',
      }).success,
    ).toBe(false);
    expect(
      saveScheduleRequestSchema.safeParse({
        operation: 'create',
        workspaceId: 'workspace-1',
        scheduleId: 'cannot-move-workspace',
        config,
        targetLifecycle: 'paused',
      }).success,
    ).toBe(false);
    expect(
      setScheduleLifecycleRequestSchema.safeParse({
        scheduleId: 'schedule-1',
        expectedRevision: 1,
        lifecycle: 'enabled',
      }).success,
    ).toBe(false);
    expect(
      setScheduleLifecycleRequestSchema.safeParse({
        scheduleId: 'schedule-1',
        expectedRevision: 1,
        lifecycle: 'enabled',
        preflightFingerprint: 'fingerprint-1',
      }).success,
    ).toBe(true);
    expect(
      executeScheduleNowRequestSchema.safeParse({
        scheduleId: 'schedule-1',
        expectedRevision: 1,
        requestKey: 'request-1',
        preflightFingerprint: 'fingerprint-1',
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      executeMissedScheduleRequestSchema.safeParse({
        scheduleId: 'schedule-1',
        originalOccurrenceId: 'occurrence-1',
        expectedRevision: 1,
        requestKey: 'request-2',
        preflightFingerprint: 'fingerprint-1',
      }).success,
    ).toBe(true);
    expect(listSchedulesRequestSchema.parse({}).limit).toBe(50);
    expect(
      listScheduleOccurrencesRequestSchema.safeParse({
        scheduleId: 'schedule-1',
        cursor: { version: 1, createdAt: 10, id: 'occurrence-1' },
        limit: 100,
      }).success,
    ).toBe(true);
    expect(
      listScheduleOccurrencesRequestSchema.safeParse({
        scheduleId: 'schedule-1',
        cursor: { version: 1, updatedAt: 10, id: 'occurrence-1' },
      }).success,
    ).toBe(false);
    expect(
      listScheduleSourceItemsRequestSchema.safeParse({
        occurrenceId: 'occurrence-1',
        cursor: { version: 1, snapshotId: 'source-1', ordinal: 10 },
        limit: 20,
      }).success,
    ).toBe(true);
    expect(
      listScheduleSourceItemsRequestSchema.safeParse({ occurrenceId: 'occurrence-1', limit: 101 })
        .success,
    ).toBe(false);
    expect(
      retryScheduleOutputRequestSchema.safeParse({ receiptId: 'receipt-1', expectedAttempt: 1 })
        .success,
    ).toBe(true);
  });

  it('projects only the occurrence run and rejects unknown result fields', () => {
    const run = {
      id: 'run-1',
      taskId: 'task-1',
      sessionId: 'session-1',
      prompt: '生成经营回顾',
      status: 'completed',
      createdAt: 1_790_000_000_000,
      completedAt: 1_790_000_000_100,
    } as const;
    const dispatchedThenClosed = {
      ...missedOccurrence,
      phase: 'closed',
      preparationOutcome: undefined,
      taskId: 'task-1',
      sessionId: 'session-1',
      firstRunId: 'run-1',
      sourceSnapshotId: 'source-1',
      preparedAt: 1_790_000_000_010,
    } as const;
    const result = {
      occurrence: dispatchedThenClosed,
      status: 'generated',
      run,
      outputReceipts: [],
    } as const;
    expect(scheduleOccurrenceResultSchema.safeParse(result).success).toBe(true);
    expect(
      scheduleOccurrenceResultSchema.safeParse({ ...result, run: { ...run, id: 'other-run' } })
        .success,
    ).toBe(false);
    expect(
      scheduleOccurrenceResultSchema.safeParse({ ...result, privateThought: 'no' }).success,
    ).toBe(false);
    expect(
      scheduleOccurrenceResultSchema.safeParse({
        occurrence: missedOccurrence,
        status: 'generated',
        outputReceipts: [],
      }).success,
    ).toBe(false);
    expect(
      scheduleOccurrenceResultSchema.safeParse({
        ...result,
        outputReceipts: [
          {
            id: 'receipt-1',
            occurrenceId: 'another-occurrence',
            artifactVersionId: 'artifact-version-1',
            workspaceId: 'workspace-1',
            relativePath: '定时成果/月度回顾.md',
            contentHash: 'a'.repeat(64),
            status: 'saved',
            attempt: 1,
            createdAt: 1_790_000_000_000,
            updatedAt: 1_790_000_000_001,
          },
        ],
      }).success,
    ).toBe(false);
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

  it('declares multiple external toolchains with unique stable IDs and environment variables', () => {
    const profile = {
      commands: [],
      environmentRequirements: [],
      toolchainRequirements: [
        { id: 'ppt-master', name: 'PPT Master', environmentVariable: 'PPTM_HOME' },
        { id: 'svg-tools', name: 'SVG Tools', environmentVariable: 'SVG_TOOLS_HOME' },
      ],
      outputContract: { outputPaths: [] },
    };
    expect(runtimeProfileDraftSchema.parse(profile).toolchainRequirements).toHaveLength(2);
    expect(() =>
      runtimeProfileDraftSchema.parse({
        ...profile,
        toolchainRequirements: [
          ...profile.toolchainRequirements,
          { id: 'ppt-master', name: 'Duplicate', environmentVariable: 'PPTM_HOME' },
        ],
      }),
    ).toThrow();
  });

  it('accepts package-local dependency locks and rejects paths outside the Skill package', () => {
    const profile = {
      commands: [],
      environmentRequirements: [],
      pythonRequirement: '3.12',
      dependencyBundle: {
        id: 'ppt-expert-darwin-arm64-cp312',
        lockPath: 'runtime/locks/darwin-arm64-cp312.json',
        wheelhousePath: 'runtime/wheelhouse',
      },
      toolchainRequirements: [
        {
          id: 'ppt-master',
          name: 'PPT Master',
          environmentVariable: 'PPTM_HOME',
          versionHint: '6.6.0',
          expectedCommit: '680de11f1bef4628b68d5daad9dffec569fbd51f',
        },
      ],
      outputContract: { outputPaths: [] },
    };
    expect(runtimeProfileDraftSchema.parse(profile).dependencyBundle).toEqual(
      profile.dependencyBundle,
    );
    expect(() =>
      runtimeProfileDraftSchema.parse({
        ...profile,
        dependencyBundle: { id: 'unsafe', lockPath: '../outside.json' },
      }),
    ).toThrow();
    expect(() =>
      runtimeProfileDraftSchema.parse({
        ...profile,
        dependencyLockId: 'global-lock',
      }),
    ).toThrow();
  });

  it('accepts declarative command contracts and rejects unsafe entrypoints or undeclared toolchains', () => {
    const profile = {
      commands: [
        {
          commandId: 'render',
          label: 'Render',
          argumentSchema: { type: 'object', properties: {} },
          timeoutMs: 60_000,
          execution: {
            entrypoint: {
              scope: 'toolchain',
              runtime: 'managed-python',
              toolchainId: 'renderer',
              path: 'scripts/render.py',
            },
            pathArguments: [],
            argv: [
              { kind: 'literal', value: 'render' },
              { kind: 'work-directory' },
              { kind: 'output', outputId: 'rendered' },
            ],
            outputs: [
              {
                outputId: 'rendered',
                source: { kind: 'generated', relativePath: '.attempts/{executionId}/deck.bin' },
                extension: 'bin',
                mimeType: 'application/octet-stream',
                validation: {
                  structure: 'not-checked',
                  visual: 'not-checked',
                  manualEdit: 'not-checked',
                },
              },
            ],
          },
        },
      ],
      environmentRequirements: [],
      toolchainRequirements: [
        { id: 'renderer', name: 'Renderer', environmentVariable: 'RENDERER_HOME' },
      ],
      outputContract: { outputPaths: [] },
    };

    expect(runtimeProfileDraftSchema.parse(profile).commands[0]?.execution).toEqual(
      profile.commands[0]?.execution,
    );
    expect(() =>
      runtimeProfileDraftSchema.parse({
        ...profile,
        commands: [
          {
            ...profile.commands[0],
            execution: {
              ...profile.commands[0]?.execution,
              entrypoint: {
                scope: 'toolchain',
                runtime: 'managed-python',
                toolchainId: 'renderer',
                path: '../outside.py',
              },
            },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      runtimeProfileDraftSchema.parse({
        ...profile,
        toolchainRequirements: [],
      }),
    ).toThrow('未声明的工具链');
    expect(() =>
      runtimeProfileDraftSchema.parse({
        ...profile,
        commands: [
          {
            ...profile.commands[0],
            validatorId: 'host-only-validator',
          },
        ],
      }),
    ).toThrow('不得引用宿主 validatorId');
    expect(() =>
      runtimeProfileDraftSchema.parse({
        ...profile,
        commands: [
          {
            ...profile.commands[0],
            execution: {
              ...profile.commands[0]?.execution,
              pathArguments: [{ argumentName: 'template', scope: 'skill', access: 'write' }],
            },
          },
        ],
      }),
    ).toThrow('Skill 包资源只能以只读方式传入命令');
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
    // 契约 §11.1：摘录下限 1 码点，空区间不能当作「已保留来源」。
    expect(
      memorySourceRefSchema.safeParse({
        kind: 'run-user',
        runId: 'r-1',
        promptHash: hash64,
        excerpt: '',
        excerptHash: hash64,
        start: 0,
        end: 0,
      }).success,
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

  it('来源摘录的两个上限各管各的：manual 跟正文，选择器来源跟摘录', () => {
    const manualOf = (length: number) => ({
      kind: 'manual',
      operationId: '6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b',
      contentHash: hash64,
      start: 0,
      end: length,
      excerpt: '记'.repeat(length),
      excerptHash: hash64,
    });
    // 自主口径的摘录就是正文，允许到 2,000 码点；超过仍拒绝。
    expect(memorySourceRefSchema.safeParse(manualOf(2_000)).success).toBe(true);
    expect(memorySourceRefSchema.safeParse(manualOf(2_001)).success).toBe(false);
    expect(
      memorySourceRefSchema.safeParse({
        kind: 'run-assistant',
        runId: 'r-1',
        eventId: 'e-1',
        contentHash: hash64,
        start: 0,
        end: 501,
        excerpt: '记'.repeat(501),
        excerptHash: hash64,
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

/**
 * MI05/契约 §11.4：历史 v1 快照与新 v2 快照混存时，判别必须靠 recallVersion＋快照分支。
 * 这三条拒绝路径是防伪造的最后一道，缺任何一条都会让「旧数据兼容读取」变成「任意改写都能读」。
 */
describe('MI 运行快照 v1/v2 兼容与优先预算字面量', () => {
  const hash = 'b'.repeat(64);
  type Snapshot = Record<string, unknown>;
  interface Item {
    memoryId: string;
    revisionId: string;
    contentHash: string;
    order: number;
    score: number;
    reason: string;
  }

  const itemOf = (order: number, reason: string): Item => ({
    memoryId: `memory-${order}`,
    revisionId: `revision-${order}`,
    contentHash: hash,
    order,
    score: reason === 'pinned-rule' ? 0 : 640,
    reason,
  });

  const contextOf = (recallVersion: string, policySnapshot: Snapshot, items: Item[]) => ({
    runId: 'run-1',
    schemaVersion: 1,
    phase: 'request-prepared',
    recallVersion,
    evaluatedAt: 1_700_000_001_000,
    queryHash: hash,
    policySnapshot,
    selectedItems: items,
    replay: [],
    materialDependencyUnion: [],
    memoryDependencyUnion: [],
    decisionSummary: {
      budget: {
        totalItems: items.length,
        preferenceItems: 0,
        contentCodePoints: 120,
        wrapperCodePoints: 40,
        blockCodePoints: 160,
      },
      exclusions: [],
      queryTruncated: false,
      conflictReviewRequired: false,
    },
    authorizationHash: hash,
    requestHash: hash,
    selectedAt: 1_700_000_001_000,
    requestPreparedAt: 1_700_000_002_000,
    updatedAt: 1_700_000_002_000,
  });

  const without = (snapshot: Snapshot, key: string): Snapshot => {
    const copy: Snapshot = { ...snapshot };
    delete copy[key];
    return copy;
  };

  it('v1 与 v2 的合法快照都原样可读，v2 允许 pinned-rule', () => {
    expect(
      runMemoryContextSchema.safeParse(
        contextOf(MEMORY_RECALL_VERSION, memoryRecallPolicyV1, [itemOf(1, 'task-relevant')]),
      ).success,
    ).toBe(true);
    expect(
      runMemoryContextSchema.safeParse(
        contextOf(MEMORY_RECALL_VERSION_V2, memoryRecallPolicyV2, [
          itemOf(1, 'pinned-rule'),
          itemOf(2, 'task-relevant'),
        ]),
      ).success,
    ).toBe(true);
  });

  it('recallVersion 与快照分支不同侧即拒绝', () => {
    expect(
      runMemoryContextSchema.safeParse(
        contextOf(MEMORY_RECALL_VERSION, memoryRecallPolicyV2, [itemOf(1, 'task-relevant')]),
      ).success,
    ).toBe(false);
    expect(
      runMemoryContextSchema.safeParse(
        contextOf(MEMORY_RECALL_VERSION_V2, memoryRecallPolicyV1, [itemOf(1, 'task-relevant')]),
      ).success,
    ).toBe(false);
  });

  it('v2 缺任一优先预算字段不合法，v1 携带这两个字段也不合法', () => {
    const items = [itemOf(1, 'task-relevant')];
    expect(
      runMemoryContextSchema.safeParse(
        contextOf(
          MEMORY_RECALL_VERSION_V2,
          without(memoryRecallPolicyV2, 'pinnedItemLimit'),
          items,
        ),
      ).success,
    ).toBe(false);
    expect(
      runMemoryContextSchema.safeParse(
        contextOf(
          MEMORY_RECALL_VERSION_V2,
          without(memoryRecallPolicyV2, 'pinnedCodePointBudget'),
          items,
        ),
      ).success,
    ).toBe(false);
    expect(
      runMemoryContextSchema.safeParse(
        contextOf(
          MEMORY_RECALL_VERSION,
          { ...memoryRecallPolicyV1, pinnedItemLimit: MEMORY_RECALL_PINNED_ITEM_LIMIT },
          items,
        ),
      ).success,
    ).toBe(false);
  });

  it('pinned-rule 塞进 v1 历史快照必须拒绝，而不是被兼容读取', () => {
    const parsed = runMemoryContextSchema.safeParse(
      contextOf(MEMORY_RECALL_VERSION, memoryRecallPolicyV1, [itemOf(1, 'pinned-rule')]),
    );
    expect(parsed.success).toBe(false);
  });

  it('优先/偏好/总额预算的字面量写死，改动必须同时升算法版本', () => {
    expect(MEMORY_RECALL_PINNED_ITEM_LIMIT).toBe(6);
    expect(MEMORY_RECALL_PINNED_CODE_POINT_BUDGET).toBe(2_000);
    expect(MEMORY_RECALL_PREFERENCE_ITEM_LIMIT).toBe(2);
    expect(MEMORY_RECALL_PREFERENCE_CODE_POINT_BUDGET).toBe(600);
    expect(MEMORY_RECALL_TOTAL_ITEM_LIMIT).toBe(16);
    expect(MEMORY_RECALL_CONTENT_CODE_POINT_BUDGET).toBe(6_000);
    expect(MEMORY_RECALL_WRAPPER_CODE_POINT_BUDGET).toBe(2_000);
    expect(MEMORY_RECALL_BLOCK_CODE_POINT_BUDGET).toBe(8_000);
    expect(memoryRecallPolicyV2.pinnedItemLimit).toBe(6);
    expect(memoryRecallPolicyV2.pinnedCodePointBudget).toBe(2_000);
    expect(Object.hasOwn(memoryRecallPolicyV1, 'pinnedItemLimit')).toBe(false);
  });

  it('任务排除上限 100：第 101 个被拒绝而不是静默截断', () => {
    const queryOf = (count: number) => ({
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      taskContextRevisionId: 'revision-1',
      evaluatedAt: 1_700_000_001_000,
      prompt: '做份经营回顾',
      taskTitle: '经营回顾',
      materialTitles: [],
      excludedMemoryIds: Array.from({ length: count }, (_unused, index) => `memory-${index}`),
    });
    expect(MEMORY_TASK_EXCLUSION_MAX).toBe(100);
    expect(memoryQueryContextSchema.safeParse(queryOf(100)).success).toBe(true);
    expect(memoryQueryContextSchema.safeParse(queryOf(101)).success).toBe(false);
    // 写回口用同一上限：界面拦在前面，Schema 是兜底，两处不能各有自己的数字。
    const saveOf = (count: number) => ({
      taskId: 'task-1',
      executor: { kind: 'general' },
      skillBindings: [],
      excludedMemoryIds: Array.from({ length: count }, (_unused, index) => `memory-${index}`),
    });
    expect(saveTaskContextRequestSchema.safeParse(saveOf(100)).success).toBe(true);
    expect(saveTaskContextRequestSchema.safeParse(saveOf(101)).success).toBe(false);
  });

  it('TaskContext 的 Schedule 范围区分未提供、明确移除和绑定 ID', () => {
    const saveOf = (scope?: string | null) => ({
      taskId: 'task-1',
      executor: { kind: 'general' as const },
      skillBindings: [],
      ...(scope === undefined ? {} : { scheduleSourceSnapshotId: scope }),
    });
    expect(saveTaskContextRequestSchema.safeParse(saveOf()).success).toBe(true);
    expect(saveTaskContextRequestSchema.safeParse(saveOf(null)).success).toBe(true);
    expect(saveTaskContextRequestSchema.safeParse(saveOf('source-1')).success).toBe(true);
    expect(saveTaskContextRequestSchema.safeParse(saveOf('')).success).toBe(false);
  });

  it('Task Continuity Brief 与 revision 严格校验来源、版本和文本预算', () => {
    const promptHash = 'a'.repeat(64);
    const brief = {
      schemaVersion: 1,
      objective: { text: '完成季度分析', source: 'task-goal' },
      activeRequirements: [
        {
          id: 'requirement-1',
          text: '使用最新季度数据',
          authoredBy: 'assistant-summary',
          sources: [{ runId: 'run-1', promptHash }],
        },
      ],
      progress: {
        authoredBy: 'assistant-summary',
        status: 'in-progress',
        completedActions: ['核对数据范围'],
        blockers: [],
        artifactVersionIds: [],
        sourceRunId: 'run-1',
        sourcePromptHash: promptHash,
      },
    } as const;

    expect(taskContinuityBriefSchema.safeParse(brief).success).toBe(true);
    expect(
      taskContinuityBriefSchema.safeParse({
        ...brief,
        progress: { ...brief.progress, status: 'finished' },
      }).success,
    ).toBe(false);
    expect(
      taskContinuityBriefSchema.safeParse({
        ...brief,
        activeRequirements: [{ ...brief.activeRequirements[0], sources: undefined }],
      }).success,
    ).toBe(false);
    expect(
      taskContinuityBriefSchema.safeParse({
        ...brief,
        objective: { text: '😀'.repeat(20_001), source: 'task-goal' },
      }).success,
    ).toBe(false);
    expect(
      taskContinuityBriefSchema.safeParse({ ...brief, unexpected: 'not accepted' }).success,
    ).toBe(false);

    expect(
      taskContinuityRevisionSchema.safeParse({
        id: 'continuity-revision-1',
        taskId: 'task-1',
        revision: 1,
        schemaVersion: 1,
        brief,
        sourceKind: 'task-goal',
        briefHash: promptHash,
        createdAt: 1,
      }).success,
    ).toBe(true);
    expect(
      taskContinuityRevisionSchema.safeParse({
        id: 'continuity-revision-2',
        taskId: 'task-1',
        revision: 2,
        schemaVersion: 1,
        brief,
        sourceKind: 'assistant-summary',
        briefHash: promptHash,
        createdAt: 2,
      }).success,
    ).toBe(false);
  });

  it('Task Continuity 用户编辑请求只接受可编辑字段并限制条目预算', () => {
    const edit = {
      taskId: 'task-1',
      expectedRevision: 2,
      objective: '完成经营复盘',
      activeRequirements: [{ id: 'requirement-1', text: '保留同比口径' }, { text: '列出风险' }],
      progress: {
        status: 'blocked',
        completedActions: ['已核对收入数据'],
        nextAction: '补齐费用说明',
        blockers: ['等待业务确认'],
        artifactVersionIds: ['artifact-version-1'],
      },
    } as const;

    expect(saveTaskContinuityBriefRequestSchema.safeParse(edit).success).toBe(true);
    expect(
      saveTaskContinuityBriefRequestSchema.safeParse({
        ...edit,
        activeRequirements: Array.from({ length: 5 }, (_, index) => ({ text: `要求 ${index}` })),
      }).success,
    ).toBe(false);
    expect(
      saveTaskContinuityBriefRequestSchema.safeParse({
        ...edit,
        activeRequirements: [{ text: '😀'.repeat(2_001) }],
      }).success,
    ).toBe(false);
    expect(
      saveTaskContinuityBriefRequestSchema.safeParse({
        ...edit,
        progress: { ...edit.progress, authoredBy: 'assistant-summary' },
      }).success,
    ).toBe(false);
  });
});
