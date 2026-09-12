import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { RegisterFileArtifactResult, ValidationState } from '@betterwork/agent-protocol';

import { hashBytes, readManagedFile } from '../infrastructure/managed-files';
import type { AppStore } from '../persistence';

const execFileAsync = promisify(execFile);

export type ArtifactFileSourceResolver = (executionId: string, outputId: string) => Promise<string>;

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

  /** 缩略图目录路径 */
  private thumbnailDir(versionId: string): string {
    return path.join(this.artifactFilesRoot, versionId, 'thumbnails');
  }

  /** 列出已有缩略图，返回按 slideIndex 排序的列表 */
  listThumbnails(versionId: string): { slideIndex: number; filePath: string }[] {
    const dir = this.thumbnailDir(versionId);
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter((f) => f.startsWith('slide-') && f.endsWith('.png'));
    return files
      .map((f) => {
        const match = /^slide-(\d+)\.png$/.exec(f);
        if (!match || !match[1]) return null;
        const idx = Number.parseInt(match[1], 10);
        return { slideIndex: idx, filePath: path.join(dir, f) };
      })
      .filter((t): t is { slideIndex: number; filePath: string } => t !== null)
      .sort((a, b) => a.slideIndex - b.slideIndex);
  }

  /**
   * 懒生成 PPTX 缩略图。
   * 使用 LibreOffice headless 将 PPTX 转为 PNG，输出到 thumbnails/ 目录。
   * 如果 LibreOffice 不可用，返回空列表并附带错误信息。
   */
  async generateThumbnails(versionId: string): Promise<{
    thumbnails: { slideIndex: number; filePath: string }[];
    error?: string;
  }> {
    const existing = this.listThumbnails(versionId);
    if (existing.length > 0) return { thumbnails: existing };

    const pptxPath = this.resolveStoredPath(versionId);
    if (!existsSync(pptxPath)) return { thumbnails: [], error: 'PPTX 文件不存在' };

    const sofficePath = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
    if (!existsSync(sofficePath)) {
      return {
        thumbnails: [],
        error: 'LibreOffice 未安装，无法生成预览。请从 libreoffice.org 下载安装。',
      };
    }

    const thumbDir = this.thumbnailDir(versionId);
    mkdirSync(thumbDir, { recursive: true });

    const tmpDir = path.join(this.artifactFilesRoot, versionId, '.tmp-convert');
    mkdirSync(tmpDir, { recursive: true });

    try {
      await execFileAsync(sofficePath, [
        '--headless',
        '--convert-to',
        'png',
        '--outdir',
        tmpDir,
        pptxPath,
      ]);

      const converted = readdirSync(tmpDir)
        .filter((f) => f.endsWith('.png'))
        .sort();

      for (let i = 0; i < converted.length; i++) {
        const srcFile = converted[i];
        if (!srcFile) continue;
        const src = path.join(tmpDir, srcFile);
        const dest = path.join(thumbDir, `slide-${i}.png`);
        renameSync(src, dest);
      }

      return { thumbnails: this.listThumbnails(versionId) };
    } catch (error) {
      rmSync(thumbDir, { recursive: true, force: true });
      const message = error instanceof Error ? error.message : String(error);
      return { thumbnails: [], error: `缩略图生成失败：${message}` };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}
