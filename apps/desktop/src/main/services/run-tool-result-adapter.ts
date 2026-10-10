import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import { describeError } from '@betterwork/agent-core';
import {
  materialListIdentity,
  type MaterialReference,
  type McpToolBinding,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import { type MaterialFactLedger, recordMaterialFacts } from './material-fact-policy';
import { parseRunToolResult, type RunToolResult } from './run-tool-result';

type ToolOutput<Kind extends RunToolResult['kind']> =
  Extract<RunToolResult, { kind: Kind }> extends {
    output: infer Output;
  }
    ? Output
    : never;

export interface RunToolResultContext {
  readonly runId: string;
  readonly taskId: string;
  readonly toolName: string | undefined;
  readonly output: unknown;
  readonly materialFacts: MaterialFactLedger;
  readonly markdownWrites: Map<string, string>;
}

export interface RunToolResultPorts {
  readonly store: AppStore;
  readonly getMcpBinding: (runId: string, toolName: string) => McpToolBinding | undefined;
}

/** 已持久化工具事件的宿主适配；不拥有 Run 生命周期，也不重复写知识审计。 */
export class RunToolResultAdapter {
  private readonly store: AppStore;

  constructor(private readonly ports: RunToolResultPorts) {
    this.store = ports.store;
  }

  apply(context: RunToolResultContext): void {
    const result = parseRunToolResult(context.toolName, context.output);
    switch (result.kind) {
      case 'read_text_file':
        this.readTextFile(context, result.output);
        return;
      case 'read_artifact':
        this.readArtifact(context, result.output);
        return;
      case 'read_office_material':
        this.readOfficeMaterial(context, result.output);
        return;
      case 'knowledge_search':
        recordMaterialFacts(context.materialFacts, {
          kind: 'material-read',
          content: result.output.results.map((item) => item.excerpt).join('\n'),
        });
        this.assertAuditedKnowledgeEvidence(
          context.runId,
          result.output.results.map((item) => item.evidenceId),
        );
        return;
      case 'read_knowledge':
        recordMaterialFacts(context.materialFacts, {
          kind: 'material-read',
          content: result.output.parts.map((part) => part.text).join('\n'),
        });
        this.assertAuditedKnowledgeEvidence(
          context.runId,
          result.output.parts.map((part) => part.evidenceId),
        );
        return;
      case 'analyze_business_metrics':
        recordMaterialFacts(context.materialFacts, {
          kind: 'deterministic-result',
          content: serializeToolOutput(result.output),
        });
        return;
      case 'task_write_file':
        if (path.extname(result.output.path).toLowerCase() === '.md')
          context.markdownWrites.set(result.output.path, result.output.contentHash);
        return;
      case 'web_search':
        this.webSearch(context, result.output);
        return;
      case 'web_fetch':
        this.webFetch(context, result.output);
        return;
      case 'mcp':
        this.mcp(context, result.toolName, result.output);
        return;
      case 'no-additional-effects':
        return;
    }
  }

  private readTextFile(context: RunToolResultContext, output: ToolOutput<'read_text_file'>): void {
    if (output.scope === 'run-work-file') return;
    recordMaterialFacts(context.materialFacts, {
      kind: 'material-read',
      content: output.sections?.map((section) => section.content).join('\n') ?? output.content,
    });
    const { runId } = context;
    const snapshot = this.store.runContextSnapshots.get(runId);
    if (!snapshot) return;
    const exactMaterial = output.material;
    const material = exactMaterial
      ? snapshot.materials.find(
          (selection) =>
            materialListIdentity(selection.reference) === materialListIdentity(exactMaterial),
        )?.reference
      : snapshot.materials
          .filter((selection) => selection.reference.kind === 'workspace-input-snapshot')
          .map((selection) => selection.reference)
          .find((reference) => {
            if (reference.kind !== 'workspace-input-snapshot') return false;
            const snapshotRecord = this.store.inputSnapshots.get(reference.snapshotId);
            return (
              snapshotRecord !== undefined &&
              path.normalize(snapshotRecord.sourcePath) === path.normalize(output.path)
            );
          });
    if (
      material?.kind === 'workspace-input-snapshot' &&
      (!output.contentHash || output.contentHash === material.contentHash)
    ) {
      if (output.sections) {
        if (output.sections.length === 0) {
          this.saveMaterialRead(
            runId,
            material,
            'parse',
            'document',
            output.contentHash ?? material.contentHash,
            '',
          );
          return;
        }
        for (const section of output.sections) {
          this.saveMaterialRead(
            runId,
            material,
            'parse',
            section.locator,
            output.contentHash ?? material.contentHash,
            section.content,
          );
        }
        return;
      }
      this.saveMaterialRead(
        runId,
        material,
        'read',
        output.path,
        material.contentHash,
        output.content,
      );
    }
    return;
  }

  private readArtifact(context: RunToolResultContext, output: ToolOutput<'read_artifact'>): void {
    recordMaterialFacts(context.materialFacts, { kind: 'material-read', content: output.content });
    const { runId } = context;
    const snapshot = this.store.runContextSnapshots.get(runId);
    if (!snapshot) return;
    const material = snapshot.materials.find(
      (selection) =>
        selection.reference.kind === 'artifact-version' &&
        selection.reference.artifactId === output.artifactId &&
        selection.reference.artifactVersionId === output.versionId &&
        selection.reference.contentHash === output.contentHash,
    )?.reference;
    if (material) {
      this.saveMaterialRead(
        runId,
        material,
        'read',
        `artifact-version:${output.versionId}`,
        output.contentHash,
        output.content,
      );
    }
    return;
  }

  private readOfficeMaterial(
    context: RunToolResultContext,
    output: ToolOutput<'read_office_material'>,
  ): void {
    recordMaterialFacts(context.materialFacts, {
      kind: 'material-read',
      content: JSON.stringify(output.sections.map((section) => officeFactValues(section.content))),
    });
    const { runId } = context;
    const snapshot = this.store.runContextSnapshots.get(runId);
    if (!snapshot) return;
    const selectedMaterial = snapshot.materials.find(
      (selection) =>
        materialListIdentity(selection.reference) === materialListIdentity(output.material),
    )?.reference;
    if (!selectedMaterial) return;
    const sections = output.sections;
    if (sections.length === 0) {
      this.saveMaterialRead(
        runId,
        selectedMaterial,
        'parse',
        'document',
        output.contentHash,
        'Office 材料未产生可读取片段。',
      );
      return;
    }
    for (const section of sections) {
      const excerpt = JSON.stringify(section.content).slice(0, 20_000);
      this.saveMaterialRead(
        runId,
        selectedMaterial,
        'parse',
        section.locator,
        output.contentHash,
        excerpt,
      );
    }
  }

  private webSearch(context: RunToolResultContext, output: ToolOutput<'web_search'>): void {
    const { runId, taskId } = context;
    for (const result of output.results) {
      if (!result.url) continue;
      this.store.evidence.saveWeb({
        taskId,
        runId,
        sourceUri: result.url,
        title: result.title,
        locator: result.site || '网页',
        excerpt: result.snippet,
        contentHash: createHash('sha256').update(`${result.url}\n${result.snippet}`).digest('hex'),
      });
    }
  }

  private webFetch(context: RunToolResultContext, output: ToolOutput<'web_fetch'>): void {
    const { runId, taskId } = context;
    this.store.evidence.saveWeb({
      taskId,
      runId,
      sourceUri: output.url,
      title: output.title,
      locator: `${output.contentType} · HTTP ${output.status}`,
      excerpt: output.content.slice(0, 2_000),
      contentHash: createHash('sha256').update(`${output.url}\n${output.content}`).digest('hex'),
    });
    return;
  }

  private mcp(context: RunToolResultContext, toolName: string, output: unknown): void {
    const { runId, taskId } = context;
    const binding = this.ports.getMcpBinding(runId, toolName);
    if (!binding) return;
    const sourceUri = `mcp:${binding.connectionId}/${binding.toolId}`;
    const excerpt = serializeToolOutput(output).slice(0, 2_000);
    this.store.evidence.saveMcp({
      taskId,
      runId,
      sourceUri,
      title: toolName,
      locator: `MCP 工具结果；配置修订 ${binding.connectionRevisionId ?? 'legacy'}；合同 ${binding.contractHash ?? 'legacy'}`,
      excerpt,
      contentHash: createHash('sha256').update(`${sourceUri}\n${excerpt}`).digest('hex'),
    });
  }

  private assertAuditedKnowledgeEvidence(runId: string, evidenceIds: (string | undefined)[]): void {
    for (const evidenceId of evidenceIds) {
      if (!evidenceId) continue;
      if (this.store.evidence.get(evidenceId)?.runId !== runId) {
        throw new Error('Knowledge evidence does not belong to this run');
      }
    }
  }

  private saveMaterialRead(
    runId: string,
    material: MaterialReference,
    operation: 'search' | 'read' | 'parse',
    locator: string,
    contentHash: string,
    excerpt: string,
  ): void {
    this.store.materialReads.save({
      id: randomUUID(),
      runId,
      material,
      operation,
      locator,
      contentHash,
      excerptHash: createHash('sha256').update(excerpt).digest('hex'),
      capturedAt: Date.now(),
    });
  }
}

const serializeToolOutput = (output: unknown): string => {
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output) ?? 'undefined';
  } catch (error) {
    return `MCP 工具结果无法序列化：${describeError(error)}`;
  }
};

const officeFactValues = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(officeFactValues);
  if (!isRecord(value)) return value;
  if ('value' in value) return officeFactValues(value.value);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'address' && key !== 'locator')
      .map(([key, child]) => [key, officeFactValues(child)]),
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
