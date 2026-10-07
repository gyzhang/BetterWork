import { randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import type {
  ArtifactInputRelationInput,
  ArtifactThumbnail,
  RegisterFileArtifactResult,
  ValidationState,
} from '@betterwork/agent-protocol';

import { hashBytes, managedPath, readManagedFile } from '../infrastructure/managed-files';
import type { PptxRenderer, RenderedSlide } from '../infrastructure/pptx-renderer';
import type { AppStore } from '../persistence';
import { fileArtifactExtensionForMimeType } from './file-artifact-format';

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && 'code' in error && error.code === code;

const cleanFilenamePart = (value: string): string => {
  const cleaned = Array.from(value.normalize('NFC'), (character) => {
    const codePoint = character.codePointAt(0);
    const isControl =
      codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f));
    return isControl || '/\\:<>?*"|'.includes(character) ? '_' : character;
  })
    .join('')
    .replace(/\s+/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^[._]+|[._]+$/gu, '');
  return Array.from(cleaned || '未命名')
    .slice(0, 60)
    .join('');
};

const workspaceFilename = (
  title: string,
  versionNumber: number,
  extension: string,
  collisionIndex: number,
): string => {
  const titleWithoutExtension = title.replace(new RegExp(`\\.${extension}$`, 'iu'), '');
  const suffix = collisionIndex > 1 ? `-${collisionIndex}` : '';
  return `${cleanFilenamePart(titleWithoutExtension)}-v${versionNumber}${suffix}.${extension}`;
};

const fileMatchesHash = (
  workspaceRoot: string,
  relativePath: string,
  fileHash: string,
): boolean => {
  try {
    return hashBytes(readManagedFile(workspaceRoot, relativePath)) === fileHash;
  } catch {
    return false;
  }
};

export type ArtifactFileSourceResolver = (executionId: string, outputId: string) => Promise<string>;

/** 幻灯片预览的生成结果；失败以 `error` 返回，让界面保留「打开」通路并解释原因。 */
export interface SlidePreviewResult {
  thumbnails: ArtifactThumbnail[];
  error?: string;
}

export interface RegisterFileServiceInput {
  runId: string;
  executionId: string;
  outputId: string;
  artifactId?: string;
  title: string;
  mimeType?: string;
  description?: string;
  validation?: ValidationState;
  /** 显式声明即 model；省略即 none（知识契约 §6.1）。 */
  inputRelations?: ArtifactInputRelationInput[];
}

/**
 * 文件成果校验、落盘与版本登记。
 *
 * 校验执行归属、终态、输出句柄、文件真实性和 hash；
 * 复制到不可变存储后再在 DB 事务里登记版本，DB 失败时清理已复制文件。
 */
export class FileArtifactService {
  constructor(
    private readonly store: AppStore,
    private readonly artifactFilesRoot: string,
    private readonly sourceResolver: ArtifactFileSourceResolver,
    private readonly acceptsRun: (runId: string) => boolean = () => true,
    private readonly pptxRenderer: PptxRenderer,
  ) {}

  async register(input: RegisterFileServiceInput): Promise<RegisterFileArtifactResult> {
    const execution = this.store.executions.getExecution(input.executionId);
    if (!execution) throw new Error('Execution does not exist');
    if (execution.runId !== input.runId) {
      throw new Error('Execution does not belong to this run');
    }
    if (execution.status !== 'succeeded') {
      throw new Error('Only succeeded executions can register artifacts');
    }
    if (!execution.outputIds.includes(input.outputId)) {
      throw new Error('Output is not registered for this execution');
    }

    const taskId = this.store.runs.getTaskId(input.runId);
    if (!taskId) throw new Error('Run does not exist');

    const sourcePath = await this.sourceResolver(input.executionId, input.outputId);

    const run = this.store.runs.get(input.runId);
    const context = run ? this.store.tasks.getRunContext(run.taskId, run.sessionId) : undefined;
    if (!context) throw new Error('Run context is not available');
    const output = this.store.executions
      .getVerifiedOutputs(input.executionId)
      .find((entry) => entry.outputId === input.outputId);
    if (!output || output.validation.structure !== 'passed')
      throw new Error('Host-verified structure report is required');
    if (input.validation?.structure === 'failed') throw new Error('Structure validation failed');
    const fileBuffer = readManagedFile(
      context.workspacePath,
      path.relative(context.workspacePath, sourcePath),
    );
    const fileHash = hashBytes(fileBuffer);
    if (fileHash !== output.fileHash || fileBuffer.length !== output.fileSize)
      throw new Error('Output hash does not match its validation report');
    const reportPath = `${sourcePath}.report.json`;
    const report = readManagedFile(
      context.workspacePath,
      path.relative(context.workspacePath, reportPath),
    );
    if (hashBytes(report) !== output.reportHash) throw new Error('Validation report hash mismatch');
    const fileSize = fileBuffer.length;
    const fileKey = `${input.executionId}/${input.outputId}`;
    const inputRelations = input.inputRelations ?? [];
    const declarationKind = inputRelations.length > 0 ? ('model' as const) : ('none' as const);
    const versionId = randomUUID();
    const destDir = path.join(this.artifactFilesRoot, versionId);
    const destPath = path.join(destDir, 'output');
    let registered: RegisterFileArtifactResult;
    try {
      registered = this.store.transaction(() => {
        if (
          this.store.runs.get(input.runId)?.status !== 'running' ||
          !this.acceptsRun(input.runId) ||
          !this.store.executions.isBindingAuthorized(execution.bindingId)
        )
          throw new Error('Run or Skill authorization is no longer active');
        const existing = this.store.artifacts.findRegisteredFile(fileKey);
        if (existing) {
          if (input.artifactId && input.artifactId !== existing.artifactId)
            throw new Error('Output already belongs to another artifact');
          return existing;
        }
        mkdirSync(destDir, { recursive: true });
        writeFileSync(destPath, fileBuffer, { flag: 'wx', mode: 0o400 });
        const registered = this.store.artifacts.registerFile({
          taskId,
          ...(input.artifactId ? { artifactId: input.artifactId } : {}),
          versionId,
          title: input.title,
          runId: input.runId,
          mimeType:
            output.mimeType ??
            input.mimeType ??
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          fileSize,
          fileHash,
          fileKey,
          executionId: input.executionId,
          ...(input.description ? { description: input.description } : {}),
          validation: output.validation,
          sourceDeclarationKind: declarationKind,
        });
        if (inputRelations.length > 0) {
          this.store.artifactInputRelations.saveForRun(
            registered.versionId,
            input.runId,
            inputRelations,
            // 登记前已由宿主校验归属；同事务内文件与关系一起成败。
            () => true,
            'model',
          );
        }
        return registered;
      });
    } catch (error) {
      rmSync(destDir, { recursive: true, force: true });
      throw error;
    }
    try {
      await this.ensureWorkspaceCopy(
        registered.artifactId,
        registered.versionId,
        path.extname(sourcePath).slice(1),
      );
    } catch (error) {
      throw new Error(`成果已登记，但未能复制到工作空间：${describeError(error)}`, {
        cause: error,
      });
    }
    return registered;
  }

  /**
   * Ensure a visible, editable delivery copy exists in the Artifact's Workspace.
   * The internal immutable copy remains the canonical source for previews and exports.
   */
  async ensureWorkspaceCopy(
    artifactId: string,
    versionId: string,
    declaredExtension?: string,
  ): Promise<string> {
    const artifact = this.store.artifacts.getDetail(artifactId);
    if (!artifact || artifact.type !== 'presentation')
      throw new Error('File artifact does not exist');
    const version = this.store.artifacts.getVersionDetail(versionId);
    if (!version || version.artifactId !== artifactId || version.type !== 'presentation') {
      throw new Error('Artifact version does not belong to artifact');
    }
    const workspace = this.store.workspaces.get(artifact.workspaceId);
    if (!workspace) throw new Error('Artifact workspace does not exist');

    const bytes = this.readVersionBytes(versionId);
    if (bytes.length !== version.fileSize || hashBytes(bytes) !== version.fileHash) {
      throw new Error('Stored artifact does not match its registered hash');
    }
    const workspaceRoot = workspace.rootPath;
    const knownRelativePath = this.store.artifacts.getWorkspaceRelativePath(versionId);
    if (knownRelativePath) {
      const target = managedPath(workspaceRoot, knownRelativePath, true);
      if (existsSync(target)) {
        if (!lstatSync(target).isFile())
          throw new Error('Workspace delivery path is not a regular file');
        return target;
      }
      this.publishWorkspaceCopy(workspaceRoot, knownRelativePath, bytes);
      return managedPath(workspaceRoot, knownRelativePath);
    }

    const extension =
      this.safeExtension(declaredExtension) ??
      (await this.extensionFromVerifiedOutput(version.fileKey)) ??
      fileArtifactExtensionForMimeType(version.mimeType);
    for (let collisionIndex = 1; collisionIndex <= 10_000; collisionIndex += 1) {
      const relativePath = path.join(
        '成果',
        workspaceFilename(artifact.title, version.versionNumber, extension, collisionIndex),
      );
      const target = managedPath(workspaceRoot, relativePath, true);
      if (existsSync(target)) {
        if (fileMatchesHash(workspaceRoot, relativePath, version.fileHash)) {
          this.store.artifacts.setWorkspaceRelativePath(versionId, relativePath);
          return target;
        }
        continue;
      }
      try {
        this.publishWorkspaceCopy(workspaceRoot, relativePath, bytes);
      } catch (error) {
        if (hasCode(error, 'EEXIST')) continue;
        throw error;
      }
      const persistedPath = this.store.artifacts.setWorkspaceRelativePath(versionId, relativePath);
      if (persistedPath !== relativePath) {
        return this.ensureWorkspaceCopy(artifactId, versionId, declaredExtension);
      }
      return managedPath(workspaceRoot, relativePath);
    }
    throw new Error('Could not find an unused filename in the Workspace delivery folder');
  }

  resolveStoredPath(versionId: string): string {
    return path.join(this.artifactFilesRoot, versionId, 'output');
  }

  /** 按版本 ID 从不可变成果库安全读取原始文件字节，调用方仍需核对 ArtifactVersion hash。 */
  readVersionBytes(versionId: string): Buffer {
    return readManagedFile(this.artifactFilesRoot, path.join(versionId, 'output'));
  }

  private publishWorkspaceCopy(workspaceRoot: string, relativePath: string, bytes: Buffer): void {
    const target = managedPath(workspaceRoot, relativePath, true);
    const temporaryRelativePath = path.join(
      path.dirname(relativePath),
      `.betterwork-artifact-${randomUUID()}.tmp`,
    );
    const temporary = managedPath(workspaceRoot, temporaryRelativePath, true);
    try {
      writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
      managedPath(workspaceRoot, relativePath);
      linkSync(temporary, target);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  private async extensionFromVerifiedOutput(fileKey: string): Promise<string | undefined> {
    const separator = fileKey.indexOf('/');
    if (separator < 1 || separator === fileKey.length - 1) return undefined;
    try {
      const sourcePath = await this.sourceResolver(
        fileKey.slice(0, separator),
        fileKey.slice(separator + 1),
      );
      return this.safeExtension(path.extname(sourcePath).slice(1));
    } catch {
      return undefined;
    }
  }

  private safeExtension(extension: string | undefined): string | undefined {
    const normalized = extension?.replace(/^\./u, '').toLowerCase();
    return normalized && /^[a-z0-9]{1,16}$/u.test(normalized) ? normalized : undefined;
  }

  /** 派生缓存目录：随版本产生、可随时删除重建，不参与成果真实性校验。 */
  private thumbnailDir(versionId: string): string {
    return path.join(this.artifactFilesRoot, versionId, 'thumbnails');
  }

  /**
   * 缓存所属的渲染语义版本。以点开头，不会被 `slide-<n>.png` 的扫页匹配到。
   *
   * 缺失或不一致就当未命中：宁可多渲染一次，也不把旧渲染器留下的图当成有效缓存。
   */
  private readCachedRevision(versionId: string): number | undefined {
    const marker = path.join(this.thumbnailDir(versionId), '.revision');
    if (!existsSync(marker)) return undefined;
    try {
      const recorded = Number.parseInt(readFileSync(marker, 'utf8').trim(), 10);
      return Number.isFinite(recorded) ? recorded : undefined;
    } catch {
      return undefined;
    }
  }

  /** 读取已缓存的幻灯片预览。文件名即页序：`slide-<n>.png`。 */
  listThumbnails(versionId: string): ArtifactThumbnail[] {
    const dir = this.thumbnailDir(versionId);
    if (!existsSync(dir)) return [];
    if (this.readCachedRevision(versionId) !== this.pptxRenderer.previewRevision) {
      // 渲染器换过了：整目录作废，由下一次请求完整重建，不留新旧混用的残页。
      rmSync(dir, { recursive: true, force: true });
      return [];
    }
    const thumbnails: ArtifactThumbnail[] = [];
    for (const entry of readdirSync(dir)) {
      const indexed = /^slide-(\d+)\.png$/.exec(entry)?.[1];
      if (!indexed) continue;
      thumbnails.push({
        slideIndex: Number.parseInt(indexed, 10),
        dataUrl: `data:image/png;base64,${readFileSync(path.join(dir, entry)).toString('base64')}`,
      });
    }
    return thumbnails.sort((left, right) => left.slideIndex - right.slideIndex);
  }

  /**
   * 懒生成幻灯片预览：命中缓存直接返回，否则整份渲染后落盘。
   *
   * 渲染是进程内的纯 JS 计算，不拉起任何外部应用；写入失败时清掉半成品目录，
   * 让下一次请求完整重建，而不是留下缺页的缓存。
   */
  async generateThumbnails(versionId: string): Promise<SlidePreviewResult> {
    const cached = this.listThumbnails(versionId);
    if (cached.length > 0) return { thumbnails: cached };

    const pptxPath = this.resolveStoredPath(versionId);
    if (!existsSync(pptxPath)) return { thumbnails: [], error: '成果文件不存在，可能已被清理。' };

    let slides: RenderedSlide[];
    try {
      slides = await this.pptxRenderer.render(pptxPath);
    } catch (error) {
      return { thumbnails: [], error: `幻灯片预览生成失败：${describeError(error)}` };
    }
    if (slides.length === 0) {
      return { thumbnails: [], error: '未能从该文件渲染出任何页面。' };
    }

    const thumbDir = this.thumbnailDir(versionId);
    try {
      mkdirSync(thumbDir, { recursive: true });
      for (const slide of slides) {
        writeFileSync(path.join(thumbDir, `slide-${slide.slideIndex}.png`), slide.png);
      }
      // 版本标记最后写：中途崩溃只会留下无标记的目录，下次读取作废而不是当成有效缓存。
      writeFileSync(path.join(thumbDir, '.revision'), `${this.pptxRenderer.previewRevision}\n`);
    } catch (error) {
      rmSync(thumbDir, { recursive: true, force: true });
      return { thumbnails: [], error: `幻灯片预览写入失败：${describeError(error)}` };
    }
    return { thumbnails: this.listThumbnails(versionId) };
  }
}
