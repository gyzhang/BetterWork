import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import type { RegisterFileArtifactResult, ValidationState } from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';

export type ArtifactFileSourceResolver = (executionId: string, outputId: string) => Promise<string>;

export interface RegisterFileServiceInput {
  runId: string;
  executionId: string;
  outputId: string;
  artifactId?: string;
  title: string;
  mimeType: string;
  description?: string;
  validation: ValidationState;
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

    const stat = await lstat(sourcePath);
    if (!stat.isFile()) {
      throw new Error('Output path is not a regular file');
    }

    const fileBuffer = await readFile(sourcePath);
    const fileHash = createHash('sha256').update(fileBuffer).digest('hex');
    const fileSize = stat.size;

    const versionId = randomUUID();
    const fileKey = `${input.executionId}/${input.outputId}`;

    const destDir = path.join(this.artifactFilesRoot, versionId);
    const destPath = path.join(destDir, 'output');
    await mkdir(destDir, { recursive: true });
    await copyFile(sourcePath, destPath);

    try {
      return this.store.artifacts.registerFile({
        taskId,
        ...(input.artifactId ? { artifactId: input.artifactId } : {}),
        versionId,
        title: input.title,
        runId: input.runId,
        mimeType: input.mimeType,
        fileSize,
        fileHash,
        fileKey,
        executionId: input.executionId,
        ...(input.description ? { description: input.description } : {}),
        validation: input.validation,
      });
    } catch (error) {
      await this.removeQuietly(destPath);
      await this.removeQuietly(destDir);
      throw error;
    }
  }

  resolveStoredPath(versionId: string): string {
    return path.join(this.artifactFilesRoot, versionId, 'output');
  }

  private async removeQuietly(target: string): Promise<void> {
    try {
      await rm(target, { force: true });
    } catch {
      // cleanup is best-effort
    }
  }
}
