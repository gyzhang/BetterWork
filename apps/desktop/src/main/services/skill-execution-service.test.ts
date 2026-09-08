import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { JobResult, JobSpec } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProcessSupervisor, SupervisorHandle } from '../infrastructure/process-supervisor';
import { AppStore } from '../persistence';
import { SkillExecutionService, type StartExecutionInput } from './skill-execution-service';

const temporaryDirectories: string[] = [];
const temporaryDirectory = (): string => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-execution-service-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface FakeJob {
  spec: JobSpec;
  cancelled: boolean;
  resolveResult: (result: JobResult) => void;
}

class FakeSupervisor implements ProcessSupervisor {
  readonly jobs: FakeJob[] = [];
  cleanupCompleted = true;
  launchError: Error | undefined;

  async launch(spec: JobSpec): Promise<SupervisorHandle> {
    if (this.launchError) throw this.launchError;
    let resolveResult: ((result: JobResult) => void) | undefined;
    const result = new Promise<JobResult>((resolve) => {
      resolveResult = resolve;
    });
    const job: FakeJob = { spec, cancelled: false, resolveResult: () => undefined };
    if (resolveResult) job.resolveResult = resolveResult;
    this.jobs.push(job);
    return {
      executionId: spec.executionId,
      result,
      cancel: async () => {
        job.cancelled = true;
        job.resolveResult({
          kind: 'cancelled',
          cleanupCompleted: this.cleanupCompleted,
          diagnosticOutputIds: [],
        });
        return { cleanupCompleted: this.cleanupCompleted };
      },
    };
  }
}

const openFixture = (): {
  store: AppStore;
  supervisor: FakeSupervisor;
  service: SkillExecutionService;
} => {
  const store = AppStore.open(path.join(temporaryDirectory(), 'app.sqlite'));
  const supervisor = new FakeSupervisor();
  return { store, supervisor, service: new SkillExecutionService(store, supervisor) };
};

const seedRun = (store: AppStore, runId: string): void => {
  const workspace = store.workspaces.getOrCreate('/tmp/fixture-workspace', '夹具工作区');
  const created = store.tasks.create(workspace.id, '制作演示', '生成 deck');
  store.runs.create({
    id: runId,
    taskId: created.task.id,
    sessionId: created.sessionId,
    prompt: '生成 deck',
    status: 'running',
    createdAt: Date.now(),
  });
};

const seedSkill = (store: AppStore, skillId: string, withGrant: boolean): void => {
  const revisionId = `${skillId}-rev`;
  store.skills.save({
    id: skillId,
    name: '样本能力',
    description: '描述',
    sourceKind: 'user',
    currentRevisionId: revisionId,
  });
  store.skills.saveRevision({
    id: revisionId,
    skillId,
    contentHash: `hash-${skillId}`,
    resourceKey: `user/${skillId}/revisions/hash`,
    frontmatter: {},
  });
  const profileId = store.skills.saveProfile({
    skillId,
    profileHash: `profile-${skillId}`,
    profile: { commands: [], environmentRequirements: [], outputContract: { outputPaths: [] } },
  });
  store.skills.save({
    id: skillId,
    name: '样本能力',
    description: '描述',
    sourceKind: 'user',
    currentRevisionId: revisionId,
    currentProfileRevisionId: profileId,
  });
  if (withGrant) {
    store.skills.saveTrustGrant({
      skillId,
      revisionId,
      profileHash: `profile-${skillId}`,
      dependencyFingerprint: 'dep',
      scopeHash: 'scope',
      source: 'user',
    });
  }
};

const startInput = (runId: string, bindingId: string, toolCallId: string): StartExecutionInput => ({
  runId,
  bindingId,
  toolCallId,
  commandId: 'svg-export',
  args: { deck: 'quarterly' },
  argv: ['export.py', '--deck', 'quarterly'],
  executable: '/managed/python/bin/python3',
  cwd: '/tmp/fixture-work',
  env: { PPTM_HOME: '/tmp/fixture-snapshot' },
  timeoutMs: 60_000,
  maxOutputBytes: 32_768,
  maxLogBytes: 1_048_576,
  expectedOutputs: ['deck.svg'],
  workDirKey: 'work',
});

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('SkillExecutionService', () => {
  it('runs the whole lifecycle through an injected supervisor', async () => {
    const { store, supervisor, service } = openFixture();
    seedRun(store, 'run-1');
    seedSkill(store, 'skill-1', true);

    const binding = service.createBinding({ runId: 'run-1', skillId: 'skill-1' });
    expect(binding.runId).toBe('run-1');

    const execution = await service.startExecution(startInput('run-1', binding.id, 'tool-1'));
    expect(execution.status).toBe('running');
    expect(supervisor.jobs).toHaveLength(1);
    const spec = supervisor.jobs[0]?.spec;
    expect(spec).toMatchObject({
      protocolVersion: 1,
      executionId: execution.id,
      runId: 'run-1',
      toolCallId: 'tool-1',
      bindingId: binding.id,
      commandId: 'svg-export',
      executable: '/managed/python/bin/python3',
      cwd: '/tmp/fixture-work',
    });
    expect(spec?.env).toEqual({ PPTM_HOME: '/tmp/fixture-snapshot' });

    supervisor.jobs[0]?.resolveResult({
      kind: 'succeeded',
      exitCode: 0,
      outputIds: ['out-1'],
      reportHash: 'report-hash',
      durationMs: 12,
    });
    await flush();

    const finished = store.executions.getExecution(execution.id);
    expect(finished).toMatchObject({ status: 'succeeded', reportHash: 'report-hash' });
    expect(finished?.outputIds).toEqual(['out-1']);
    store.close();
  });

  it('refuses to bind a skill without an active grant or profile', () => {
    const { store, service } = openFixture();
    seedRun(store, 'run-1');
    seedSkill(store, 'skill-untrusted', false);
    expect(() => service.createBinding({ runId: 'run-1', skillId: 'skill-untrusted' })).toThrow(
      'active trust grant',
    );
    expect(() => service.createBinding({ runId: 'run-1', skillId: 'skill-missing' })).toThrow(
      'does not exist',
    );
    store.close();
  });

  it('rejects executions whose binding belongs to another run', async () => {
    const { store, service } = openFixture();
    seedRun(store, 'run-1');
    seedRun(store, 'run-2');
    seedSkill(store, 'skill-1', true);
    const binding = service.createBinding({ runId: 'run-1', skillId: 'skill-1' });

    await expect(service.startExecution(startInput('run-2', binding.id, 'tool-1'))).rejects.toThrow(
      'does not belong to run',
    );
    expect(store.executions.listExecutionsByRun('run-2')).toEqual([]);
    store.close();
  });

  it('ignores duplicate and late results once an execution is terminal', async () => {
    const { store, supervisor, service } = openFixture();
    seedRun(store, 'run-1');
    seedSkill(store, 'skill-1', true);
    const binding = service.createBinding({ runId: 'run-1', skillId: 'skill-1' });
    const execution = await service.startExecution(startInput('run-1', binding.id, 'tool-1'));

    expect(
      service.recordResult(execution.id, {
        kind: 'succeeded',
        exitCode: 0,
        outputIds: ['o1'],
        durationMs: 1,
      }),
    ).toBe(true);
    expect(
      service.recordResult(execution.id, {
        kind: 'failed',
        phase: 'execute',
        code: 'E',
        summary: '迟到结果',
        retryable: false,
      }),
    ).toBe(false);
    expect(store.executions.getExecution(execution.id)).toMatchObject({ status: 'succeeded' });

    const second = await service.startExecution(startInput('run-1', binding.id, 'tool-2'));
    await service.cancelExecution(second.id);
    expect(store.executions.getExecution(second.id)).toMatchObject({ status: 'cancelled' });
    supervisor.jobs[1]?.resolveResult({
      kind: 'succeeded',
      exitCode: 0,
      outputIds: ['late'],
      durationMs: 1,
    });
    await flush();
    expect(store.executions.getExecution(second.id)).toMatchObject({
      status: 'cancelled',
      outputIds: [],
    });
    store.close();
  });

  it('maps failure phases to reasons and cleanup failure to a failed execution', async () => {
    const { store, supervisor, service } = openFixture();
    seedRun(store, 'run-1');
    seedSkill(store, 'skill-1', true);
    const binding = service.createBinding({ runId: 'run-1', skillId: 'skill-1' });

    const failed = await service.startExecution(startInput('run-1', binding.id, 'tool-1'));
    supervisor.jobs[0]?.resolveResult({
      kind: 'failed',
      phase: 'validate',
      code: 'quality-gate',
      summary: '结构校验未通过',
      retryable: true,
    });
    await flush();
    expect(store.executions.getExecution(failed.id)).toMatchObject({
      status: 'failed',
      reason: 'validate-failed',
    });

    supervisor.cleanupCompleted = false;
    const dirty = await service.startExecution(startInput('run-1', binding.id, 'tool-2'));
    const report = await service.cancelExecution(dirty.id);
    expect(report).toEqual({ applied: true, cleanupCompleted: false });
    expect(store.executions.getExecution(dirty.id)).toMatchObject({
      status: 'failed',
      reason: 'cleanup-failed',
    });

    supervisor.launchError = new Error('spawn 失败');
    await expect(service.startExecution(startInput('run-1', binding.id, 'tool-3'))).rejects.toThrow(
      'could not launch',
    );
    const spawnFailed = store.executions
      .listExecutionsByRun('run-1')
      .find((execution) => execution.toolCallId === 'tool-3');
    expect(spawnFailed).toMatchObject({ status: 'failed', reason: 'spawn-failed' });
    store.close();
  });

  it('finishes only the requested run and blocks new executions while finishing', async () => {
    const { store, supervisor, service } = openFixture();
    seedRun(store, 'run-1');
    seedRun(store, 'run-2');
    seedSkill(store, 'skill-1', true);
    const bindingOne = service.createBinding({ runId: 'run-1', skillId: 'skill-1' });
    const bindingTwo = service.createBinding({ runId: 'run-2', skillId: 'skill-1' });
    const first = await service.startExecution(startInput('run-1', bindingOne.id, 'tool-1'));
    const second = await service.startExecution(startInput('run-2', bindingTwo.id, 'tool-2'));

    const report = await service.finishRun('run-1');
    expect(report).toEqual({ cancelled: 1, cleanupFailed: 0 });
    expect(store.executions.getExecution(first.id)).toMatchObject({
      status: 'cancelled',
      reason: 'cancelled-by-run',
    });
    expect(store.executions.getExecution(second.id)).toMatchObject({ status: 'running' });
    expect(supervisor.jobs[0]?.cancelled).toBe(true);
    expect(supervisor.jobs[1]?.cancelled).toBe(false);

    await expect(
      service.startExecution(startInput('run-1', bindingOne.id, 'tool-3')),
    ).rejects.toThrow('is finishing');
    store.close();
  });

  it('recovers executions left open by a killed process as interrupted failures', async () => {
    const { store, service } = openFixture();
    seedRun(store, 'run-1');
    seedSkill(store, 'skill-1', true);
    const binding = service.createBinding({ runId: 'run-1', skillId: 'skill-1' });
    store.executions.createExecution({
      runId: 'run-1',
      bindingId: binding.id,
      toolCallId: 'tool-orphan',
      commandId: 'svg-export',
      argumentDigest: 'digest',
      inputHashes: [],
      workDirKey: 'work',
      attemptKey: 'attempt-orphan',
    });

    expect(service.recoverInterruptedExecutions()).toBe(1);
    const recovered = store.executions.listExecutionsByRun('run-1')[0];
    expect(recovered).toMatchObject({ status: 'failed', reason: 'interrupted' });
    expect(service.recoverInterruptedExecutions()).toBe(0);
    store.close();
  });
});
