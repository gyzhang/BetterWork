import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  CreateMemoryRequest,
  ListMemoriesRequest,
  MemoryRecord,
  SetMemoryStatusRequest,
  UpdateMemoryRequest,
} from '@betterwork/agent-protocol';

import type { AppStore, MemoryReadInput } from '../persistence';

const scopeLabel = (record: MemoryRecord): string => {
  switch (record.scope.kind) {
    case 'user':
      return '用户';
    case 'workspace':
      return `工作空间 ${record.scope.workspaceId}`;
    case 'expert':
      return `专家 ${record.scope.expertId}`;
    case 'expert-workspace':
      return `专家 ${record.scope.expertId} · 工作空间 ${record.scope.workspaceId}`;
  }
};

/**
 * 记忆的产品服务层：SQLite 保存可审计真相，Markdown 仅作为可重建的只读投影。
 */
export class MemoryService {
  private readonly projectionRoot: string;
  private readonly manifestPath: string;

  constructor(
    private readonly store: AppStore,
    userDataRoot: string,
  ) {
    this.projectionRoot = path.join(userDataRoot, 'memory');
    this.manifestPath = path.join(this.projectionRoot, '.managed-manifest.json');
  }

  list(input: ListMemoriesRequest = {}): MemoryRecord[] {
    return this.store.memories.list(input);
  }

  async create(input: CreateMemoryRequest): Promise<MemoryRecord> {
    const record = this.store.memories.create(input);
    await this.rebuildProjection();
    return record;
  }

  async update(input: UpdateMemoryRequest): Promise<MemoryRecord> {
    const record = this.store.memories.update(input);
    await this.rebuildProjection();
    return record;
  }

  async setStatus(input: SetMemoryStatusRequest): Promise<MemoryRecord> {
    const record = this.store.memories.setStatus(input);
    await this.rebuildProjection();
    return record;
  }

  getApplicable(
    workspaceId: string,
    expertId?: string,
    now = Date.now(),
    excludedMemoryIds: readonly string[] = [],
  ): MemoryRecord[] {
    const excluded = new Set(excludedMemoryIds);
    return this.store.memories
      .listApplicable(workspaceId, expertId, now)
      .filter((memory) => !excluded.has(memory.id));
  }

  recordReads(reads: readonly MemoryReadInput[]): void {
    this.store.memories.recordReads(reads);
  }

  async rebuildProjection(): Promise<void> {
    const records = this.store.memories
      .list({ includeCandidates: true })
      .filter((record) => record.status !== 'deleted' && record.status !== 'candidate');
    const grouped = new Map<string, MemoryRecord[]>();
    for (const record of records) {
      const relativePath = `${this.scopePath(record)}/index.md`;
      const current = grouped.get(relativePath) ?? [];
      current.push(record);
      grouped.set(relativePath, current);
    }

    const previous = await this.readManifest();
    for (const relativePath of previous) {
      await rm(path.join(this.projectionRoot, relativePath), { force: true });
    }
    const generated: string[] = [];
    for (const [relativePath, group] of grouped) {
      const lines = [
        '# BetterWork 记忆（受管投影）',
        '',
        '> 此文件由算台根据 SQLite 记忆记录自动生成。请通过算台管理记忆，不要手工编辑。',
        '',
      ];
      for (const record of group) {
        lines.push(`## ${record.kind} · ${scopeLabel(record)}`);
        lines.push(`- 状态：${record.status}`);
        lines.push(`- 来源：${record.sourceType}${record.sourceId ? ` · ${record.sourceId}` : ''}`);
        lines.push(`- 置信度：${record.confidence}`);
        lines.push(`- 修订：${record.revision}`);
        lines.push('');
        lines.push(record.content);
        lines.push('');
      }
      const destination = path.join(this.projectionRoot, relativePath);
      const temporary = `${destination}.tmp`;
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(temporary, `${lines.join('\n')}\n`, 'utf8');
      await rename(temporary, destination);
      generated.push(relativePath);
    }
    await mkdir(this.projectionRoot, { recursive: true });
    await writeFile(`${this.manifestPath}.tmp`, JSON.stringify(generated), 'utf8');
    await rename(`${this.manifestPath}.tmp`, this.manifestPath);
  }

  private scopePath(record: MemoryRecord): string {
    switch (record.scope.kind) {
      case 'user':
        return 'user';
      case 'workspace':
        return path.join('workspaces', record.scope.workspaceId);
      case 'expert':
        return path.join('experts', record.scope.expertId);
      case 'expert-workspace':
        return path.join('expert-workspaces', record.scope.expertId, record.scope.workspaceId);
    }
  }

  private async readManifest(): Promise<string[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.manifestPath, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (value): value is string =>
          typeof value === 'string' &&
          value.endsWith('/index.md') &&
          !value.includes('..') &&
          !path.isAbsolute(value),
      );
    } catch {
      return [];
    }
  }
}
