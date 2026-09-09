import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { type ArtifactFileSourceResolver, FileArtifactService } from './file-artifact-service';

const temporaryDirectories: string[] = [];
const temporaryDirectory = (): string => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-file-artifact-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const passedValidation = {
  structure: 'passed' as const,
  visual: 'passed' as const,
  manualEdit: 'not-checked' as const,
};

const mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

interface SeedResult {
  runId: string;
  executionId: string;
}

const seedSkill = (store: AppStore): { grantId: string; profileRevisionId: string } => {
  const revisionId = 'skill-rev';
  store.skills.save({
    id: 'skill-1',
    name: '样本能力',
    description: '描述',
    sourceKind: 'user',
    currentRevisionId: revisionId,
  });
  store.skills.saveRevision({
    id: revisionId,
    skillId: 'skill-1',
    contentHash: 'hash-skill',
    resourceKey: 'user/skill-1/revisions/hash',
    frontmatter: {},
  });
  const profileId = store.skills.saveProfile({
    skillId: 'skill-1',
    profileHash: 'profile-skill',
    profile: { commands: [], environmentRequirements: [], outputContract: { outputPaths: [] } },
  });
  store.skills.save({
    id: 'skill-1',
    name: '样本能力',
    description: '描述',
    sourceKind: 'user',
    currentRevisionId: revisionId,
    currentProfileRevisionId: profileId,
  });
  const grantId = store.skills.saveTrustGrant({
    skillId: 'skill-1',
    revisionId,
    profileHash: 'profile-skill',
    dependencyFingerprint: 'dep',
    scopeHash: 'scope',
    source: 'user',
  });
  return { grantId, profileRevisionId: profileId };
};

const seedExecution = (
  store: AppStore,
  workDir: string,
  options: { status: 'succeeded' | 'failed' | 'queued'; outputIds: string[] } = {
    status: 'succeeded',
    outputIds: ['slides.pptx'],
  },
): SeedResult => {
  const workspace = store.workspaces.getOrCreate(workDir, '夹具工作区');
  const created = store.tasks.create(workspace.id, '制作演示', '生成 deck');
  const runId = 'run-1';
  store.runs.create({
    id: runId,
    taskId: created.task.id,
    sessionId: created.sessionId,
    prompt: '生成 deck',
    status: 'running',
    createdAt: Date.now(),
  });

  const { grantId, profileRevisionId } = seedSkill(store);

  const binding = store.executions.createBinding({
    runId,
    skillRevisionId: 'skill-rev',
    profileRevisionId,
    dependencySnapshotIds: [],
    grantId,
  });

  const executionId = 'exec-1';
  store.executions.createExecution({
    id: executionId,
    runId,
    bindingId: binding.id,
    toolCallId: 'tool-call-1',
    commandId: 'ppt-generate',
    argumentDigest: 'digest',
    inputHashes: [],
    workDirKey: workDir,
    attemptKey: 'attempt-1',
  });

  if (options.status !== 'queued') {
    store.executions.finishExecution(executionId, options.status, {
      outputIds: options.outputIds,
      finishedAt: Date.now(),
    });
  }

  return { runId, executionId };
};

const openService = (
  artifactFilesRoot: string,
  resolver: ArtifactFileSourceResolver,
): { store: AppStore; service: FileArtifactService } => {
  const store = AppStore.open(path.join(temporaryDirectory(), 'app.sqlite'));
  const service = new FileArtifactService(store, artifactFilesRoot, resolver);
  return { store, service };
};

describe('FileArtifactService', () => {
  it('registers a file artifact from a succeeded execution output', async () => {
    const workDir = temporaryDirectory();
    const artifactFilesRoot = temporaryDirectory();
    const outputDir = path.join(workDir, 'output');
    mkdirSync(outputDir, { recursive: true });
    const outputFile = path.join(outputDir, 'slides.pptx');
    const fileContent = Buffer.from('PK-fake-pptx-content');
    writeFileSync(outputFile, fileContent);

    const { store, service } = openService(artifactFilesRoot, async () => outputFile);
    const seed = seedExecution(store, workDir);

    const result = await service.register({
      runId: seed.runId,
      executionId: seed.executionId,
      outputId: 'slides.pptx',
      title: '季度报告',
      mimeType,
      validation: passedValidation,
    });

    expect(result.artifactId).toBeTruthy();
    expect(result.versionId).toBeTruthy();
    expect(result.versionNumber).toBe(1);
    expect(result.fileHash).toBe(createHash('sha256').update(fileContent).digest('hex'));
    expect(result.fileSize).toBe(fileContent.length);
    expect(service.resolveStoredPath(result.versionId)).toContain(artifactFilesRoot);
  });

  it('rejects when execution does not belong to the run', async () => {
    const workDir = temporaryDirectory();
    const artifactFilesRoot = temporaryDirectory();
    const { store, service } = openService(artifactFilesRoot, async () => '/tmp/nope');
    seedExecution(store, workDir);

    const otherWorkspace = store.workspaces.getOrCreate('/tmp/other', '其他');
    const otherTask = store.tasks.create(otherWorkspace.id, '其他任务', '描述');
    const otherRunId = 'run-other';
    store.runs.create({
      id: otherRunId,
      taskId: otherTask.task.id,
      sessionId: otherTask.sessionId,
      prompt: 'prompt',
      status: 'running',
      createdAt: Date.now(),
    });

    await expect(
      service.register({
        runId: otherRunId,
        executionId: 'exec-1',
        outputId: 'slides.pptx',
        title: '季度报告',
        mimeType,
        validation: passedValidation,
      }),
    ).rejects.toThrow(/does not belong to this run/);
  });

  it('rejects when execution has not succeeded', async () => {
    const workDir = temporaryDirectory();
    const artifactFilesRoot = temporaryDirectory();
    const { store, service } = openService(artifactFilesRoot, async () => '/tmp/nope');
    seedExecution(store, workDir, { status: 'failed', outputIds: [] });

    await expect(
      service.register({
        runId: 'run-1',
        executionId: 'exec-1',
        outputId: 'slides.pptx',
        title: '季度报告',
        mimeType,
        validation: passedValidation,
      }),
    ).rejects.toThrow(/Only succeeded executions/);
  });

  it('rejects when output is not registered for the execution', async () => {
    const workDir = temporaryDirectory();
    const artifactFilesRoot = temporaryDirectory();
    const { store, service } = openService(artifactFilesRoot, async () => '/tmp/nope');
    seedExecution(store, workDir, { status: 'succeeded', outputIds: ['other-file.xlsx'] });

    await expect(
      service.register({
        runId: 'run-1',
        executionId: 'exec-1',
        outputId: 'slides.pptx',
        title: '季度报告',
        mimeType,
        validation: passedValidation,
      }),
    ).rejects.toThrow(/Output is not registered/);
  });

  it('rejects symbolic link output paths', async () => {
    const workDir = temporaryDirectory();
    const artifactFilesRoot = temporaryDirectory();
    const outputDir = path.join(workDir, 'output');
    mkdirSync(outputDir, { recursive: true });

    const realFile = path.join(outputDir, 'real.pptx');
    writeFileSync(realFile, 'real-content');
    const linkFile = path.join(outputDir, 'slides.pptx');
    await symlink(realFile, linkFile);

    const { store, service } = openService(artifactFilesRoot, async () => linkFile);
    seedExecution(store, workDir);

    await expect(
      service.register({
        runId: 'run-1',
        executionId: 'exec-1',
        outputId: 'slides.pptx',
        title: '季度报告',
        mimeType,
        validation: passedValidation,
      }),
    ).rejects.toThrow(/not a regular file/);
  });

  it('cleans up copied file when DB registration fails', async () => {
    const workDir = temporaryDirectory();
    const artifactFilesRoot = temporaryDirectory();
    const outputDir = path.join(workDir, 'output');
    mkdirSync(outputDir, { recursive: true });
    const outputFile = path.join(outputDir, 'slides.pptx');
    writeFileSync(outputFile, 'file-content');

    const { store, service } = openService(artifactFilesRoot, async () => outputFile);
    seedExecution(store, workDir);

    store.close();

    await expect(
      service.register({
        runId: 'run-1',
        executionId: 'exec-1',
        outputId: 'slides.pptx',
        title: '季度报告',
        mimeType,
        validation: passedValidation,
      }),
    ).rejects.toThrow();

    const { readdir } = await import('node:fs/promises');
    const files = await readdir(artifactFilesRoot).catch(() => []);
    expect(files).toHaveLength(0);
  });

  it('creates a new version when registering the same artifact twice', async () => {
    const workDir = temporaryDirectory();
    const artifactFilesRoot = temporaryDirectory();
    const outputDir = path.join(workDir, 'output');
    mkdirSync(outputDir, { recursive: true });
    const outputFile = path.join(outputDir, 'slides.pptx');
    writeFileSync(outputFile, 'version-1-content');

    const { store, service } = openService(artifactFilesRoot, async () => outputFile);
    const seed = seedExecution(store, workDir);

    const first = await service.register({
      runId: seed.runId,
      executionId: seed.executionId,
      outputId: 'slides.pptx',
      title: '季度报告',
      mimeType,
      validation: passedValidation,
    });

    writeFileSync(outputFile, 'version-2-content');

    const second = await service.register({
      runId: seed.runId,
      executionId: seed.executionId,
      outputId: 'slides.pptx',
      artifactId: first.artifactId,
      title: '季度报告',
      mimeType,
      validation: passedValidation,
    });

    expect(second.artifactId).toBe(first.artifactId);
    expect(second.versionId).not.toBe(first.versionId);
    expect(second.versionNumber).toBe(2);
    expect(second.fileHash).not.toBe(first.fileHash);
  });

  it('stored path points to a readable file after registration', async () => {
    const workDir = temporaryDirectory();
    const artifactFilesRoot = temporaryDirectory();
    const outputDir = path.join(workDir, 'output');
    mkdirSync(outputDir, { recursive: true });
    const content = Buffer.from('PK-fake-pptx');
    const outputFile = path.join(outputDir, 'slides.pptx');
    writeFileSync(outputFile, content);

    const { store, service } = openService(artifactFilesRoot, async () => outputFile);
    const seed = seedExecution(store, workDir);

    const result = await service.register({
      runId: seed.runId,
      executionId: seed.executionId,
      outputId: 'slides.pptx',
      title: '季度报告',
      mimeType,
      validation: passedValidation,
    });

    const { readFile, stat } = await import('node:fs/promises');
    const storedPath = service.resolveStoredPath(result.versionId);
    const storedContent = await readFile(storedPath);
    const storedStat = await stat(storedPath);
    expect(storedContent).toEqual(content);
    expect(storedStat.size).toBe(content.length);
  });
});
