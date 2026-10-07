import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { JobSpec } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { fakePptxRenderer } from '../infrastructure/fixtures/fake-pptx-renderer';
import { createMacProcessSupervisor } from '../infrastructure/mac-process-supervisor';
import { AppStore } from '../persistence';
import { ExecutionOutputService } from './execution-output-service';
import { FileArtifactService } from './file-artifact-service';
import { SkillExecutionService } from './skill-execution-service';

const roots: string[] = [];
const temporary = (): string => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'betterwork-output-')));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const successReport = 'validation report for this package';
const specFor = (cwd: string, mode: 'create' | 'unchanged' = 'unchanged'): JobSpec => ({
  protocolVersion: 1,
  executionId: 'e',
  runId: 'r',
  bindingId: 'b',
  toolCallId: 't',
  commandId: 'pptx-validate',
  executable: process.execPath,
  argv: [],
  cwd,
  env: {},
  timeoutMs: 10_000,
  maxOutputBytes: 32768,
  maxLogBytes: 32768,
  expectedOutputs: ['deck.pptx'],
  outputContracts: [
    {
      mode,
      extension: 'pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      validation: {
        structure: mode === 'unchanged' ? 'passed' : 'not-checked',
        visual: 'not-checked',
        manualEdit: 'not-checked',
      },
    },
  ],
  requireCompleteStdout: true,
});
const capture = (stdout: string, truncated = false) => ({
  stdout,
  stderr: '',
  truncated,
  receivedBytes: stdout.length,
  droppedBytes: 0,
});

describe('execution output collection', () => {
  it.each(['', 'OK', '{"issues":[]}', 'package-specific diagnostics'])(
    'preserves stdout without interpreting Skill-specific report formats: %s',
    (stdout) => {
      const root = temporary();
      writeFileSync(path.join(root, 'deck.pptx'), 'fixture bytes');
      const collector = new ExecutionOutputService();
      const spec = specFor(root);
      collector.prepare(spec);
      const [output] = collector.collect(spec, capture(stdout));
      expect(output).toBeDefined();
      if (!output) throw new Error('test setup: output was not returned');
      const reportPath = path.join(root, `${output.relativePath}.report.json`);
      expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toMatchObject({ stdout });
    },
  );
  it('rejects truncated reports and output changes during validation', () => {
    const root = temporary();
    const file = path.join(root, 'deck.pptx');
    writeFileSync(file, 'fixture bytes');
    const collector = new ExecutionOutputService();
    const spec = specFor(root);
    collector.prepare(spec);
    expect(() => collector.collect(spec, capture(successReport, true))).toThrow('truncated');
    collector.prepare(spec);
    writeFileSync(file, 'PK-changed');
    expect(() => collector.collect(spec, capture(successReport))).toThrow('changed');
  });
  it('rejects old outputs for a generation command', () => {
    const root = temporary();
    writeFileSync(path.join(root, 'deck.pptx'), 'old output');
    const spec = specFor(root, 'create');
    expect(() => new ExecutionOutputService().prepare(spec)).toThrow('already exists');
  });
  it('connects real process cleanup, verified output persistence and artifact registration', async () => {
    const root = temporary();
    const store = AppStore.open(path.join(root, 'app.sqlite'));
    const workspace = store.workspaces.getOrCreate(root, 'fixture');
    const task = store.tasks.create(workspace.id, 'fixture', 'fixture');
    store.runs.create({
      id: 'r',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'fixture',
      status: 'running',
      createdAt: Date.now(),
    });
    store.skills.save({
      id: 's',
      name: 'fixture',
      description: '',
      sourceKind: 'user',
      currentRevisionId: 'rev',
    });
    store.skills.saveRevision({
      id: 'rev',
      skillId: 's',
      contentHash: 'hash',
      resourceKey: 'fixture',
      frontmatter: {},
    });
    const profile = store.skills.saveProfile({
      skillId: 's',
      profileHash: 'profile',
      profile: { commands: [], environmentRequirements: [], outputContract: { outputPaths: [] } },
    });
    store.skills.save({
      id: 's',
      name: 'fixture',
      description: '',
      sourceKind: 'user',
      currentRevisionId: 'rev',
      currentProfileRevisionId: profile,
    });
    store.skills.saveTrustGrant({
      skillId: 's',
      revisionId: 'rev',
      profileHash: 'profile',
      dependencyFingerprint: 'dep',
      scopeHash: 'scope',
      source: 'user',
    });
    store.skills.setTrustPreference('s', 'trusted');
    const supervisor = createMacProcessSupervisor({
      guardian: {
        executable: process.execPath,
        scriptPath: fileURLToPath(new URL('../infrastructure/skill-guardian.ts', import.meta.url)),
        scriptArgs: [],
        env: { ...process.env },
      },
      createLogSink: (key) => ({ key, write() {}, async close() {} }),
    });
    const service = new SkillExecutionService(store, supervisor, new ExecutionOutputService());
    const binding = service.createBinding({ runId: 'r', skillId: 's' });
    writeFileSync(path.join(root, 'deck.pptx'), 'synthetic fixture bytes');
    const spec = specFor(root);
    const { outputContracts, requireCompleteStdout, ...startSpec } = spec;
    const execution = await service.startExecution({
      ...startSpec,
      ...(outputContracts ? { outputContracts } : {}),
      ...(requireCompleteStdout === undefined ? {} : { requireCompleteStdout }),
      bindingId: binding.id,
      args: {},
      workDirKey: 'work',
      argv: ['-e', `process.stdout.write(${JSON.stringify(successReport)})`],
    });
    const result = await service.awaitExecution(execution.id);
    expect(result.execution.status).toBe('succeeded');
    expect(result.execution.outputIds).toHaveLength(1);
    const output = store.executions.getVerifiedOutputs(execution.id)[0];
    if (!output) throw new Error('test setup: verified output is missing');
    const artifacts = new FileArtifactService(
      store,
      path.join(root, 'artifacts'),
      async () => path.join(root, output.relativePath),
      () => true,
      fakePptxRenderer(),
    );
    const registered = await artifacts.register({
      runId: 'r',
      executionId: execution.id,
      outputId: output.outputId,
      title: 'fixture',
    });
    expect(registered.validation).toEqual({
      structure: 'passed',
      visual: 'not-checked',
      manualEdit: 'not-checked',
    });
    expect(readFileSync(artifacts.resolveStoredPath(registered.versionId), 'utf8')).toBe(
      'synthetic fixture bytes',
    );
    // This is a synthetic CLI fixture, not a real PPT/PowerPoint acceptance claim.
    await service.finishRun('r');
    store.close();
  }, 30_000);
});
