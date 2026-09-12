import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type {
  ArtifactThumbnail,
  RegisterFileArtifactResult,
  ValidationState,
} from '@betterwork/agent-protocol';

import { hashBytes, readManagedFile } from '../infrastructure/managed-files';
import type { PptxRenderer, RenderedSlide } from '../infrastructure/pptx-renderer';
import type { AppStore } from '../persistence';

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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
    const versionId = randomUUID();
    const destDir = path.join(this.artifactFilesRoot, versionId);
    const destPath = path.join(destDir, 'output');
    try {
      return this.store.transaction(() => {
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
        return this.store.artifacts.registerFile({
          taskId,
          ...(input.artifactId ? { artifactId: input.artifactId } : {}),
          versionId,
          title: input.title,
          runId: input.runId,
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          fileSize,
          fileHash,
          fileKey,
          executionId: input.executionId,
          ...(input.description ? { description: input.description } : {}),
          validation: output.validation,
        });
      });
    } catch (error) {
      rmSync(destDir, { recursive: true, force: true });
      throw error;
    }
  }

  resolveStoredPath(versionId: string): string {
    return path.join(this.artifactFilesRoot, versionId, 'output');
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
