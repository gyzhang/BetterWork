import { isAbortError, type ToolExecutionContext } from '@betterwork/agent-core';
import { type ArtifactInputRelationInput } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import { createArtifactDeclareSourcesTool } from './artifact-declare-sources';

const input: ArtifactInputRelationInput = {
  input: {
    kind: 'knowledge-revision',
    knowledgeDocumentId: 'doc-1',
    knowledgeRevisionId: 'rev-1',
    contentHash: 'hash-1',
    sourcePath: '/notes/资料.md',
  },
  relation: 'data',
};

const context = (aborted = false): ToolExecutionContext => ({
  runId: 'run-1',
  toolCallId: 'call-1',
  workspacePath: '/tmp',
  signal: { aborted } as AbortSignal,
  reportProgress: () => undefined,
});

describe('artifact_declare_sources', () => {
  it('把当前 Run 的 runId 交给宿主校验，并原样转交声明内容', async () => {
    const seen: Array<readonly ArtifactInputRelationInput[]> = [];
    const tool = createArtifactDeclareSourcesTool(async (inputs) => {
      seen.push(inputs);
    });
    await expect(tool.execute({ inputRelations: [input] }, context())).resolves.toMatchObject({
      declaredCount: 1,
    });
    expect(seen[0]).toEqual([input]);
  });

  it('空数组是主动清除声明，仍然转交给宿主', async () => {
    const seen: Array<readonly ArtifactInputRelationInput[]> = [];
    const tool = createArtifactDeclareSourcesTool(async (inputs) => {
      seen.push(inputs);
    });
    await expect(tool.execute({ inputRelations: [] }, context())).resolves.toMatchObject({
      declaredCount: 0,
      message: '已清除采用来源声明。',
    });
    expect(seen[0]).toEqual([]);
  });

  it('模型不能替别的 Run 声明：runId 只取工具执行上下文', async () => {
    const tool = createArtifactDeclareSourcesTool(() => undefined);
    await expect(
      tool.execute({ runId: 'forged-run', inputRelations: [input] }, context()),
    ).rejects.toThrow();
  });

  it('取消后不登记声明', async () => {
    let called = 0;
    const tool = createArtifactDeclareSourcesTool(() => {
      called += 1;
    });
    await expect(tool.execute({ inputRelations: [input] }, context(true))).rejects.toSatisfy(
      isAbortError,
    );
    expect(called).toBe(0);
  });

  it('工具 JSON Schema 覆盖四种输入种类与全部关系枚举', () => {
    const tool = createArtifactDeclareSourcesTool(() => undefined);
    const schema = JSON.stringify(tool.inputSchema);
    for (const kind of [
      'knowledge-revision',
      'artifact-version',
      'workspace-input-snapshot',
      'evidence',
    ]) {
      expect(schema).toContain(kind);
    }
    for (const relation of [
      'data',
      'rule',
      'comparison',
      'structure',
      'template',
      'background',
      'other',
    ]) {
      expect(schema).toContain(relation);
    }
  });
});
