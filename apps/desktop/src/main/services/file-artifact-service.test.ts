import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { RecordingPptxRenderer } from '../infrastructure/fixtures/fake-pptx-renderer';
import {
  emptyPptxRenderer,
  failingPptxRenderer,
  fakePptxRenderer,
} from '../infrastructure/fixtures/fake-pptx-renderer';
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
  store.skills.setTrustPreference('skill-1', 'trusted');
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
  renderer: RecordingPptxRenderer = fakePptxRenderer(),
): { store: AppStore; service: FileArtifactService; renderer: RecordingPptxRenderer } => {
  const store = AppStore.open(path.join(temporaryDirectory(), 'app.sqlite'));
  const service = new FileArtifactService(store, artifactFilesRoot, resolver, () => true, renderer);
  return { store, service, renderer };
};

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const fixture = (renderer: RecordingPptxRenderer = fakePptxRenderer()) => {
  const root = temporaryDirectory();
  const file = path.join(root, 'slides.pptx');
  const report = JSON.stringify({ issues: [], fileHash: hash('PK-content') });
  writeFileSync(file, 'PK-content');
  writeFileSync(`${file}.report.json`, report);
  const filesRoot = temporaryDirectory();
  const { store, service } = openService(filesRoot, async () => file, renderer);
  seedExecution(store, root, { status: 'queued', outputIds: [] });
  const output = {
    outputId: 'slides.pptx',
    relativePath: 'slides.pptx',
    fileHash: hash('PK-content'),
    fileSize: 10,
    reportHash: hash(report),
    validation: { ...passedValidation, visual: 'not-checked' as const },
  };
  store.executions.saveVerifiedOutputs('exec-1', [output]);
  store.executions.finishExecution('exec-1', 'succeeded', {
    outputIds: ['slides.pptx'],
    finishedAt: Date.now(),
  });
  const input = {
    runId: 'run-1',
    executionId: 'exec-1',
    outputId: 'slides.pptx',
    title: '季度报告',
    mimeType,
    validation: passedValidation,
  };
  return { root, filesRoot, file, store, service, renderer, output, input };
};

describe('FileArtifactService', () => {
  it('registers host-verified bytes and preserves unchecked visual status despite model claims', async () => {
    const f = fixture();
    const result = await f.service.register(f.input);
    expect(result.validation.visual).toBe('not-checked');
    expect(result.fileHash).toBe(f.output.fileHash);
    const { readFile } = await import('node:fs/promises');
    expect((await readFile(f.service.resolveStoredPath(result.versionId))).toString()).toBe(
      'PK-content',
    );
    f.store.close();
  });
  it('deduplicates concurrent registrations for the same execution and output', async () => {
    const f = fixture();
    const [first, second] = await Promise.all([
      f.service.register(f.input),
      f.service.register(f.input),
    ]);
    expect(first).toEqual(second);
    expect(f.store.artifacts.list()).toHaveLength(1);
    f.store.close();
  });
  it('adds a version only for a new validated execution output', async () => {
    const f = fixture();
    const first = await f.service.register(f.input);
    const original = f.store.executions.getExecution('exec-1')!;
    f.store.executions.createExecution({
      id: 'exec-2',
      runId: 'run-1',
      bindingId: original.bindingId,
      toolCallId: 'second',
      commandId: 'pptx-validate',
      argumentDigest: 'args',
      inputHashes: [],
      workDirKey: 'work',
      attemptKey: 'second',
    });
    f.store.executions.saveVerifiedOutputs('exec-2', [f.output]);
    f.store.executions.finishExecution('exec-2', 'succeeded', {
      outputIds: ['slides.pptx'],
      finishedAt: Date.now(),
    });
    const second = await f.service.register({
      ...f.input,
      executionId: 'exec-2',
      artifactId: first.artifactId,
    });
    expect(second.versionNumber).toBe(2);
    expect(second.versionId).not.toBe(first.versionId);
    f.store.close();
  });
  it('rejects cross-run and unknown output references', async () => {
    const f = fixture();
    await expect(f.service.register({ ...f.input, runId: 'other' })).rejects.toThrow(
      'does not belong',
    );
    await expect(f.service.register({ ...f.input, outputId: 'unknown' })).rejects.toThrow(
      'not registered',
    );
    f.store.close();
  });
  it('rejects modified bytes and modified reports', async () => {
    const f = fixture();
    writeFileSync(f.file, 'PK-changed');
    await expect(f.service.register(f.input)).rejects.toThrow('hash');
    writeFileSync(f.file, 'PK-content');
    writeFileSync(`${f.file}.report.json`, '{}');
    await expect(f.service.register(f.input)).rejects.toThrow('report hash');
    f.store.close();
  });
  it('rejects failed or absent host validation even if model says passed', async () => {
    const f = fixture();
    await expect(
      f.service.register({ ...f.input, validation: { ...passedValidation, structure: 'failed' } }),
    ).rejects.toThrow('validation failed');
    const missing = f.store.executions.getExecution('exec-1')!;
    f.store.executions.createExecution({
      id: 'unverified',
      runId: 'run-1',
      bindingId: missing.bindingId,
      toolCallId: 'u',
      commandId: 'fake',
      argumentDigest: 'a',
      inputHashes: [],
      workDirKey: 'w',
      attemptKey: 'u',
    });
    f.store.executions.finishExecution('unverified', 'succeeded', {
      outputIds: ['slides.pptx'],
      finishedAt: Date.now(),
    });
    await expect(f.service.register({ ...f.input, executionId: 'unverified' })).rejects.toThrow(
      'Host-verified',
    );
    f.store.close();
  });
  it('rejects symlinks and hard links without modifying their targets', async () => {
    const f = fixture();
    const { unlink, link } = await import('node:fs/promises');
    const target = path.join(f.root, 'target.pptx');
    writeFileSync(target, 'PK-content');
    await unlink(f.file);
    await symlink(target, f.file);
    await expect(f.service.register(f.input)).rejects.toThrow('symbolic link');
    await unlink(f.file);
    await link(target, f.file);
    await expect(f.service.register(f.input)).rejects.toThrow('regular');
    f.store.close();
  });
  it('rechecks cancellation and revoked trust after asynchronous source resolution', async () => {
    const f = fixture();
    const cancellation = new FileArtifactService(
      f.store,
      temporaryDirectory(),
      async () => {
        f.store.runs.forceFailure('run-1', 'cancelled during resolution', Date.now());
        return f.file;
      },
      () => true,
      fakePptxRenderer(),
    );
    await expect(cancellation.register(f.input)).rejects.toThrow('no longer active');
    expect(f.store.artifacts.list()).toHaveLength(0);
    f.store.close();
    const g = fixture();
    const revoked = new FileArtifactService(
      g.store,
      temporaryDirectory(),
      async () => {
        g.store.skills.setTrustPreference('skill-1', 'revoked');
        return g.file;
      },
      () => true,
      fakePptxRenderer(),
    );
    await expect(revoked.register(g.input)).rejects.toThrow('no longer active');
    expect(g.store.artifacts.list()).toHaveLength(0);
    g.store.close();
  });
  it('cleans copied files if the database rejects registration', async () => {
    const f = fixture();
    const filesRoot = temporaryDirectory();
    const service = new FileArtifactService(
      f.store,
      filesRoot,
      async () => f.file,
      () => true,
      fakePptxRenderer(),
    );
    await expect(service.register({ ...f.input, artifactId: 'missing' })).rejects.toThrow(
      'does not belong',
    );
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(filesRoot)).toEqual([]);
    f.store.close();
  });
});

describe('slide previews', () => {
  it('renders the deck on demand, names cached pages by slide index, and reuses them', async () => {
    const f = fixture();
    const registered = await f.service.register(f.input);

    const first = await f.service.generateThumbnails(registered.versionId);
    expect(first.error).toBeUndefined();
    expect(first.thumbnails.map((thumb) => thumb.slideIndex)).toEqual([0, 1]);
    expect(first.thumbnails[0]?.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(readdirSync(path.join(f.filesRoot, registered.versionId, 'thumbnails')).sort()).toEqual([
      '.revision',
      'slide-0.png',
      'slide-1.png',
    ]);

    const second = await f.service.generateThumbnails(registered.versionId);
    expect(second.thumbnails).toEqual(first.thumbnails);
    // 命中缓存不得重算：预览是 CPU 密集的派生缓存，可重建但不是每次查看都重渲染。
    expect(f.renderer.calls).toHaveLength(1);
    f.store.close();
  });

  it('reports render failures without leaving a partial cache behind', async () => {
    const f = fixture(failingPptxRenderer('missing CJK font'));
    const registered = await f.service.register(f.input);

    const result = await f.service.generateThumbnails(registered.versionId);
    expect(result.thumbnails).toEqual([]);
    expect(result.error).toContain('missing CJK font');
    expect(existsSync(path.join(f.filesRoot, registered.versionId, 'thumbnails'))).toBe(false);
    f.store.close();
  });

  it('treats a zero-page render as an error instead of caching an empty preview', async () => {
    const f = fixture(emptyPptxRenderer());
    const registered = await f.service.register(f.input);

    const result = await f.service.generateThumbnails(registered.versionId);
    expect(result.error).toContain('未能从该文件渲染出任何页面');
    // 空结果不能落盘：否则下一次请求会把它当成有效缓存直接返回。
    expect(readdirSync(path.join(f.filesRoot, registered.versionId))).toEqual(['output']);
    f.store.close();
  });

  it('asks the user to open externally when the stored file is gone, without rendering', async () => {
    const f = fixture();
    const registered = await f.service.register(f.input);
    rmSync(f.service.resolveStoredPath(registered.versionId));

    const result = await f.service.generateThumbnails(registered.versionId);
    expect(result.error).toContain('成果文件不存在');
    expect(f.renderer.calls).toHaveLength(0);
    f.store.close();
  });

  // 渲染语义变了（本地补丁、字体映射、几何处理）而成果文件本身没变，是预览缺陷最难发现的一种
  // 残留：修好了渲染器，用户打开还是旧图。缓存只按 versionId 键控接不到这个信号，
  // 所以由渲染器携带 previewRevision，不一致就整目录作废。
  it('discards cached pages left behind by a different renderer revision', async () => {
    const f = fixture();
    const registered = await f.service.register(f.input);
    await f.service.generateThumbnails(registered.versionId);
    expect(f.renderer.calls).toHaveLength(1);

    const thumbDir = path.join(f.filesRoot, registered.versionId, 'thumbnails');
    const upgraded = openService(
      f.filesRoot,
      async () => f.file,
      fakePptxRenderer({ previewRevision: f.renderer.previewRevision + 1 }),
    );
    const result = await upgraded.service.generateThumbnails(registered.versionId);

    expect(result.error).toBeUndefined();
    expect(upgraded.renderer.calls).toHaveLength(1);
    // 重建后标记写的是新版本，不会每进一次页面都重渲染一次。
    expect(readFileSync(path.join(thumbDir, '.revision'), 'utf8').trim()).toBe(
      String(f.renderer.previewRevision + 1),
    );
    const third = await upgraded.service.generateThumbnails(registered.versionId);
    expect(third.thumbnails).toEqual(result.thumbnails);
    expect(upgraded.renderer.calls).toHaveLength(1);
    f.store.close();
    upgraded.store.close();
  });

  it('discards a cache directory that carries no renderer revision marker', async () => {
    const f = fixture();
    const registered = await f.service.register(f.input);
    await f.service.generateThumbnails(registered.versionId);

    // 引入标记之前已经存在的缓存就是这样：图在、没有版本可判，只能当无效处理。
    rmSync(path.join(f.filesRoot, registered.versionId, 'thumbnails', '.revision'));

    const listed = f.service.listThumbnails(registered.versionId);
    expect(listed).toEqual([]);
    expect(existsSync(path.join(f.filesRoot, registered.versionId, 'thumbnails'))).toBe(false);

    const regenerated = await f.service.generateThumbnails(registered.versionId);
    expect(regenerated.error).toBeUndefined();
    expect(regenerated.thumbnails).toHaveLength(2);
    expect(f.renderer.calls).toHaveLength(2);
    f.store.close();
  });
});
