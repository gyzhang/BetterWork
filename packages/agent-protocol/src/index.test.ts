import { describe, expect, it } from 'vitest';

import {
  deleteSkillRequestSchema,
  dependencyLockSchema,
  dependencyOperationSchema,
  exportMarkdownArtifactRequestSchema,
  importSkillRequestSchema,
  jobResultSchema,
  jobSpecSchema,
  runtimeEnvironmentSchema,
  runtimeProfileDraftSchema,
  scriptExecutionSchema,
  setSkillTrustRequestSchema,
  skillRevisionSummarySchema,
  skillSummarySchema,
  startRunRequestSchema,
  updateWindowThemeRequestSchema,
} from './index';

describe('run protocol', () => {
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
