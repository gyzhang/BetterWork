import type { AgentRuntimeEvent, RunDiagnosticPackage } from '@betterwork/agent-protocol';
import { agentRuntimeEventSchema } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import { KnowledgeVault } from './knowledge-vault';
import {
  RunDiagnosticPackageService,
  serializeRunDiagnosticPackage,
} from './run-diagnostic-package-service';
import { RunDiagnosticsSourcesService } from './run-diagnostics-sources';

const stores: AppStore[] = [];
const vaults: KnowledgeVault[] = [];

const open = () => {
  const store = AppStore.open(':memory:');
  const vault = new KnowledgeVault(':memory:');
  stores.push(store);
  vaults.push(vault);
  const workspace = store.workspaces.getOrCreate('/tmp/diagnostic-package-workspace', 'Export');
  const task = store.tasks.create(workspace.id, 'Export task', 'diagnostic package fixture');
  store.runs.create(
    {
      id: 'export-run',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'PRIVATE_PROMPT sk-test-secret-1234567890',
      status: 'running',
      createdAt: 10,
    },
    { version: 1, sections: ['core'] },
  );
  const event = (sequence: number, fields: Record<string, unknown>): AgentRuntimeEvent =>
    agentRuntimeEventSchema.parse({
      id: `export-run-event-${sequence}`,
      runId: 'export-run',
      sequence,
      createdAt: 100 + sequence,
      ...fields,
    });
  const events: AgentRuntimeEvent[] = [
    event(0, { type: 'run.started', taskId: task.task.id, sessionId: task.sessionId }),
    event(1, {
      type: 'model.started',
      modelCallId: 'model-call-a',
      round: 0,
      providerId: 'fixture-provider',
      messageCount: 1,
      toolDefinitionCount: 1,
    }),
    event(2, { type: 'reasoning.delta', delta: 'PRIVATE_REASONING /Users/customer/private.md' }),
    event(3, {
      type: 'tool.requested',
      modelCallId: 'model-call-a',
      round: 0,
      toolCall: {
        id: 'tool-call-a',
        name: 'read_text_file',
        input: { path: '/Users/customer/private.md', apiKey: 'sk-test-secret-1234567890' },
      },
    }),
    event(4, {
      type: 'tool.started',
      modelCallId: 'model-call-a',
      round: 0,
      toolCall: { id: 'tool-call-a', name: 'read_text_file', input: {} },
    }),
    event(5, {
      type: 'tool.completed',
      modelCallId: 'model-call-a',
      round: 0,
      toolCallId: 'tool-call-a',
      output: {
        nested: {
          result: 'PRIVATE_TOOL_RESULT',
          error: '/Users/customer/private.md',
          reasoning: 'PRIVATE_NESTED_REASONING',
          credential: 'sk-test-secret-1234567890',
        },
      },
    }),
    event(6, {
      type: 'model.completed',
      modelCallId: 'model-call-a',
      round: 0,
      durationMs: 25,
      usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 },
    }),
    event(7, {
      type: 'message.completed',
      messageId: 'message-a',
      content: 'PRIVATE_MESSAGE_BODY',
    }),
    event(8, { type: 'run.completed', finalContent: 'PRIVATE_FINAL_ANSWER' }),
  ];
  for (const entry of events) store.runs.appendEvent(entry);
  store.runDiagnostics.setIssueMark(
    {
      workspaceId: workspace.id,
      taskId: task.task.id,
      runId: 'export-run',
      expectedRevision: null,
      category: 'tool',
      diagnosticNodeId: 'tool:tool-call-a',
    },
    200,
  );

  return { store, vault, workspace, task };
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const vault of vaults.splice(0)) vault.close();
});

describe('RunDiagnosticPackageService', () => {
  it('rebuilds a deterministic whitelist from one scoped Run snapshot', () => {
    const { store, vault, workspace, task } = open();
    const contentHash = 'a'.repeat(64);
    store.inputSnapshots.createPreparing({
      id: 'export-input-snapshot',
      workspaceId: workspace.id,
      sourcePath: '/Users/customer/private-source.docx',
      contentHash,
      byteSize: 10,
      format: 'docx',
      fileKey: '/Users/customer/private-cache-entry',
      createdAt: 12,
    });
    store.inputSnapshots.markReady('export-input-snapshot', 13);
    store.runContextSnapshots.create({
      runId: 'export-run',
      taskId: task.task.id,
      workspaceId: workspace.id,
      contextSegmentId: 'export-segment',
      materials: [
        {
          reference: {
            kind: 'workspace-input-snapshot',
            snapshotId: 'export-input-snapshot',
            workspaceId: workspace.id,
            contentHash,
            format: 'docx',
            fileKey: '/Users/customer/private-cache-entry',
            sourcePath: '/Users/customer/private-source.docx',
          },
          purpose: 'current-input',
          addedFrom: 'user-input',
        },
      ],
      createdAt: 14,
    });

    const service = new RunDiagnosticPackageService(
      store,
      new RunDiagnosticsSourcesService(store, vault),
      { now: () => 500, applicationVersion: () => '1.2.0' },
    );
    const scope = { workspaceId: workspace.id, taskId: task.task.id, runId: 'export-run' };
    const exported = service.create(scope);
    const packageData: RunDiagnosticPackage = JSON.parse(exported.json) as RunDiagnosticPackage;

    expect(exported.byteLength).toBe(Buffer.byteLength(exported.json, 'utf8'));
    expect(packageData).toMatchObject({
      schemaVersion: 1,
      generatedAt: 500,
      applicationVersion: '1.2.0',
      run: { id: 'export-run', status: 'completed', createdAt: 10, completedAt: 108 },
      diagnostics: {
        integrity: 'complete',
        summary: {
          modelCallCount: 1,
          toolCallCount: 1,
          usage: { totalTokens: { knownSubtotal: '10' } },
        },
      },
      issueMark: { category: 'tool', diagnosticNodeId: 'tool:tool-call-a' },
      sources: {
        materials: {
          selected: [
            {
              reference: {
                kind: 'workspace-input-snapshot',
                snapshotId: 'export-input-snapshot',
                contentHash,
              },
              wasRead: false,
            },
          ],
        },
      },
    });
    expect(packageData.diagnostics.nodes).toEqual(
      expect.arrayContaining([
        {
          id: 'model:model-call-a',
          kind: 'model',
          status: 'completed',
          modelCallId: 'model-call-a',
          durationMs: 25,
          sourceKind: 'core-journal',
          evidenceState: 'recorded',
          sourceSequenceStart: 1,
          sourceSequenceEnd: 6,
          occurredAt: 101,
          parentId: 'round:0',
          round: 0,
          startedAt: 101,
          endedAt: 106,
          usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 },
        },
        {
          id: 'tool:tool-call-a',
          kind: 'tool',
          status: 'completed',
          toolCallId: 'tool-call-a',
          sourceKind: 'core-journal',
          evidenceState: 'recorded',
          sourceSequenceStart: 3,
          sourceSequenceEnd: 5,
          occurredAt: 103,
          parentId: 'round:0',
          modelCallId: 'model-call-a',
          round: 0,
          startedAt: 104,
          endedAt: 105,
          executionState: 'started',
        },
      ]),
    );
    for (const privateValue of [
      'PRIVATE_PROMPT',
      'PRIVATE_REASONING',
      'PRIVATE_TOOL_RESULT',
      'PRIVATE_NESTED_REASONING',
      'PRIVATE_MESSAGE_BODY',
      'PRIVATE_FINAL_ANSWER',
      '/Users/customer/private.md',
      '/Users/customer/private-source.docx',
      '/Users/customer/private-cache-entry',
      'sk-test-secret-1234567890',
      'apiKey',
      'toolName',
      'finalContent',
    ]) {
      expect(exported.json).not.toContain(privateValue);
    }
  });

  it('rejects a wrong Workspace or Task before creating an export', () => {
    const { store, vault, workspace, task } = open();
    const service = new RunDiagnosticPackageService(
      store,
      new RunDiagnosticsSourcesService(store, vault),
    );

    expect(() =>
      service.create({
        workspaceId: 'other-workspace',
        taskId: task.task.id,
        runId: 'export-run',
      }),
    ).toThrow('不属于当前工作空间和任务');
    expect(() =>
      service.create({
        workspaceId: workspace.id,
        taskId: 'other-task',
        runId: 'export-run',
      }),
    ).toThrow('不属于当前工作空间和任务');
  });

  it('redacts unsafe source identifiers and marks the source projection partial', () => {
    const { store, vault, workspace, task } = open();
    const scope = { workspaceId: workspace.id, taskId: task.task.id, runId: 'export-run' };
    const sourcesService = new RunDiagnosticsSourcesService(store, vault);
    const sources = sourcesService.get(scope);
    if (!sources) throw new Error('Expected a source projection for the Run');
    vi.spyOn(sourcesService, 'get').mockReturnValue({
      ...sources,
      integrity: 'complete',
      materials: {
        state: 'recorded',
        selected: [
          {
            reference: {
              kind: 'evidence',
              state: 'recorded',
              evidenceId: '/Users/customer/private-evidence.md',
            },
            purpose: 'current-input',
            addedFrom: 'user-input',
            wasRead: false,
          },
        ],
        reads: [],
      },
    });

    const exported = new RunDiagnosticPackageService(store, sourcesService).create(scope);
    const packageData: RunDiagnosticPackage = JSON.parse(exported.json) as RunDiagnosticPackage;

    expect(exported.json).not.toContain('/Users/customer/private-evidence.md');
    expect(packageData.sources).toMatchObject({
      integrity: 'partial',
      materials: { selected: [{ reference: { kind: 'evidence' } }] },
    });
  });

  it('refuses packages over the configured and 5 MiB limits instead of truncating them', () => {
    const emptyPackage: RunDiagnosticPackage = {
      schemaVersion: 1,
      generatedAt: 100,
      run: {
        id: 'run-a',
        taskId: 'task-a',
        sessionId: 'session-a',
        status: 'completed',
        createdAt: 10,
        completedAt: 20,
      },
      diagnostics: { integrity: 'complete', nodes: [] },
      sources: {
        integrity: 'complete',
        fixedContext: { state: 'recorded', skills: [] },
        materials: { state: 'recorded', selected: [], reads: [] },
        memory: { state: 'recorded', selectedItems: [], readCount: 0, replayCount: 0 },
        continuity: {
          state: 'not-recorded',
          omissions: [],
          sourceRunIds: [],
          artifactVersionIds: [],
        },
        artifacts: { state: 'not-recorded', producedVersions: [], inputRelations: [] },
      },
    };
    expect(() => serializeRunDiagnosticPackage(emptyPackage, 1)).toThrow('超过 1 字节');

    const oversizedPackage: RunDiagnosticPackage = {
      ...emptyPackage,
      diagnostics: {
        integrity: 'complete',
        nodes: Array.from({ length: 12_000 }, (_, index) => ({
          id: `node-${String(index).padStart(5, '0')}-${'n'.repeat(470)}`,
          kind: 'round' as const,
          status: 'completed' as const,
          sourceKind: 'core-journal' as const,
          evidenceState: 'derived' as const,
        })),
      },
    };
    expect(() => serializeRunDiagnosticPackage(oversizedPackage)).toThrow('超过 5 MiB');
  });
});
