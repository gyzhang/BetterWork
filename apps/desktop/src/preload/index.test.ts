import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BetterWorkDesktopApi } from '@betterwork/agent-protocol';
import { IpcChannel } from '@betterwork/agent-protocol';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  invoke: vi.fn<(channel: string, input: unknown) => Promise<unknown>>(),
  listeners: new Map<string, (event: unknown, raw: unknown) => void>(),
  off: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: unknown) => {
      mocks.exposed.set('api', api);
    },
  },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: (channel: string, listener: (event: unknown, raw: unknown) => void) => {
      mocks.listeners.set(channel, listener);
    },
    off: mocks.off,
  },
}));

import './index';

const api = (): BetterWorkDesktopApi => {
  const exposed = mocks.exposed.get('api');
  if (typeof exposed !== 'object' || exposed === null) {
    throw new Error('Preload API was not exposed');
  }
  return exposed as BetterWorkDesktopApi;
};

const rejected = {
  status: 'rejected',
  error: { code: 'schedule_conflict', message: '合成拒绝结果' },
};

const config = {
  name: '月度复盘',
  expertId: 'expert-1',
  expertRevisionId: 'expert-revision-1',
  requirements: '分析上月变化并列出依据。',
  expectedArtifactTypes: ['markdown' as const],
  timing: {
    frequency: 'monthly' as const,
    day: 5,
    hour: 9,
    minute: 0,
    timeZone: 'Asia/Shanghai' as const,
  },
  periodRule: 'previous-month' as const,
  knowledgeSources: [],
  outputSubdirectory: '定时成果' as const,
};

describe('schedule preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.invoke.mockResolvedValue(rejected);
  });

  it('validates and forwards every schedule request through its typed channel', async () => {
    const schedules = api().schedules;
    await Promise.all([
      schedules.list(),
      schedules.get({ scheduleId: 'schedule-1' }),
      schedules.save({
        operation: 'create',
        workspaceId: 'workspace-1',
        config,
        targetLifecycle: 'paused',
      }),
      schedules.setLifecycle({
        scheduleId: 'schedule-1',
        expectedRevision: 1,
        lifecycle: 'paused',
      }),
      schedules.preview({ timing: config.timing, periodRule: config.periodRule }),
      schedules.preflight({ target: 'draft', workspaceId: 'workspace-1', config }),
      schedules.applyExpertRevision({
        scheduleId: 'schedule-1',
        expectedRevision: 1,
        expertRevisionId: 'expert-revision-2',
      }),
      schedules.listOccurrences({ scheduleId: 'schedule-1', limit: 10 }),
      schedules.getOccurrence({ occurrenceId: 'occurrence-1' }),
      schedules.listSourceItems({ occurrenceId: 'occurrence-1', limit: 10 }),
      schedules.executeNow({
        scheduleId: 'schedule-1',
        expectedRevision: 1,
        requestKey: 'manual-once',
        preflightFingerprint: 'fingerprint-1',
      }),
      schedules.executeMissed({
        scheduleId: 'schedule-1',
        originalOccurrenceId: 'occurrence-1',
        expectedRevision: 1,
        requestKey: 'missed-once',
        preflightFingerprint: 'fingerprint-1',
      }),
      schedules.cancelOccurrence({ occurrenceId: 'occurrence-1' }),
      schedules.retryOutput({ receiptId: 'receipt-1', expectedAttempt: 1 }),
    ]);

    expect(mocks.invoke.mock.calls.map(([channel]) => channel)).toEqual([
      IpcChannel.ListSchedules,
      IpcChannel.GetSchedule,
      IpcChannel.SaveSchedule,
      IpcChannel.SetScheduleLifecycle,
      IpcChannel.PreviewSchedule,
      IpcChannel.PreflightSchedule,
      IpcChannel.ApplyScheduleExpertRevision,
      IpcChannel.ListScheduleOccurrences,
      IpcChannel.GetScheduleOccurrence,
      IpcChannel.ListScheduleSourceItems,
      IpcChannel.ExecuteScheduleNow,
      IpcChannel.ExecuteMissedSchedule,
      IpcChannel.CancelScheduleOccurrence,
      IpcChannel.RetryScheduleOutput,
    ]);
    expect(mocks.invoke).toHaveBeenCalledTimes(14);
  });

  it('rejects malformed preload inputs before IPC and malformed responses after IPC', async () => {
    expect(() => api().schedules.get({ scheduleId: '' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValueOnce({ status: 'success', data: {} });
    await expect(api().schedules.list()).rejects.toThrow();
  });

  it('validates schedule change events and removes the subscribed listener', () => {
    const listener = vi.fn();
    const unsubscribe = api().schedules.onChange(listener);
    const handler = mocks.listeners.get(IpcChannel.ScheduleChanged);
    expect(handler).toBeDefined();
    handler?.({}, { scheduleId: 'schedule-1', reason: 'occurrence' });
    expect(listener).toHaveBeenCalledWith({ scheduleId: 'schedule-1', reason: 'occurrence' });
    expect(() => handler?.({}, { scheduleId: '', reason: 'unknown' })).toThrow();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(mocks.off).toHaveBeenCalledWith(IpcChannel.ScheduleChanged, handler);
  });
});

describe('Skill and Expert preload APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(null);
  });

  it('preserves request validation, empty list inputs, and response validation', async () => {
    expect(() => api().skills.get({ id: '' })).toThrow();
    expect(() => api().experts.get({ id: '' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    await expect(api().skills.list()).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledWith(IpcChannel.ListSkills, {});

    mocks.invoke.mockClear();
    await expect(api().experts.list()).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledWith(IpcChannel.ListExperts, { includeArchived: false });
  });
});

describe('task support preload APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(null);
  });

  it('preserves Task, continuity, checkpoint, and material request/response validation', async () => {
    await expect(api().taskContexts.get({ taskId: 'task-1' })).resolves.toBeNull();
    expect(mocks.invoke).toHaveBeenLastCalledWith(IpcChannel.GetTaskContext, {
      taskId: 'task-1',
    });

    await expect(api().taskContinuity.getBrief({ taskId: 'task-1' })).resolves.toBeNull();
    mocks.invoke.mockResolvedValueOnce([]);
    await expect(api().discussionCheckpoints.list({ taskId: 'task-1' })).resolves.toEqual([]);
    mocks.invoke.mockResolvedValueOnce([]);
    await expect(api().materials.listCandidates({ taskId: 'task-1' })).resolves.toEqual([]);
    await expect(api().materials.prepareInputSnapshot({ taskId: 'task-1' })).resolves.toBeNull();

    expect(mocks.invoke.mock.calls.map(([channel]) => channel)).toEqual([
      IpcChannel.GetTaskContext,
      IpcChannel.GetTaskContinuityBrief,
      IpcChannel.ListDiscussionCheckpoints,
      IpcChannel.ListTaskMaterialCandidates,
      IpcChannel.PrepareWorkspaceInputSnapshot,
    ]);
    expect(() => api().taskContexts.get({ taskId: '' })).toThrow();
  });
});

describe('memory preload API', () => {
  const memoryFailure = {
    ok: false as const,
    error: { code: 'INTERNAL_ERROR' as const, message: '合成错误', retryable: false },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(memoryFailure);
  });

  it('preserves request defaults and the Memory Result envelope', async () => {
    await expect(api().memories.list({})).resolves.toEqual(memoryFailure);
    expect(mocks.invoke).toHaveBeenLastCalledWith(IpcChannel.ListMemories, {
      includeCandidates: true,
    });

    expect(() => api().memories.get({ id: '' })).toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    await expect(api().memories.listJobs({ workspaceId: 'workspace-1' })).resolves.toEqual(
      memoryFailure,
    );
    expect(mocks.invoke).toHaveBeenLastCalledWith(IpcChannel.ListMemoryJobs, {
      workspaceId: 'workspace-1',
    });
  });
});

describe('run preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue([]);
  });

  it('validates and forwards Run requests and responses through their channels', async () => {
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === IpcChannel.StartRun) return { runId: 'run-1' };
      if (channel === IpcChannel.CancelRun) return { cancelled: true };
      return [];
    });

    await Promise.all([
      api().runs.start({
        taskId: 'task-1',
        sessionId: 'session-1',
        prompt: '归纳本次资料。',
      }),
      api().runs.cancel({ runId: 'run-1' }),
      api().runs.list(),
      api().runs.listEvents({ runId: 'run-1' }),
    ]);

    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.StartRun, { taskId: 'task-1', sessionId: 'session-1', prompt: '归纳本次资料。' }],
      [IpcChannel.CancelRun, { runId: 'run-1' }],
      [IpcChannel.ListRuns, undefined],
      [IpcChannel.ListRunEvents, { runId: 'run-1' }],
    ]);
  });

  it('rejects invalid Run requests before IPC and malformed responses after IPC', async () => {
    expect(() =>
      api().runs.start({ taskId: '', sessionId: 'session-1', prompt: '归纳本次资料。' }),
    ).toThrow();
    expect(() => api().runs.cancel({ runId: '' })).toThrow();
    expect(() => api().runs.list({ taskId: '' })).toThrow();
    expect(() => api().runs.listEvents({ runId: '' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValue(null);
    await expect(
      api().runs.start({ taskId: 'task-1', sessionId: 'session-1', prompt: '归纳本次资料。' }),
    ).rejects.toThrow();
    await expect(api().runs.cancel({ runId: 'run-1' })).rejects.toThrow();
    await expect(api().runs.list()).rejects.toThrow();
    await expect(api().runs.listEvents({ runId: 'run-1' })).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(4);
  });
});

describe('run settings preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue({
      maxSkillToolRounds: 200,
      enableBuiltinSkills: true,
      enableBuiltinExperts: true,
      updatedAt: 1,
    });
  });

  it('validates and forwards Run Settings requests and responses through their channels', async () => {
    await api().runSettings.get();
    await api().runSettings.save({
      maxSkillToolRounds: 200,
      enableBuiltinSkills: true,
      enableBuiltinExperts: false,
    });

    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.GetRunSettings, {}],
      [
        IpcChannel.SaveRunSettings,
        {
          maxSkillToolRounds: 200,
          enableBuiltinSkills: true,
          enableBuiltinExperts: false,
        },
      ],
    ]);
  });

  it('rejects invalid Run Settings requests before IPC and malformed responses after IPC', async () => {
    expect(() =>
      api().runSettings.save({
        maxSkillToolRounds: 0,
        enableBuiltinSkills: true,
        enableBuiltinExperts: true,
      }),
    ).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValue(null);
    await expect(api().runSettings.get()).rejects.toThrow();
    await expect(
      api().runSettings.save({
        maxSkillToolRounds: 200,
        enableBuiltinSkills: true,
        enableBuiltinExperts: true,
      }),
    ).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });
});

it('binds mapped Preload schemas and methods to their IPC channels at compile time', () => {
  const sourcePath = fileURLToPath(new URL('./index.ts', import.meta.url));
  const configPath = ts.findConfigFile(
    path.dirname(sourcePath),
    (fileName) => ts.sys.fileExists(fileName),
    'tsconfig.json',
  );
  if (!configPath) throw new Error('Repository tsconfig is missing');
  const config = ts.readConfigFile(configPath, (fileName) => ts.sys.readFile(fileName));
  expect(config.error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
  expect(parsed.errors).toEqual([]);

  const valid = [
    `const __runContractResult: Promise<{ runId: string }> = runInvokeMethods[IpcChannel.StartRun]({ taskId: 'task-1', sessionId: 'session-1', prompt: 'prompt' });`,
    `runInvokeMethods[IpcChannel.ListRuns](undefined);`,
    `const __workspaceContractResult: Promise<z.output<typeof workspaceSummarySchema>> = workspaceTaskInvokeMethods[IpcChannel.GetDefaultWorkspace]({});`,
    `workspaceTaskInvokeMethods[IpcChannel.ListTasks](undefined);`,
    `const __taskContractResult: Promise<z.output<typeof recentTaskSummarySchema> | null> = workspaceTaskInvokeMethods[IpcChannel.GetTask]({ id: 'task-1' });`,
    `const __taskContractChannel: typeof IpcChannel.GetTask = workspaceTaskInvokeContracts[IpcChannel.GetTask].channel;`,
    `const __evidenceContractResult: Promise<EvidenceSummary[]> = artifactEvidenceInvokeMethods[IpcChannel.ListEvidence]({ taskId: 'task-1' });`,
    `const __artifactContractResult: Promise<ArtifactSummary[]> = artifactEvidenceInvokeMethods[IpcChannel.ListArtifacts](undefined);`,
    `const __artifactContractChannel: typeof IpcChannel.GetArtifactVersion = artifactEvidenceInvokeContracts[IpcChannel.GetArtifactVersion].channel;`,
    `const __artifactRevealResult: Promise<z.output<typeof revealFileArtifactResultSchema>> = artifactEvidenceInvokeMethods[IpcChannel.RevealFileArtifact]({ artifactId: 'artifact-1' });`,
    `const __artifactThumbnailsResult: Promise<z.output<typeof getArtifactThumbnailsResultSchema>> = artifactEvidenceInvokeMethods[IpcChannel.GetArtifactThumbnails]({ artifactId: 'artifact-1' });`,
    `const __modelContractResult: Promise<z.output<typeof modelProfileListResponseSchema>> = modelSearchNotificationInvokeMethods[IpcChannel.ListModels]({});`,
    `const __searchContractResult: Promise<z.output<typeof searchEngineListResponseSchema>> = modelSearchNotificationInvokeMethods[IpcChannel.ListSearchEngines]({});`,
    `const __notificationContractResult: Promise<z.output<typeof notificationSummarySchema> | null> = modelSearchNotificationInvokeMethods[IpcChannel.GetNotification]({ id: 'notification-1' });`,
    `const __notificationContractChannel: typeof IpcChannel.DeleteNotification = modelSearchNotificationInvokeContracts[IpcChannel.DeleteNotification].channel;`,
    `const __notificationEventUnsubscribe: () => void = notificationEventMethods[IpcChannel.NotificationChangeEvent]((event) => { const type: 'created' | 'read' | 'read-all' | 'deleted' | 'cleared' = event.type; });`,
    `const __activationEventUnsubscribe: () => void = notificationEventMethods[IpcChannel.NotificationActivated]((event) => { const id: string = event.id; });`,
    `const __knowledgeListResult: Promise<z.output<typeof knowledgeDocumentSummarySchema>[]> = knowledgeInvokeMethods[IpcChannel.ListKnowledge]({});`,
    `const __knowledgeJobResult: Promise<z.output<typeof knowledgeJobDetailSchema> | null> = knowledgeInvokeMethods[IpcChannel.GetKnowledgeJob]({ jobId: 'job-1' });`,
    `const __knowledgeSourceResult: Promise<OpenKnowledgeSourceResult> = knowledgeInvokeMethods[IpcChannel.OpenKnowledgeSource]({ sourcePath: '/tmp/source.md' });`,
    `const __knowledgeSourceChannel: typeof IpcChannel.GetRunArtifactDeclarations = knowledgeInvokeContracts[IpcChannel.GetRunArtifactDeclarations].channel;`,
    `const __knowledgeEventUnsubscribe: () => void = knowledgeEventMethods[IpcChannel.KnowledgeJobEvent]((event) => { const id: string = event.id; const sequence: number = event.sequence; });`,
    `const __scheduleListResult: ReturnType<BetterWorkDesktopApi['schedules']['list']> = scheduleInvokeMethods[IpcChannel.ListSchedules]({});`,
    `const __scheduleContractChannel: typeof IpcChannel.ExecuteScheduleNow = scheduleInvokeContracts[IpcChannel.ExecuteScheduleNow].channel;`,
    `const __scheduleEventUnsubscribe: () => void = scheduleEventMethods[IpcChannel.ScheduleChanged]((event) => { const scheduleId: string = event.scheduleId; });`,
    `const __skillGetResult: Promise<z.output<typeof skillDetailSchema> | null> = skillInvokeMethods[IpcChannel.GetSkill]({ id: 'skill-1' });`,
    `const __skillContractChannel: typeof IpcChannel.TestSkillRun = skillInvokeContracts[IpcChannel.TestSkillRun].channel;`,
    `const __expertGetResult: Promise<z.output<typeof expertDetailSchema> | null> = expertInvokeMethods[IpcChannel.GetExpert]({ id: 'expert-1' });`,
    `const __expertContractChannel: typeof IpcChannel.SetExpertLifecycle = expertInvokeContracts[IpcChannel.SetExpertLifecycle].channel;`,
    `const __taskContextGetResult: Promise<z.output<typeof taskContextRevisionSchema> | null> = taskSupportInvokeMethods[IpcChannel.GetTaskContext]({ taskId: 'task-1' });`,
    `declare const __taskContextSaveInput: z.input<typeof saveTaskContextRequestSchema>; const __taskContextSaveResult: Promise<z.output<typeof taskContextMutationResultSchema>> = taskSupportInvokeMethods[IpcChannel.SaveTaskContext](__taskContextSaveInput);`,
    `const __taskContinuityGetResult: Promise<z.output<typeof taskContinuityRevisionSchema> | null> = taskSupportInvokeMethods[IpcChannel.GetTaskContinuityBrief]({ taskId: 'task-1' });`,
    `declare const __taskContinuitySaveInput: z.input<typeof saveTaskContinuityBriefRequestSchema>; const __taskContinuitySaveResult: Promise<z.output<typeof taskContinuityBriefMutationResultSchema>> = taskSupportInvokeMethods[IpcChannel.SaveTaskContinuityBrief](__taskContinuitySaveInput);`,
    `const __discussionListResult: Promise<z.output<typeof discussionCheckpointSchema>[]> = taskSupportInvokeMethods[IpcChannel.ListDiscussionCheckpoints]({ taskId: 'task-1' });`,
    `declare const __discussionCreateInput: z.input<typeof createDiscussionCheckpointRequestSchema>; const __discussionCreateResult: Promise<z.output<typeof discussionCheckpointMutationResultSchema>> = taskSupportInvokeMethods[IpcChannel.CreateDiscussionCheckpoint](__discussionCreateInput);`,
    `const __materialCandidatesResult: Promise<z.output<typeof materialCandidateSchema>[]> = taskSupportInvokeMethods[IpcChannel.ListTaskMaterialCandidates]({ taskId: 'task-1' });`,
    `const __inputSnapshotResult: Promise<z.output<typeof inputSnapshotSchema> | null> = taskSupportInvokeMethods[IpcChannel.PrepareWorkspaceInputSnapshot]({ workspaceId: 'workspace-1' });`,
    `const __taskSupportContractChannel: typeof IpcChannel.PrepareWorkspaceInputSnapshot = taskSupportInvokeContracts[IpcChannel.PrepareWorkspaceInputSnapshot].channel;`,
    `const __memoryListResult: ReturnType<BetterWorkDesktopApi['memories']['list']> = memoryInvokeMethods[IpcChannel.ListMemories]({});`,
    `declare const __memoryGetInput: z.input<typeof getMemoryRequestSchema>; const __memoryGetResult: ReturnType<BetterWorkDesktopApi['memories']['get']> = memoryInvokeMethods[IpcChannel.GetMemory](__memoryGetInput);`,
    `declare const __memoryCreateInput: z.input<typeof createMemoryRequestSchema>; const __memoryCreateResult: ReturnType<BetterWorkDesktopApi['memories']['create']> = memoryInvokeMethods[IpcChannel.CreateMemory](__memoryCreateInput);`,
    `declare const __memoryUpdateInput: z.input<typeof updateMemoryRequestSchema>; const __memoryUpdateResult: ReturnType<BetterWorkDesktopApi['memories']['update']> = memoryInvokeMethods[IpcChannel.UpdateMemory](__memoryUpdateInput);`,
    `declare const __memoryStatusInput: z.input<typeof setMemoryStatusRequestSchema>; const __memoryStatusResult: ReturnType<BetterWorkDesktopApi['memories']['setStatus']> = memoryInvokeMethods[IpcChannel.SetMemoryStatus](__memoryStatusInput);`,
    `declare const __memoryResolveInput: z.input<typeof resolveMemoryConflictRequestSchema>; const __memoryResolveResult: ReturnType<BetterWorkDesktopApi['memories']['resolveConflict']> = memoryInvokeMethods[IpcChannel.ResolveMemoryConflict](__memoryResolveInput);`,
    `declare const __memoryPreviewInput: z.input<typeof previewMemoryRequestSchema>; const __memoryPreviewResult: ReturnType<BetterWorkDesktopApi['memories']['preview']> = memoryInvokeMethods[IpcChannel.PreviewMemory](__memoryPreviewInput);`,
    `declare const __memoryExclusionsInput: z.input<typeof taskMemoryExclusionsRequestSchema>; const __memoryExclusionsResult: ReturnType<BetterWorkDesktopApi['memories']['taskExclusions']> = memoryInvokeMethods[IpcChannel.TaskMemoryExclusions](__memoryExclusionsInput);`,
    `declare const __memoryRunContextInput: z.input<typeof getRunMemoryContextRequestSchema>; const __memoryRunContextResult: ReturnType<BetterWorkDesktopApi['memories']['runContext']> = memoryInvokeMethods[IpcChannel.GetRunMemoryContext](__memoryRunContextInput);`,
    `declare const __memorySettingsInput: z.input<typeof getMemorySettingsRequestSchema>; const __memorySettingsResult: ReturnType<BetterWorkDesktopApi['memories']['getSettings']> = memoryInvokeMethods[IpcChannel.GetMemorySettings](__memorySettingsInput);`,
    `declare const __memorySetSettingsInput: z.input<typeof setMemorySettingsRequestSchema>; const __memorySetSettingsResult: ReturnType<BetterWorkDesktopApi['memories']['setSettings']> = memoryInvokeMethods[IpcChannel.SetMemorySettings](__memorySetSettingsInput);`,
    `declare const __memoryJobsInput: z.input<typeof listMemoryJobsRequestSchema>; const __memoryJobsResult: ReturnType<BetterWorkDesktopApi['memories']['listJobs']> = memoryInvokeMethods[IpcChannel.ListMemoryJobs](__memoryJobsInput);`,
    `declare const __memoryRetryInput: z.input<typeof retryMemoryJobRequestSchema>; const __memoryRetryResult: ReturnType<BetterWorkDesktopApi['memories']['retryJob']> = memoryInvokeMethods[IpcChannel.RetryMemoryJob](__memoryRetryInput);`,
    `declare const __memoryCancelInput: z.input<typeof cancelMemoryJobRequestSchema>; const __memoryCancelResult: ReturnType<BetterWorkDesktopApi['memories']['cancelJob']> = memoryInvokeMethods[IpcChannel.CancelMemoryJob](__memoryCancelInput);`,
    `declare const __memoryRebuildInput: z.input<typeof rebuildMemoryProjectionRequestSchema>; const __memoryRebuildResult: ReturnType<BetterWorkDesktopApi['memories']['rebuildProjection']> = memoryInvokeMethods[IpcChannel.RebuildMemoryProjection](__memoryRebuildInput);`,
    `const __memoryContractChannel: typeof IpcChannel.RebuildMemoryProjection = memoryInvokeContracts[IpcChannel.RebuildMemoryProjection].channel;`,
    `const __mcpListResult: ReturnType<BetterWorkDesktopApi['mcp']['listConnections']> = mcpInvokeMethods[IpcChannel.ListMcpConnections]({});`,
    `const __mcpGetResult: ReturnType<BetterWorkDesktopApi['mcp']['getConnection']> = mcpInvokeMethods[IpcChannel.GetMcpConnection]({ id: 'connection-1' });`,
    `const __mcpSaveResult: ReturnType<BetterWorkDesktopApi['mcp']['saveConnection']> = mcpInvokeMethods[IpcChannel.SaveMcpConnection]({ name: 'MCP', transport: { kind: 'stdio', command: 'node' } });`,
    `const __mcpDeleteResult: ReturnType<BetterWorkDesktopApi['mcp']['deleteConnection']> = mcpInvokeMethods[IpcChannel.DeleteMcpConnection]({ id: 'connection-1' });`,
    `const __mcpTestResult: ReturnType<BetterWorkDesktopApi['mcp']['testConnection']> = mcpInvokeMethods[IpcChannel.TestMcpConnection]({ id: 'connection-1', expectedRevisionId: 'revision-1', operationId: 'ba17e5bd-b537-4a68-9b32-231634967f0c' });`,
    `const __mcpLifecycleResult: ReturnType<BetterWorkDesktopApi['mcp']['setLifecycle']> = mcpInvokeMethods[IpcChannel.SetMcpLifecycle]({ id: 'connection-1', expectedRevisionId: 'revision-1', lifecycle: 'enabled' });`,
    `const __mcpReviewResult: ReturnType<BetterWorkDesktopApi['mcp']['reviewTool']> = mcpInvokeMethods[IpcChannel.ReviewMcpTool]({ connectionId: 'connection-1', connectionRevisionId: 'revision-1', toolId: 'tool-1', contractHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', userConfirmed: true });`,
    `const __mcpCancelResult: ReturnType<BetterWorkDesktopApi['mcp']['cancelOperation']> = mcpInvokeMethods[IpcChannel.CancelMcpOperation]({ id: 'connection-1', expectedRevisionId: 'revision-1', operationId: 'ba17e5bd-b537-4a68-9b32-231634967f0c' });`,
    `const __mcpPrepareLoginResult: ReturnType<BetterWorkDesktopApi['mcp']['prepareLogin']> = mcpInvokeMethods[IpcChannel.PrepareMcpLogin]({ id: 'connection-1', expectedRevisionId: 'revision-1', operationId: 'ba17e5bd-b537-4a68-9b32-231634967f0c' });`,
    `const __mcpContinueLoginResult: ReturnType<BetterWorkDesktopApi['mcp']['continueLogin']> = mcpInvokeMethods[IpcChannel.ContinueMcpLogin]({ id: 'connection-1', expectedRevisionId: 'revision-1', operationId: 'ba17e5bd-b537-4a68-9b32-231634967f0c', issuer: 'https://auth.example', consent: true });`,
    `const __mcpLogoutResult: ReturnType<BetterWorkDesktopApi['mcp']['logout']> = mcpInvokeMethods[IpcChannel.LogoutMcpConnection]({ id: 'connection-1', expectedRevisionId: 'revision-1', operationId: 'ba17e5bd-b537-4a68-9b32-231634967f0c' });`,
    `const __mcpContractChannel: typeof IpcChannel.ContinueMcpLogin = mcpInvokeContracts[IpcChannel.ContinueMcpLogin].channel;`,
    `const __dependencyOptionsResult: ReturnType<BetterWorkDesktopApi['dependencies']['listOptions']> = dependencyInvokeMethods[IpcChannel.ListDependencyOptions]({});`,
    `const __dependencyPlanResult: ReturnType<BetterWorkDesktopApi['dependencies']['inspectPlan']> = dependencyInvokeMethods[IpcChannel.InspectDependencyPlan]({ base: { kind: 'local', path: '/usr/bin/python3' }, lockId: 'lock-1' });`,
    `const __dependencyEnvironmentResult: ReturnType<BetterWorkDesktopApi['dependencies']['verifyEnvironment']> = dependencyInvokeMethods[IpcChannel.VerifyDependencyEnvironment]({ environmentId: 'environment-1' });`,
    `const __dependencyPrepareResult: ReturnType<BetterWorkDesktopApi['dependencies']['prepare']> = dependencyInvokeMethods[IpcChannel.PrepareDependencyEnvironment]({ base: { kind: 'local', path: '/usr/bin/python3' }, lockId: 'lock-1', kind: 'prepare' });`,
    `const __dependencyCancelResult: ReturnType<BetterWorkDesktopApi['dependencies']['cancel']> = dependencyInvokeMethods[IpcChannel.CancelDependencyPreparation]({ operationId: 'operation-1' });`,
    `const __dependencyOperationResult: ReturnType<BetterWorkDesktopApi['dependencies']['getOperation']> = dependencyInvokeMethods[IpcChannel.GetDependencyOperation]({ operationId: 'operation-1' });`,
    `const __chooseInterpreterResult: ReturnType<BetterWorkDesktopApi['dependencies']['chooseInterpreter']> = dependencyInvokeMethods[IpcChannel.ChoosePythonInterpreter]({});`,
    `const __registerToolchainResult: ReturnType<BetterWorkDesktopApi['dependencies']['registerToolchain']> = dependencyInvokeMethods[IpcChannel.RegisterToolchainSnapshot]({ include: [] });`,
    `const __deleteToolchainResult: ReturnType<BetterWorkDesktopApi['dependencies']['deleteToolchainSnapshot']> = dependencyInvokeMethods[IpcChannel.DeleteToolchainSnapshot]({ snapshotId: 'snapshot-1' });`,
    `const __dependencyContractChannel: typeof IpcChannel.DeleteToolchainSnapshot = dependencyInvokeContracts[IpcChannel.DeleteToolchainSnapshot].channel;`,
    `const __chromeThemeResult: ReturnType<BetterWorkDesktopApi['chrome']['updateTheme']> = chromeInvokeMethods[IpcChannel.UpdateWindowTheme]({ backgroundColor: '#ffffff' });`,
    `const __chromeMaximizeResult: ReturnType<BetterWorkDesktopApi['chrome']['toggleMaximize']> = chromeInvokeMethods[IpcChannel.WindowToggleMaximize]({});`,
    `const __chromeContractChannel: typeof IpcChannel.WindowToggleMaximize = chromeInvokeContracts[IpcChannel.WindowToggleMaximize].channel;`,
  ];
  const invalid = [
    `runInvokeMethods[IpcChannel.StartRun]({ runId: 'run-1' });`,
    `runInvokeMethods[IpcChannel.CancelRun]({ taskId: 'task-1', sessionId: 'session-1', prompt: 'prompt' });`,
    `workspaceTaskInvokeMethods[IpcChannel.GetDefaultWorkspace]({ workspaceId: 'workspace-1' });`,
    `workspaceTaskInvokeMethods[IpcChannel.CreateTask]({ rootPath: '/tmp/research' });`,
    `workspaceTaskInvokeMethods[IpcChannel.ListTasks]({ taskId: 'task-1' });`,
    `const __workspaceContractWrongResponse: Promise<z.output<typeof recentTaskSummarySchema>> = workspaceTaskInvokeMethods[IpcChannel.GetDefaultWorkspace]({});`,
    `const __taskContractWrongChannel: typeof IpcChannel.GetDefaultWorkspace = workspaceTaskInvokeContracts[IpcChannel.GetTask].channel;`,
    `artifactEvidenceInvokeMethods[IpcChannel.ListEvidence]({ runId: 'run-1' });`,
    `artifactEvidenceInvokeMethods[IpcChannel.ListArtifacts]({ runId: 'run-1' });`,
    `const __artifactContractWrongResponse: Promise<EvidenceSummary[]> = artifactEvidenceInvokeMethods[IpcChannel.ListArtifacts](undefined);`,
    `const __artifactContractWrongChannel: typeof IpcChannel.ListEvidence = artifactEvidenceInvokeContracts[IpcChannel.GetArtifactVersion].channel;`,
    `artifactEvidenceInvokeMethods[IpcChannel.RevealFileArtifact]({ id: 'artifact-1' });`,
    `artifactEvidenceInvokeMethods[IpcChannel.GetArtifactThumbnails]({ artifactId: 'artifact-1', revisionId: 'revision-1' });`,
    `modelSearchNotificationInvokeMethods[IpcChannel.SetModelEnabled]({ id: 'model-1', active: false });`,
    `const __modelContractWrongResponse: Promise<z.output<typeof notificationSummarySchema>[]> = modelSearchNotificationInvokeMethods[IpcChannel.ListModels]({});`,
    `const __searchContractWrongChannel: typeof IpcChannel.ListModels = modelSearchNotificationInvokeContracts[IpcChannel.ListSearchEngines].channel;`,
    `modelSearchNotificationInvokeMethods[IpcChannel.GetNotification]({ notificationId: 'notification-1' });`,
    `const __notificationContractWrongChannel: typeof IpcChannel.ListNotifications = modelSearchNotificationInvokeContracts[IpcChannel.DeleteNotification].channel;`,
    `notificationEventMethods[IpcChannel.NotificationActivated]((event: { type: 'created' }) => {});`,
    `const __notificationEventWrongChannel: typeof IpcChannel.NotificationActivated = notificationEventContracts[IpcChannel.NotificationChangeEvent].channel;`,
    `knowledgeInvokeMethods[IpcChannel.GetKnowledgeJob]({ id: 'job-1' });`,
    `const __knowledgeContractWrongResponse: Promise<z.output<typeof knowledgeSearchResponseSchema>> = knowledgeInvokeMethods[IpcChannel.ListKnowledgeJobs]({});`,
    `const __knowledgeContractWrongChannel: typeof IpcChannel.ListKnowledge = knowledgeInvokeContracts[IpcChannel.GetKnowledgeJob].channel;`,
    `knowledgeEventMethods[IpcChannel.KnowledgeJobEvent]((event) => { const sequence: string = event.sequence; });`,
    `scheduleInvokeMethods[IpcChannel.GetSchedule]({ id: 'schedule-1' });`,
    `const __scheduleContractWrongResponse: Promise<never> = scheduleInvokeMethods[IpcChannel.GetSchedule]({ scheduleId: 'schedule-1' });`,
    `const __scheduleContractWrongChannel: typeof IpcChannel.ListSchedules = scheduleInvokeContracts[IpcChannel.GetSchedule].channel;`,
    `scheduleEventMethods[IpcChannel.ScheduleChanged]((event: { reason: 'occurrence' }) => {});`,
    `skillInvokeMethods[IpcChannel.GetSkill]({ skillId: 'skill-1' });`,
    `const __skillContractWrongResponse: Promise<z.output<typeof skillSummarySchema>[]> = skillInvokeMethods[IpcChannel.GetSkill]({ id: 'skill-1' });`,
    `const __skillContractWrongChannel: typeof IpcChannel.ListSkills = skillInvokeContracts[IpcChannel.TestSkillRun].channel;`,
    `expertInvokeMethods[IpcChannel.GetExpert]({ expertId: 'expert-1' });`,
    `const __expertContractWrongResponse: Promise<z.output<typeof expertSummarySchema>[]> = expertInvokeMethods[IpcChannel.GetExpert]({ id: 'expert-1' });`,
    `const __expertContractWrongChannel: typeof IpcChannel.GetExpert = expertInvokeContracts[IpcChannel.DeleteExpert].channel;`,
    `taskSupportInvokeMethods[IpcChannel.GetTaskContext]({ workspaceId: 'workspace-1' });`,
    `const __taskContextWrongResponse: Promise<never> = taskSupportInvokeMethods[IpcChannel.GetTaskContext]({ taskId: 'task-1' });`,
    `const __taskContinuityWrongResponse: Promise<z.output<typeof taskContextRevisionSchema> | null> = taskSupportInvokeMethods[IpcChannel.GetTaskContinuityBrief]({ taskId: 'task-1' });`,
    `taskSupportInvokeMethods[IpcChannel.ListDiscussionCheckpoints]({ workspaceId: 'workspace-1' });`,
    `const __discussionWrongResponse: Promise<z.output<typeof materialCandidateSchema>[]> = taskSupportInvokeMethods[IpcChannel.ListDiscussionCheckpoints]({ taskId: 'task-1' });`,
    `taskSupportInvokeMethods[IpcChannel.ListTaskMaterialCandidates]({ id: 'task-1' });`,
    `const __inputSnapshotWrongResponse: Promise<z.output<typeof inputSnapshotSchema>> = taskSupportInvokeMethods[IpcChannel.PrepareWorkspaceInputSnapshot]({ workspaceId: 'workspace-1' });`,
    `const __taskSupportContractWrongChannel: typeof IpcChannel.GetTaskContext = taskSupportInvokeContracts[IpcChannel.PrepareWorkspaceInputSnapshot].channel;`,
    `memoryInvokeMethods[IpcChannel.GetMemory]({ memoryId: 'memory-1' });`,
    `const __memoryWrongResponse: Promise<never> = memoryInvokeMethods[IpcChannel.ListMemories]({});`,
    `const __memoryWrongChannel: typeof IpcChannel.GetMemory = memoryInvokeContracts[IpcChannel.CreateMemory].channel;`,
    `memoryInvokeMethods[IpcChannel.ListMemoryJobs]({ taskId: 'task-1' });`,
    `const __memoryJobsWrongResponse: ReturnType<BetterWorkDesktopApi['memories']['get']> = memoryInvokeMethods[IpcChannel.ListMemoryJobs]({ workspaceId: 'workspace-1' });`,
    `const __memoryProjectionWrongChannel: typeof IpcChannel.ListMemories = memoryInvokeContracts[IpcChannel.RebuildMemoryProjection].channel;`,
    `mcpInvokeMethods[IpcChannel.GetMcpConnection]({ connectionId: 'connection-1' });`,
    `const __mcpWrongResponse: ReturnType<BetterWorkDesktopApi['mcp']['cancelOperation']> = mcpInvokeMethods[IpcChannel.GetMcpConnection]({ id: 'connection-1' });`,
    `const __mcpWrongChannel: typeof IpcChannel.GetMcpConnection = mcpInvokeContracts[IpcChannel.SaveMcpConnection].channel;`,
    `dependencyInvokeMethods[IpcChannel.InspectDependencyPlan]({ lockId: 'lock-1' });`,
    `const __dependencyWrongResponse: ReturnType<BetterWorkDesktopApi['dependencies']['cancel']> = dependencyInvokeMethods[IpcChannel.GetDependencyOperation]({ operationId: 'operation-1' });`,
    `const __dependencyWrongChannel: typeof IpcChannel.ListDependencyOptions = dependencyInvokeContracts[IpcChannel.DeleteToolchainSnapshot].channel;`,
    `chromeInvokeMethods[IpcChannel.WindowToggleMaximize]({ backgroundColor: '#ffffff' });`,
    `const __chromeWrongResponse: ReturnType<BetterWorkDesktopApi['chrome']['toggleMaximize']> = chromeInvokeMethods[IpcChannel.UpdateWindowTheme]({ backgroundColor: '#ffffff' });`,
    `const __chromeWrongChannel: typeof IpcChannel.UpdateWindowTheme = chromeInvokeContracts[IpcChannel.WindowToggleMaximize].channel;`,
  ];
  let source = readFileSync(sourcePath, 'utf8') + '\n';
  const cases = [...valid, ...invalid].map((expression, index) => {
    const start = source.length;
    source += `${expression};\n`;
    return { expression, start, end: source.length, rejects: index >= valid.length };
  });

  const options = { ...parsed.options, noEmit: true };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    path.resolve(fileName) === sourcePath
      ? ts.createSourceFile(fileName, source, languageVersion, true)
      : getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram({ rootNames: [sourcePath], options, host });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const format = (diagnostic: ts.Diagnostic): string =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  const unexpected = diagnostics.filter(
    (diagnostic) =>
      diagnostic.file?.fileName !== sourcePath ||
      diagnostic.start === undefined ||
      !cases.some(
        (probe) =>
          probe.rejects &&
          diagnostic.start !== undefined &&
          diagnostic.start >= probe.start &&
          diagnostic.start < probe.end,
      ),
  );
  expect(unexpected.map(format)).toEqual([]);
  for (const probe of cases) {
    const errors = diagnostics.filter(
      (diagnostic) =>
        diagnostic.file?.fileName === sourcePath &&
        diagnostic.start !== undefined &&
        diagnostic.start >= probe.start &&
        diagnostic.start < probe.end,
    );
    expect(errors.length > 0, probe.expression).toBe(probe.rejects);
  }
}, 20_000);

describe('workspace preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(null);
  });

  it('validates and forwards workspace requests and responses through their channels', async () => {
    const workspace = {
      id: 'workspace-1',
      name: 'Research',
      rootPath: '/tmp/research',
      iconId: 'folder',
      accentId: 'moss',
      createdAt: 1,
      updatedAt: 1,
    };
    let directorySelectionCount = 0;
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === IpcChannel.GetDefaultWorkspace) return workspace;
      if (channel === IpcChannel.PickWorkspaceDirectory) {
        directorySelectionCount += 1;
        return directorySelectionCount === 1 ? null : '/tmp/research';
      }
      if (channel === IpcChannel.ListWorkspaces) return [workspace];
      if (channel === IpcChannel.ListWorkspaceTaskGroups) return [];
      return workspace;
    });

    await Promise.all([
      api().workspace.getDefault(),
      api().workspace.pickDirectory(),
      api().workspace.listAll(),
      api().workspace.create({ rootPath: '/tmp/research', name: 'Research' }),
      api().workspace.updateIdentity({ workspaceId: 'workspace-1', name: 'Research Notes' }),
      api().workspace.setHidden({ workspaceId: 'workspace-1', hidden: true }),
      api().workspace.listTaskGroups(),
    ]);
    await expect(api().workspace.pickDirectory()).resolves.toBe('/tmp/research');

    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.GetDefaultWorkspace, {}],
      [IpcChannel.PickWorkspaceDirectory, {}],
      [IpcChannel.ListWorkspaces, {}],
      [IpcChannel.CreateWorkspace, { rootPath: '/tmp/research', name: 'Research' }],
      [IpcChannel.UpdateWorkspaceIdentity, { workspaceId: 'workspace-1', name: 'Research Notes' }],
      [IpcChannel.SetWorkspaceHidden, { workspaceId: 'workspace-1', hidden: true }],
      [IpcChannel.ListWorkspaceTaskGroups, {}],
      [IpcChannel.PickWorkspaceDirectory, {}],
    ]);
  });

  it('rejects invalid workspace requests before IPC and malformed responses after IPC', async () => {
    expect(() => api().workspace.create({ rootPath: '' })).toThrow();
    expect(() => api().workspace.updateIdentity({ workspaceId: '', name: 'Research' })).toThrow();
    expect(() => api().workspace.setHidden({ workspaceId: '', hidden: true })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValue({});
    await expect(api().workspace.getDefault()).rejects.toThrow();
    await expect(api().workspace.pickDirectory()).rejects.toThrow();
    await expect(api().workspace.listAll()).rejects.toThrow();
    await expect(api().workspace.create({ rootPath: '/tmp/research' })).rejects.toThrow();
    await expect(
      api().workspace.updateIdentity({ workspaceId: 'workspace-1', name: 'Research' }),
    ).rejects.toThrow();
    await expect(
      api().workspace.setHidden({ workspaceId: 'workspace-1', hidden: true }),
    ).rejects.toThrow();
    await expect(api().workspace.listTaskGroups()).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(7);
  });

  it('preserves memory brief and reference result envelopes across their channels', async () => {
    const operationId = '11111111-1111-4111-8111-111111111111';
    const contentHash = 'a'.repeat(64);
    const reference = {
      id: 'reference-1',
      workspaceId: 'workspace-1',
      artifactVersionId: 'version-1',
      contentHash,
      status: 'active',
      revision: 1,
      selectedAt: 1,
      updatedAt: 1,
    } as const;
    const brief = {
      workspaceId: 'workspace-1',
      generatedAt: 1,
      goals: { items: [], total: 0, truncated: false },
      constraints: { items: [], total: 0, truncated: false },
      decisions: { items: [], total: 0, truncated: false },
      methods: { items: [], total: 0, truncated: false },
      openIssues: { items: [], total: 0, truncated: false },
      referenceVersions: { items: [], total: 0, truncated: false },
    };
    const receipt = {
      operationId,
      commit: 'committed',
      effect: 'created',
      committedRevisionIds: [],
      projectionState: 'synced',
      currentReference: reference,
    } as const;
    const data = {
      ok: true,
      data: {
        receipt,
        material: {
          kind: 'artifact-version',
          artifactId: 'artifact-1',
          artifactVersionId: 'version-1',
          contentHash,
          originWorkspaceId: 'workspace-1',
        },
      },
      warnings: [],
    } as const;
    const removedReference = {
      ...reference,
      status: 'removed',
      revision: 2,
      updatedAt: 2,
    } as const;
    const removed = {
      ok: true,
      data: { ...receipt, currentReference: removedReference },
      warnings: [],
    } as const;
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === IpcChannel.GetWorkspaceMemoryBrief) {
        return { ok: true, data: brief, warnings: [] };
      }
      if (channel === IpcChannel.ListWorkspaceReferenceVersions) {
        return {
          ok: true,
          data: { items: [{ reference, artifactId: 'artifact-1', status: 'ready' }] },
          warnings: [],
        };
      }
      if (channel === IpcChannel.SetWorkspaceReferenceVersion) return data;
      if (channel === IpcChannel.RemoveWorkspaceReferenceVersion) return removed;
      return null;
    });

    await expect(
      api().workspace.memoryBrief({ workspaceId: 'workspace-1', expertId: 'expert-1' }),
    ).resolves.toMatchObject({ ok: true, data: { workspaceId: 'workspace-1' }, warnings: [] });
    await expect(
      api().workspace.listReferenceVersions({ workspaceId: 'workspace-1' }),
    ).resolves.toMatchObject({ ok: true, data: { items: [{ artifactId: 'artifact-1' }] } });
    await expect(
      api().workspace.setReferenceVersion({
        operationId,
        workspaceId: 'workspace-1',
        artifactVersionId: 'version-1',
        expectedRevision: 0,
      }),
    ).resolves.toMatchObject({ ok: true, data: { receipt: { currentReference: reference } } });
    await expect(
      api().workspace.removeReferenceVersion({
        operationId,
        id: 'reference-1',
        expectedRevision: 1,
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: { currentReference: { id: 'reference-1', status: 'removed', revision: 2 } },
    });

    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.GetWorkspaceMemoryBrief, { workspaceId: 'workspace-1', expertId: 'expert-1' }],
      [IpcChannel.ListWorkspaceReferenceVersions, { workspaceId: 'workspace-1' }],
      [
        IpcChannel.SetWorkspaceReferenceVersion,
        {
          operationId,
          workspaceId: 'workspace-1',
          artifactVersionId: 'version-1',
          expectedRevision: 0,
        },
      ],
      [
        IpcChannel.RemoveWorkspaceReferenceVersion,
        { operationId, id: 'reference-1', expectedRevision: 1 },
      ],
    ]);
  });

  it('rejects invalid memory brief and reference requests before IPC', () => {
    expect(() => api().workspace.memoryBrief({ workspaceId: '' })).toThrow();
    expect(() => api().workspace.listReferenceVersions({ workspaceId: '' })).toThrow();
    expect(() =>
      api().workspace.setReferenceVersion({
        operationId: 'invalid',
        workspaceId: 'workspace-1',
        artifactVersionId: 'version-1',
        expectedRevision: 0,
      }),
    ).toThrow();
    expect(() =>
      api().workspace.removeReferenceVersion({
        operationId: '11111111-1111-4111-8111-111111111111',
        id: '',
        expectedRevision: 1,
      }),
    ).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('preserves memory error envelopes and rejects malformed result data', async () => {
    const error = {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Workspace not found', retryable: false },
    };
    mocks.invoke.mockResolvedValue(error);
    await expect(api().workspace.memoryBrief({ workspaceId: 'workspace-1' })).resolves.toEqual(
      error,
    );

    mocks.invoke.mockResolvedValue({
      ok: true,
      data: { workspaceId: 'workspace-1' },
      warnings: [],
    });
    await expect(api().workspace.memoryBrief({ workspaceId: 'workspace-1' })).rejects.toThrow();
  });
});

describe('task preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue([]);
  });

  it('validates and forwards Task requests and responses through their channels', async () => {
    const task = {
      id: 'task-1',
      workspaceId: 'workspace-1',
      title: 'Research',
      goal: 'Summarize the source material.',
      createdAt: 1,
      updatedAt: 1,
    };
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === IpcChannel.CreateTask) return { task, sessionId: 'session-1' };
      return [{ ...task, sessionId: 'session-1' }];
    });

    await Promise.all([
      api().tasks.create({
        workspaceId: 'workspace-1',
        title: 'Research',
        goal: 'Summarize the source material.',
      }),
      api().tasks.list(),
      api().tasks.list({ workspaceId: 'workspace-1' }),
    ]);

    expect(mocks.invoke.mock.calls).toEqual([
      [
        IpcChannel.CreateTask,
        {
          workspaceId: 'workspace-1',
          title: 'Research',
          goal: 'Summarize the source material.',
        },
      ],
      [IpcChannel.ListTasks, undefined],
      [IpcChannel.ListTasks, { workspaceId: 'workspace-1' }],
    ]);
  });

  it('rejects invalid Task requests before IPC and malformed responses after IPC', async () => {
    expect(() =>
      api().tasks.create({
        workspaceId: '',
        title: 'Research',
        goal: 'Summarize the source material.',
      }),
    ).toThrow();
    expect(() => api().tasks.list({ workspaceId: '' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValue(null);
    await expect(
      api().tasks.create({
        workspaceId: 'workspace-1',
        title: 'Research',
        goal: 'Summarize the source material.',
      }),
    ).rejects.toThrow();
    await expect(api().tasks.list()).rejects.toThrow();
    await expect(api().tasks.list({ workspaceId: 'workspace-1' })).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
  });
});

describe('evidence preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue([]);
  });

  it('validates and forwards Evidence requests and responses through its channel', async () => {
    const evidence = {
      id: 'evidence-1',
      taskId: 'task-1',
      runId: 'run-1',
      sourceType: 'local-file' as const,
      sourceUri: 'file:///tmp/source.md',
      title: 'Source',
      locator: '',
      excerpt: '',
      contentHash: 'hash-1',
      capturedAt: 1,
    };
    const knowledgeEvidence = {
      ...evidence,
      id: 'evidence-2',
      knowledgeSource: {
        reference: {
          kind: 'knowledge-revision' as const,
          knowledgeDocumentId: 'document-1',
          knowledgeRevisionId: 'revision-1',
          contentHash: 'content-hash',
          sourcePath: '/tmp/knowledge.md',
        },
        textHash: 'text-hash',
        span: { sectionOrdinal: 0, start: 0, end: 12 },
        operation: 'search' as const,
      },
    };
    mocks.invoke.mockResolvedValue([
      { ...evidence, knowledgeSource: undefined },
      knowledgeEvidence,
    ]);

    const result = await api().evidence.list({ taskId: 'task-1' });
    expect(result).toHaveLength(2);
    expect(Object.hasOwn(result[0] ?? {}, 'knowledgeSource')).toBe(false);
    expect(result[1]?.knowledgeSource?.reference.knowledgeRevisionId).toBe('revision-1');
    expect(mocks.invoke).toHaveBeenCalledWith(IpcChannel.ListEvidence, { taskId: 'task-1' });
  });

  it('rejects invalid Evidence requests before IPC and malformed responses after IPC', async () => {
    expect(() => api().evidence.list({ taskId: '' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValue([{}]);
    await expect(api().evidence.list({ taskId: 'task-1' })).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledWith(IpcChannel.ListEvidence, { taskId: 'task-1' });
  });
});

describe('artifact query preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(null);
  });

  it('validates and forwards Artifact reads through their typed channels', async () => {
    const artifact = {
      id: 'artifact-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      type: 'markdown' as const,
      sourceDeclarationKind: undefined,
      title: 'Research notes',
      currentVersionId: 'version-1',
      versionNumber: 1,
      origin: 'assistant-run' as const,
      sourceRunId: undefined,
      createdAt: 1,
      updatedAt: 2,
    };
    const evidence = {
      id: 'evidence-1',
      taskId: 'task-1',
      runId: 'run-1',
      sourceType: 'local-file' as const,
      sourceUri: 'file:///tmp/source.md',
      title: 'Source',
      locator: '',
      excerpt: '',
      contentHash: 'evidence-hash',
      capturedAt: 1,
      knowledgeSource: undefined,
    };
    const artifactDetail = {
      ...artifact,
      content: '# Notes',
      contentHash: 'content-hash',
      evidence: [evidence],
    };
    const version = {
      id: 'version-1',
      artifactId: 'artifact-1',
      type: 'markdown' as const,
      versionNumber: 1,
      origin: 'assistant-run' as const,
      sourceRunId: undefined,
      createdAt: 1,
      sourceDeclarationKind: undefined,
    };
    const versionDetail = {
      ...version,
      content: '# Notes',
      contentHash: 'content-hash',
      evidence: [evidence],
    };
    const fileDetail = {
      id: 'artifact-2',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      type: 'presentation' as const,
      sourceDeclarationKind: undefined,
      title: 'Research slides',
      currentVersionId: 'version-2',
      versionNumber: 1,
      origin: 'assistant-run' as const,
      sourceRunId: undefined,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      fileSize: 12,
      createdAt: 1,
      updatedAt: 2,
      fileHash: 'file-hash',
      fileKey: 'file-key',
      description: undefined,
      validation: {
        structure: 'passed' as const,
        visual: 'pending' as const,
        manualEdit: 'pending' as const,
      },
      evidence: [evidence],
    };
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === IpcChannel.ListArtifacts) return [artifact];
      if (channel === IpcChannel.GetArtifact) return artifactDetail;
      if (channel === IpcChannel.ListArtifactVersions) return [version];
      if (channel === IpcChannel.GetArtifactVersionExecutor) {
        return { kind: 'general', sourceRunId: 'run-1' };
      }
      if (channel === IpcChannel.GetArtifactVersion) return versionDetail;
      if (channel === IpcChannel.GetFileArtifact) return fileDetail;
      return null;
    });

    const artifacts = api().artifacts;
    const summaries = await artifacts.list();
    expect(Object.hasOwn(summaries[0] ?? {}, 'sourceDeclarationKind')).toBe(false);
    expect(Object.hasOwn(summaries[0] ?? {}, 'sourceRunId')).toBe(false);
    await artifacts.list({ taskId: 'task-1' });
    const artifactRead = await artifacts.get({ id: 'artifact-1' });
    expect(artifactRead?.evidence[0]).toBeDefined();
    expect(Object.hasOwn(artifactRead?.evidence[0] ?? {}, 'knowledgeSource')).toBe(false);
    const versions = await artifacts.listVersions({ artifactId: 'artifact-1' });
    expect(Object.hasOwn(versions[0] ?? {}, 'sourceDeclarationKind')).toBe(false);
    expect(Object.hasOwn(versions[0] ?? {}, 'sourceRunId')).toBe(false);
    await artifacts.getVersionExecutor({
      artifactId: 'artifact-1',
      artifactVersionId: 'version-1',
    });
    const versionRead = await artifacts.getVersion({ id: 'version-1' });
    expect(versionRead?.evidence[0]).toBeDefined();
    expect(Object.hasOwn(versionRead?.evidence[0] ?? {}, 'knowledgeSource')).toBe(false);
    const fileRead = await artifacts.getFileDetail({ artifactId: 'artifact-2' });
    expect(Object.hasOwn(fileRead ?? {}, 'description')).toBe(false);
    expect(Object.hasOwn(fileRead?.evidence[0] ?? {}, 'knowledgeSource')).toBe(false);

    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.ListArtifacts, undefined],
      [IpcChannel.ListArtifacts, { taskId: 'task-1' }],
      [IpcChannel.GetArtifact, { id: 'artifact-1' }],
      [IpcChannel.ListArtifactVersions, { artifactId: 'artifact-1' }],
      [
        IpcChannel.GetArtifactVersionExecutor,
        { artifactId: 'artifact-1', artifactVersionId: 'version-1' },
      ],
      [IpcChannel.GetArtifactVersion, { id: 'version-1' }],
      [IpcChannel.GetFileArtifact, { artifactId: 'artifact-2' }],
    ]);
  });

  it('rejects malformed Artifact requests before IPC and malformed responses after IPC', async () => {
    const artifacts = api().artifacts;
    expect(() => artifacts.list({ taskId: '' })).toThrow();
    expect(() => artifacts.get({ id: '' })).toThrow();
    expect(() => artifacts.listVersions({ artifactId: '' })).toThrow();
    expect(() => artifacts.getVersionExecutor({ artifactId: '', artifactVersionId: '' })).toThrow();
    expect(() => artifacts.getVersion({ id: '' })).toThrow();
    expect(() => artifacts.getFileDetail({ artifactId: '' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    await Promise.all([
      expect(artifacts.list()).rejects.toThrow(),
      expect(artifacts.get({ id: 'artifact-1' })).rejects.toThrow(),
      expect(artifacts.listVersions({ artifactId: 'artifact-1' })).rejects.toThrow(),
      expect(
        artifacts.getVersionExecutor({ artifactId: 'artifact-1', artifactVersionId: 'version-1' }),
      ).rejects.toThrow(),
      expect(artifacts.getVersion({ id: 'version-1' })).rejects.toThrow(),
      expect(artifacts.getFileDetail({ artifactId: 'artifact-2' })).rejects.toThrow(),
    ]);
    expect(mocks.invoke).toHaveBeenCalledTimes(6);
  });
});

describe('artifact action preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(null);
  });

  it('validates and forwards Artifact mutations and file operations', async () => {
    const saveInput = {
      taskId: 'task-1',
      origin: 'assistant-run' as const,
      runId: 'run-1',
      title: 'Research notes',
      content: '# Notes',
    };
    const registerInput = {
      runId: 'run-1',
      executionId: 'execution-1',
      outputId: 'output-1',
      title: 'Research slides',
    };
    const artifactSummary = {
      id: 'artifact-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      type: 'markdown' as const,
      sourceDeclarationKind: undefined,
      title: 'Research notes',
      currentVersionId: 'version-1',
      versionNumber: 1,
      origin: 'assistant-run' as const,
      sourceRunId: undefined,
      createdAt: 1,
      updatedAt: 2,
    };
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === IpcChannel.SaveMarkdownArtifact) return artifactSummary;
      if (channel === IpcChannel.ExportMarkdownArtifact) {
        return { cancelled: true, filePath: undefined };
      }
      if (channel === IpcChannel.RegisterFileArtifact) {
        return {
          artifactId: 'artifact-2',
          versionId: 'version-2',
          versionNumber: 1,
          fileKey: 'file-key',
          fileHash: 'file-hash',
          fileSize: 12,
          validation: { structure: 'passed', visual: 'pending', manualEdit: 'pending' },
        };
      }
      if (channel === IpcChannel.ExportFileArtifact) {
        return { cancelled: false, filePath: '/tmp/research-slides.pptx' };
      }
      if (channel === IpcChannel.OpenFileArtifact) {
        return { opened: true, error: undefined };
      }
      if (channel === IpcChannel.RevealFileArtifact) {
        return { revealed: true, error: undefined };
      }
      if (channel === IpcChannel.GetArtifactThumbnails) {
        return {
          thumbnails: [{ slideIndex: 0, dataUrl: 'data:image/png;base64,cHJldmlldw==' }],
        };
      }
      return null;
    });

    const artifacts = api().artifacts;
    const saved = await artifacts.saveMarkdown(saveInput);
    expect(Object.hasOwn(saved, 'sourceDeclarationKind')).toBe(false);
    expect(Object.hasOwn(saved, 'sourceRunId')).toBe(false);
    const markdownExport = await artifacts.exportMarkdown({
      artifactId: 'artifact-1',
      versionId: 'version-1',
    });
    expect(markdownExport).toEqual({ cancelled: true });
    expect(Object.hasOwn(markdownExport, 'filePath')).toBe(false);
    await expect(artifacts.registerFile(registerInput)).resolves.toEqual({
      artifactId: 'artifact-2',
      versionId: 'version-2',
      versionNumber: 1,
      fileKey: 'file-key',
      fileHash: 'file-hash',
      fileSize: 12,
      validation: { structure: 'passed', visual: 'pending', manualEdit: 'pending' },
    });
    await expect(
      artifacts.exportFile({ artifactId: 'artifact-2', versionId: 'version-2' }),
    ).resolves.toEqual({ cancelled: false, filePath: '/tmp/research-slides.pptx' });
    const opened = await artifacts.openFile({ artifactId: 'artifact-2' });
    expect(opened).toEqual({ opened: true });
    expect(Object.hasOwn(opened, 'error')).toBe(false);
    await expect(artifacts.revealFile({ artifactId: 'artifact-2' })).resolves.toMatchObject({
      revealed: true,
    });
    await expect(
      artifacts.getThumbnails({ artifactId: 'artifact-2', versionId: 'version-2' }),
    ).resolves.toEqual({
      thumbnails: [{ slideIndex: 0, dataUrl: 'data:image/png;base64,cHJldmlldw==' }],
    });

    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.SaveMarkdownArtifact, saveInput],
      [IpcChannel.ExportMarkdownArtifact, { artifactId: 'artifact-1', versionId: 'version-1' }],
      [IpcChannel.RegisterFileArtifact, registerInput],
      [IpcChannel.ExportFileArtifact, { artifactId: 'artifact-2', versionId: 'version-2' }],
      [IpcChannel.OpenFileArtifact, { artifactId: 'artifact-2' }],
      [IpcChannel.RevealFileArtifact, { artifactId: 'artifact-2' }],
      [IpcChannel.GetArtifactThumbnails, { artifactId: 'artifact-2', versionId: 'version-2' }],
    ]);
  });

  it('rejects malformed Artifact action requests before IPC and responses after IPC', async () => {
    const artifacts = api().artifacts;
    expect(() =>
      artifacts.saveMarkdown({
        taskId: 'task-1',
        origin: 'user-edit',
        runId: 'run-1',
        title: 'Notes',
        content: '# Notes',
      }),
    ).toThrow();
    expect(() => artifacts.exportMarkdown({ artifactId: '' })).toThrow();
    expect(() =>
      artifacts.registerFile({
        runId: 'run-1',
        executionId: 'execution-1',
        outputId: 'output-1',
        title: 'Slides',
        validation: { structure: 'failed', visual: 'pending', manualEdit: 'pending' },
      }),
    ).toThrow();
    expect(() => artifacts.exportFile({ artifactId: '' })).toThrow();
    expect(() => artifacts.openFile({ artifactId: '' })).toThrow();
    expect(() => artifacts.revealFile({ artifactId: '' })).toThrow();
    expect(() => artifacts.getThumbnails({ artifactId: '' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ cancelled: 'yes' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ cancelled: true, filePath: '' })
      .mockResolvedValueOnce({ opened: 'yes' })
      .mockResolvedValueOnce({ revealed: 'yes' })
      .mockResolvedValueOnce({ thumbnails: [{}] });
    await Promise.all([
      expect(
        artifacts.saveMarkdown({
          taskId: 'task-1',
          origin: 'assistant-run',
          runId: 'run-1',
          title: 'Notes',
          content: '# Notes',
        }),
      ).rejects.toThrow(),
      expect(artifacts.exportMarkdown({ artifactId: 'artifact-1' })).rejects.toThrow(),
      expect(
        artifacts.registerFile({
          runId: 'run-1',
          executionId: 'execution-1',
          outputId: 'output-1',
          title: 'Slides',
        }),
      ).rejects.toThrow(),
      expect(artifacts.exportFile({ artifactId: 'artifact-2' })).rejects.toThrow(),
      expect(artifacts.openFile({ artifactId: 'artifact-2' })).rejects.toThrow(),
      expect(artifacts.revealFile({ artifactId: 'artifact-2' })).rejects.toThrow(),
      expect(artifacts.getThumbnails({ artifactId: 'artifact-2' })).rejects.toThrow(),
    ]);
    expect(mocks.invoke).toHaveBeenCalledTimes(7);
  });
});

describe('knowledge search and source preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.invoke.mockResolvedValue(null);
  });

  it('validates and forwards Knowledge search, source open, and remove calls', async () => {
    const searchResponse = {
      results: [
        {
          chunkId: 'chunk-1',
          reference: {
            kind: 'knowledge-revision' as const,
            knowledgeDocumentId: 'document-1',
            knowledgeRevisionId: 'revision-1',
            contentHash: 'content-hash',
            sourcePath: '/tmp/source.md',
          },
          textHash: 'text-hash',
          title: 'Source',
          format: 'markdown' as const,
          locator: '全文',
          span: { sectionOrdinal: 0, start: 0, end: 6 },
          excerpt: 'result',
          excerptHash: 'excerpt-hash',
          matchedBy: 'keyword' as const,
        },
      ],
      requestedMode: 'keyword' as const,
      effectiveMode: 'keyword' as const,
      coverage: { eligibleChunks: 1, indexedChunks: 1 },
      durationMs: 2,
    };
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === IpcChannel.SearchKnowledge) return searchResponse;
      if (channel === IpcChannel.OpenKnowledgeSource) {
        return { opened: true, error: undefined };
      }
      if (channel === IpcChannel.RemoveKnowledgeDocument) return { removed: true };
      return null;
    });

    const knowledge = api().knowledge;
    await expect(knowledge.search({ query: ' revenue ', mode: 'keyword' })).resolves.toEqual(
      searchResponse,
    );
    const opened = await knowledge.openSource({ sourcePath: '/tmp/source.md' });
    expect(opened).toEqual({ opened: true });
    expect(Object.hasOwn(opened, 'error')).toBe(false);
    await expect(knowledge.remove({ id: 'document-1' })).resolves.toEqual({ removed: true });

    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.SearchKnowledge, { query: 'revenue', mode: 'keyword' }],
      [IpcChannel.OpenKnowledgeSource, { sourcePath: '/tmp/source.md' }],
      [IpcChannel.RemoveKnowledgeDocument, { id: 'document-1' }],
    ]);
  });

  it('rejects malformed Knowledge requests before IPC and malformed responses after IPC', async () => {
    const knowledge = api().knowledge;
    expect(() => knowledge.search({ query: '   ' })).toThrow();
    expect(() => knowledge.openSource({ sourcePath: '' })).toThrow();
    expect(() => knowledge.remove({ id: '' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke
      .mockResolvedValueOnce({ results: [{}] })
      .mockResolvedValueOnce({ opened: true, error: 1 })
      .mockResolvedValueOnce({ removed: 'yes' });
    await Promise.all([
      expect(knowledge.search({ query: 'revenue' })).rejects.toThrow(),
      expect(knowledge.openSource({ sourcePath: '/tmp/source.md' })).rejects.toThrow(),
      expect(knowledge.remove({ id: 'document-1' })).rejects.toThrow(),
    ]);
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
  });

  it('validates Knowledge job events and removes the typed listener', () => {
    const listener = vi.fn();
    const unsubscribe = api().knowledge.onJobEvent(listener);
    const handler = mocks.listeners.get(IpcChannel.KnowledgeJobEvent);

    const event = {
      id: 'job-1',
      kind: 'rebuild-keyword',
      status: 'queued',
      attempt: 1,
      sequence: 1,
      totalCount: 0,
      completedCount: 0,
      failedCount: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    handler?.({}, event);
    expect(listener).toHaveBeenCalledWith(event);
    expect(() => handler?.({}, { ...event, status: 'unknown' })).toThrow();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(mocks.off).toHaveBeenCalledWith(IpcChannel.KnowledgeJobEvent, handler);
  });
});

describe('model preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(null);
  });

  it('validates and forwards Model requests and responses through their channels', async () => {
    const profile = {
      id: 'model-1',
      name: 'Primary',
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'model-a',
      role: 'language' as const,
      apiKeyConfigured: true,
      enabled: true,
      priority: 0,
      connectionStatus: 'connected' as const,
      maxContextTokens: 8192,
      maxOutputTokens: 1024,
      temperature: 0.7,
      createdAt: 1,
      updatedAt: 1,
    };
    const saveInput = {
      name: 'Primary',
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'model-a',
      role: 'language' as const,
      apiKey: '',
      maxContextTokens: 8192,
      maxOutputTokens: 1024,
      temperature: 0.7,
      enabled: true,
      priority: 0,
    };
    const testInput = {
      baseUrl: 'https://api.example.com/v1',
      model: 'model-a',
      role: 'language' as const,
      apiKey: '',
    };
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === IpcChannel.ListModels) {
        return [
          { ...profile, lastTestedAt: undefined },
          { ...profile, id: 'model-2', lastTestedAt: 2 },
        ];
      }
      if (channel === IpcChannel.SaveModel) return { id: 'model-1' };
      if (channel === IpcChannel.DeleteModel) return { deleted: true };
      if (channel === IpcChannel.SetDefaultModel || channel === IpcChannel.SetModelEnabled) {
        return { updated: true };
      }
      return { ok: true, message: 'connected' };
    });

    const profiles = await api().models.list();
    await Promise.all([
      api().models.save(saveInput),
      api().models.delete({ id: 'model-1' }),
      api().models.setDefault({ id: 'model-1' }),
      api().models.setEnabled({ id: 'model-1', enabled: false }),
      api().models.test(testInput),
    ]);

    expect(profiles).toHaveLength(2);
    expect(Object.hasOwn(profiles[0] ?? {}, 'lastTestedAt')).toBe(false);
    expect(profiles[1]?.lastTestedAt).toBe(2);
    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.ListModels, {}],
      [IpcChannel.SaveModel, saveInput],
      [IpcChannel.DeleteModel, { id: 'model-1' }],
      [IpcChannel.SetDefaultModel, { id: 'model-1' }],
      [IpcChannel.SetModelEnabled, { id: 'model-1', enabled: false }],
      [IpcChannel.TestModel, testInput],
    ]);
  });

  it('rejects invalid Model requests before IPC and malformed responses after IPC', async () => {
    const saveInput = {
      name: 'Primary',
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'model-a',
      role: 'language' as const,
      apiKey: '',
      maxContextTokens: 8192,
      maxOutputTokens: 1024,
      temperature: 0.7,
      enabled: true,
      priority: 0,
    };
    const testInput = {
      baseUrl: 'https://api.example.com/v1',
      model: 'model-a',
      role: 'language' as const,
      apiKey: '',
    };

    expect(() => api().models.save({ ...saveInput, name: '' })).toThrow();
    expect(() => api().models.delete({ id: '' })).toThrow();
    expect(() => api().models.setDefault({ id: '' })).toThrow();
    expect(() => api().models.setEnabled({ id: '', enabled: false })).toThrow();
    expect(() => api().models.test({ ...testInput, baseUrl: '' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValue(null);
    await expect(api().models.list()).rejects.toThrow();
    await expect(api().models.save(saveInput)).rejects.toThrow();
    await expect(api().models.delete({ id: 'model-1' })).rejects.toThrow();
    await expect(api().models.setDefault({ id: 'model-1' })).rejects.toThrow();
    await expect(api().models.setEnabled({ id: 'model-1', enabled: false })).rejects.toThrow();
    await expect(api().models.test(testInput)).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(6);
  });
});

describe('search engine preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(null);
  });

  it('validates and forwards Search Engine requests and responses through their channels', async () => {
    const engine = {
      provider: 'baidu_qianfan' as const,
      apiKeyConfigured: true,
      enabled: true,
      webTopK: 5,
      connectionStatus: 'connected' as const,
      updatedAt: 1,
    };
    const saveInput = {
      provider: 'baidu_qianfan' as const,
      apiKey: 'api-key',
      webTopK: 5,
      enabled: true,
    };
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === IpcChannel.ListSearchEngines) {
        return [
          { ...engine, lastTestedAt: undefined },
          { ...engine, lastTestedAt: 2 },
        ];
      }
      if (channel === IpcChannel.SaveSearchEngine) return { provider: 'baidu_qianfan' };
      return { ok: true, message: 'connected' };
    });

    const engines = await api().searchEngines.list();
    await Promise.all([api().searchEngines.save(saveInput), api().searchEngines.test(saveInput)]);

    expect(engines).toHaveLength(2);
    expect(Object.hasOwn(engines[0] ?? {}, 'lastTestedAt')).toBe(false);
    expect(engines[1]?.lastTestedAt).toBe(2);
    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.ListSearchEngines, {}],
      [IpcChannel.SaveSearchEngine, saveInput],
      [IpcChannel.TestSearchEngine, saveInput],
    ]);
  });

  it('rejects invalid Search Engine requests before IPC and malformed responses after IPC', async () => {
    const validInput = {
      provider: 'baidu_qianfan' as const,
      apiKey: 'api-key',
      webTopK: 5,
      enabled: true,
    };
    expect(() => api().searchEngines.save({ ...validInput, webTopK: 21 })).toThrow();
    expect(() => api().searchEngines.test({ ...validInput, apiKey: 'x'.repeat(2001) })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValue(null);
    await expect(api().searchEngines.list()).rejects.toThrow();
    await expect(api().searchEngines.save(validInput)).rejects.toThrow();
    await expect(api().searchEngines.test(validInput)).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
  });
});

describe('notification maintenance preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(null);
  });

  it('validates and forwards list/read/clear requests and responses', async () => {
    const notification = {
      id: 'notification-1',
      level: 'info' as const,
      kind: 'run' as const,
      title: 'Run finished',
      target: { kind: 'task' as const, taskId: 'task-1' },
      read: false,
      createdAt: 1,
    };
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === IpcChannel.ListNotifications) return [notification];
      if (channel === IpcChannel.ClearNotifications) return { cleared: true };
      if (channel === IpcChannel.DeleteNotification) return { deleted: true };
      return { unreadCount: 2 };
    });

    await expect(api().notifications.list()).resolves.toEqual([notification]);
    await Promise.all([
      api().notifications.markRead({ id: 'notification-1' }),
      api().notifications.markAllRead(),
      api().notifications.delete({ id: 'notification-1' }),
      api().notifications.clear(),
    ]);

    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.ListNotifications, {}],
      [IpcChannel.MarkNotificationRead, { id: 'notification-1' }],
      [IpcChannel.MarkAllNotificationsRead, {}],
      [IpcChannel.DeleteNotification, { id: 'notification-1' }],
      [IpcChannel.ClearNotifications, {}],
    ]);
  });

  it('rejects invalid notification requests before IPC and malformed responses after IPC', async () => {
    expect(() => api().notifications.markRead({ id: '' })).toThrow();
    expect(() => api().notifications.delete({ id: '' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValue(null);
    await expect(api().notifications.list()).rejects.toThrow();
    mocks.invoke.mockResolvedValueOnce({
      id: '',
      level: 'info',
      kind: 'run',
      title: 'Malformed notification',
      read: false,
      createdAt: 1,
    });
    await expect(api().notifications.get({ id: 'notification-1' })).rejects.toThrow();
    await expect(api().notifications.rendererReady()).rejects.toThrow();
    await expect(api().notifications.markRead({ id: 'notification-1' })).rejects.toThrow();
    await expect(api().notifications.markAllRead()).rejects.toThrow();
    await expect(api().notifications.delete({ id: 'notification-1' })).rejects.toThrow();
    await expect(api().notifications.clear()).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(7);
  });

  it('validates notification events and removes typed listeners', () => {
    const changeListener = vi.fn();
    const activateListener = vi.fn();
    const unsubscribeChange = api().notifications.onChange(changeListener);
    const unsubscribeActivate = api().notifications.onActivate(activateListener);
    const changeHandler = mocks.listeners.get(IpcChannel.NotificationChangeEvent);
    const activateHandler = mocks.listeners.get(IpcChannel.NotificationActivated);

    changeHandler?.({}, { type: 'read-all', unreadCount: 0 });
    activateHandler?.({}, { id: 'notification-1' });
    expect(changeListener).toHaveBeenCalledWith({ type: 'read-all', unreadCount: 0 });
    expect(activateListener).toHaveBeenCalledWith({ id: 'notification-1' });
    expect(() => changeHandler?.({}, { type: 'unknown' })).toThrow();
    expect(() => activateHandler?.({}, { id: '' })).toThrow();
    expect(changeListener).toHaveBeenCalledTimes(1);
    expect(activateListener).toHaveBeenCalledTimes(1);

    unsubscribeChange();
    unsubscribeActivate();
    expect(mocks.off).toHaveBeenCalledWith(IpcChannel.NotificationChangeEvent, changeHandler);
    expect(mocks.off).toHaveBeenCalledWith(IpcChannel.NotificationActivated, activateHandler);
  });
});

describe('historical task and notification preload APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === IpcChannel.NotificationRendererReady) return { ready: true };
      return null;
    });
  });

  it('validates stable IDs and the Renderer ready acknowledgment', async () => {
    await Promise.all([
      api().tasks.get({ id: 'historical-task' }),
      api().notifications.get({ id: 'notification-1' }),
      api().notifications.rendererReady(),
    ]);
    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.GetTask, { id: 'historical-task' }],
      [IpcChannel.GetNotification, { id: 'notification-1' }],
      [IpcChannel.NotificationRendererReady, {}],
    ]);
    expect(() => api().tasks.get({ id: '' })).toThrow();
    expect(() => api().notifications.get({ id: '' })).toThrow();
  });
});

describe('task continuity preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === IpcChannel.GetTaskContinuityBrief) return null;
      return { kind: 'conflict', currentRevision: 2 };
    });
  });

  it('validates and forwards reads and CAS saves through their typed channels', async () => {
    await expect(api().taskContinuity.getBrief({ taskId: 'task-1' })).resolves.toBeNull();
    await expect(
      api().taskContinuity.saveBrief({
        taskId: 'task-1',
        expectedRevision: 1,
        objective: '分析季度结果',
        activeRequirements: [],
        progress: null,
      }),
    ).resolves.toEqual({ kind: 'conflict', currentRevision: 2 });

    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.GetTaskContinuityBrief, { taskId: 'task-1' }],
      [
        IpcChannel.SaveTaskContinuityBrief,
        {
          taskId: 'task-1',
          expectedRevision: 1,
          objective: '分析季度结果',
          activeRequirements: [],
          progress: null,
        },
      ],
    ]);

    mocks.invoke.mockResolvedValueOnce({
      kind: 'error',
      message: '保存本任务简报失败，草稿仍保留；请重试。',
    });
    await expect(
      api().taskContinuity.saveBrief({
        taskId: 'task-1',
        expectedRevision: 1,
        objective: '分析季度结果',
        activeRequirements: [],
        progress: null,
      }),
    ).resolves.toEqual({
      kind: 'error',
      message: '保存本任务简报失败，草稿仍保留；请重试。',
    });
  });

  it('rejects malformed requests before IPC and malformed mutation results after IPC', async () => {
    expect(() =>
      api().taskContinuity.saveBrief({
        taskId: 'task-1',
        expectedRevision: 0,
        objective: '分析季度结果',
        activeRequirements: [],
        progress: null,
      }),
    ).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValueOnce({ kind: 'saved', revision: {} });
    await expect(
      api().taskContinuity.saveBrief({
        taskId: 'task-1',
        expectedRevision: 1,
        objective: '分析季度结果',
        activeRequirements: [],
        progress: null,
      }),
    ).rejects.toThrow();
  });
});

describe('chrome preload API', () => {
  it('validates and routes theme and maximize calls through their typed channels', async () => {
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(async (channel) =>
      channel === IpcChannel.WindowToggleMaximize ? { maximized: true } : undefined,
    );
    const chrome = api().chrome;

    expect(() => chrome.updateTheme({ backgroundColor: 'white' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
    await expect(chrome.updateTheme({ backgroundColor: '#ffffff' })).resolves.toBeUndefined();
    await expect(chrome.toggleMaximize()).resolves.toEqual({ maximized: true });
    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.UpdateWindowTheme, { backgroundColor: '#ffffff' }],
      [IpcChannel.WindowToggleMaximize, {}],
    ]);
    mocks.invoke.mockReset();
  });
});

describe('Dependencies preload API', () => {
  it('routes each dependency API through its validated channel and keeps request defaults', async () => {
    const platform = { os: 'darwin', arch: 'arm64', abi: 'cp312' } as const;
    const base = { kind: 'local', path: '/usr/bin/python3', version: '3.12.1' } as const;
    const lock: Awaited<
      ReturnType<BetterWorkDesktopApi['dependencies']['verifyEnvironment']>
    >['lock'] = {
      lockVersion: 1,
      platform,
      pythonRequirement: '3.12',
      packages: [],
      importProbes: [],
    };
    const plan: Awaited<ReturnType<BetterWorkDesktopApi['dependencies']['inspectPlan']>> = {
      environmentKey: 'environment-key-1',
      base,
      platform,
      lockHash: 'lock-hash-1',
      lock,
      missingWheels: [],
      requiresDownload: false,
      environment: null,
    };
    const environment: Awaited<
      ReturnType<BetterWorkDesktopApi['dependencies']['verifyEnvironment']>
    > = {
      id: 'environment-1',
      environmentKey: 'environment-key-1',
      base,
      platform,
      lockHash: 'lock-hash-1',
      lock,
      pathKey: 'environments/environment-1',
      status: 'ready',
      createdAt: 1,
      updatedAt: 1,
    };
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(async (channel) => {
      switch (channel) {
        case IpcChannel.ListDependencyOptions:
          return { distributions: [], lockIds: [], snapshots: [], environments: [] };
        case IpcChannel.InspectDependencyPlan:
          return plan;
        case IpcChannel.VerifyDependencyEnvironment:
          return environment;
        case IpcChannel.PrepareDependencyEnvironment:
          return {
            operationId: 'operation-1',
            environmentId: environment.id,
            environmentKey: environment.environmentKey,
            reused: false,
          };
        case IpcChannel.CancelDependencyPreparation:
          return { applied: true, status: 'cancelled' };
        case IpcChannel.GetDependencyOperation:
          return null;
        case IpcChannel.ChoosePythonInterpreter:
          return { cancelled: true };
        case IpcChannel.RegisterToolchainSnapshot:
          return { cancelled: true, snapshot: null, reused: false };
        default:
          return { status: 'not-found' };
      }
    });

    const dependencies = api().dependencies;
    const planRequest = { base: { kind: 'local' as const, path: base.path }, lockId: 'lock-1' };
    expect(() => dependencies.verifyEnvironment({ environmentId: '' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    await dependencies.listOptions();
    await dependencies.inspectPlan(planRequest);
    await dependencies.verifyEnvironment({ environmentId: environment.id });
    await dependencies.prepare({ ...planRequest, kind: 'prepare' });
    await dependencies.cancel({ operationId: 'operation-1' });
    await dependencies.getOperation({ operationId: 'operation-1' });
    await dependencies.chooseInterpreter();
    await dependencies.registerToolchain({});
    await dependencies.deleteToolchainSnapshot({ snapshotId: 'snapshot-1' });

    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.ListDependencyOptions, {}],
      [IpcChannel.InspectDependencyPlan, planRequest],
      [IpcChannel.VerifyDependencyEnvironment, { environmentId: environment.id }],
      [IpcChannel.PrepareDependencyEnvironment, { ...planRequest, kind: 'prepare' }],
      [IpcChannel.CancelDependencyPreparation, { operationId: 'operation-1' }],
      [IpcChannel.GetDependencyOperation, { operationId: 'operation-1' }],
      [IpcChannel.ChoosePythonInterpreter, {}],
      [IpcChannel.RegisterToolchainSnapshot, {}],
      [IpcChannel.DeleteToolchainSnapshot, { snapshotId: 'snapshot-1' }],
    ]);
    mocks.invoke.mockReset();
  });
});

describe('MCP preload operations', () => {
  it('routes each MCP connection API through its validated channel', async () => {
    const operationId = 'ba17e5bd-b537-4a68-9b32-231634967f0c';
    const connection: NonNullable<
      Awaited<ReturnType<BetterWorkDesktopApi['mcp']['getConnection']>>
    > = {
      id: 'connection-1',
      name: 'MCP',
      transport: { kind: 'stdio', command: 'node', args: [] },
      status: 'unconfigured',
      tools: [],
      createdAt: 1,
      updatedAt: 1,
    };
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(async (channel) => {
      switch (channel) {
        case IpcChannel.ListMcpConnections:
          return [connection];
        case IpcChannel.GetMcpConnection:
          return connection;
        case IpcChannel.DeleteMcpConnection:
          return { deleted: true };
        case IpcChannel.CancelMcpOperation:
          return { cancelled: true };
        case IpcChannel.PrepareMcpLogin:
          return {
            operationId,
            resource: 'https://mcp.example/mcp',
            issuers: ['https://auth.example'],
            scopes: [],
          };
        case IpcChannel.TestMcpConnection:
        case IpcChannel.ContinueMcpLogin:
          return { connection, tools: [] };
        default:
          return { connection };
      }
    });

    const mcp = api().mcp;
    const operation = { id: connection.id, expectedRevisionId: 'revision-1', operationId };
    await mcp.listConnections();
    await mcp.getConnection({ id: connection.id });
    await mcp.saveConnection({
      name: connection.name,
      transport: { kind: 'stdio', command: 'node' },
    });
    await mcp.deleteConnection({ id: connection.id });
    await mcp.testConnection(operation);
    await mcp.setLifecycle({
      id: connection.id,
      expectedRevisionId: 'revision-1',
      lifecycle: 'enabled',
    });
    await mcp.reviewTool({
      connectionId: connection.id,
      connectionRevisionId: 'revision-1',
      toolId: 'tool-1',
      contractHash: 'a'.repeat(64),
      userConfirmed: true,
    });
    await mcp.cancelOperation(operation);
    await mcp.prepareLogin(operation);
    await mcp.continueLogin({ ...operation, issuer: 'https://auth.example', consent: true });
    await mcp.logout(operation);

    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.ListMcpConnections, {}],
      [IpcChannel.GetMcpConnection, { id: connection.id }],
      [
        IpcChannel.SaveMcpConnection,
        { name: connection.name, transport: { kind: 'stdio', command: 'node', args: [] } },
      ],
      [IpcChannel.DeleteMcpConnection, { id: connection.id }],
      [IpcChannel.TestMcpConnection, operation],
      [
        IpcChannel.SetMcpLifecycle,
        { id: connection.id, expectedRevisionId: 'revision-1', lifecycle: 'enabled' },
      ],
      [
        IpcChannel.ReviewMcpTool,
        {
          connectionId: connection.id,
          connectionRevisionId: 'revision-1',
          toolId: 'tool-1',
          contractHash: 'a'.repeat(64),
          userConfirmed: true,
        },
      ],
      [IpcChannel.CancelMcpOperation, operation],
      [IpcChannel.PrepareMcpLogin, operation],
      [
        IpcChannel.ContinueMcpLogin,
        { ...operation, issuer: 'https://auth.example', consent: true },
      ],
      [IpcChannel.LogoutMcpConnection, operation],
    ]);
  });

  it('validates operation IDs and consent before IPC and correlates the login/cancel channels', async () => {
    mocks.invoke.mockClear();
    const operation = {
      id: 'connection',
      expectedRevisionId: 'revision',
      operationId: 'ba17e5bd-b537-4a68-9b32-231634967f0c',
    };
    expect(() => api().mcp.cancelOperation({ ...operation, operationId: 'invalid' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.invoke.mockResolvedValueOnce({ cancelled: true });
    await expect(api().mcp.cancelOperation(operation)).resolves.toEqual({ cancelled: true });
    expect(mocks.invoke).toHaveBeenLastCalledWith(IpcChannel.CancelMcpOperation, operation);
    mocks.invoke.mockResolvedValueOnce({
      operationId: operation.operationId,
      resource: 'https://mcp.example/mcp',
      issuers: ['https://auth.example'],
      scopes: ['read'],
    });
    await expect(api().mcp.prepareLogin(operation)).resolves.toMatchObject({ scopes: ['read'] });
    expect(mocks.invoke).toHaveBeenLastCalledWith(IpcChannel.PrepareMcpLogin, operation);
    mocks.invoke.mockResolvedValueOnce({ secret: 'unexpected response' });
    await expect(api().mcp.logout(operation)).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenLastCalledWith(IpcChannel.LogoutMcpConnection, operation);
  });
});
