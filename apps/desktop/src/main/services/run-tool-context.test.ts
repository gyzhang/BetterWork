import type { AgentTool } from '@betterwork/agent-core';
import { describe, expect, it, vi } from 'vitest';

import type { RunToolContextSources } from './run-tool-context';
import { createRunToolContext } from './run-tool-context';

const mcpTool: AgentTool = {
  name: 'mcp_lookup',
  description: 'Lookup through an MCP connection',
  inputSchema: { type: 'object' },
  execute: async () => ({ content: [] }),
};

const createSources = () => {
  const createScopedReadTextFile = vi.fn(() => async () => {
    throw new Error('test callback must not execute');
  });
  const sources: RunToolContextSources = {
    knowledgeSearch: async () => [],
    createScopedReadTextFile,
    artifactReader: async () => {
      throw new Error('test callback must not execute');
    },
    officeMaterialReader: async (input) => ({ sourceKind: input.sourceKind }),
    skillResourceReader: async () => {
      throw new Error('test callback must not execute');
    },
    taskFileWriter: async () => {
      throw new Error('test callback must not execute');
    },
    skillCommandExecutor: async () => {
      throw new Error('test callback must not execute');
    },
    artifactFileRegistrar: async () => {
      throw new Error('test callback must not execute');
    },
    mcpTools: [mcpTool],
  };
  return { sources, createScopedReadTextFile };
};

describe('createRunToolContext', () => {
  it('omits material-scoped and Skill tools outside their Run scopes', () => {
    const { sources, createScopedReadTextFile } = createSources();

    const names = createRunToolContext(
      { materialScope: false, hasSkillBindings: false },
      sources,
    ).map((tool) => tool.name);

    expect(names).toContain('read_text_file');
    expect(names).not.toContain('read_artifact');
    expect(names).not.toContain('read_office_material');
    expect(names).not.toContain('skill_read_resource');
    expect(names).not.toContain('task_write_file');
    expect(names).not.toContain('skill_execute');
    expect(names).not.toContain('artifact_register_file');
    expect(names).toContain('mcp_lookup');
    expect(createScopedReadTextFile).not.toHaveBeenCalled();
  });

  it('creates the scoped file reader only when a material scope is active', () => {
    const { sources, createScopedReadTextFile } = createSources();

    const names = createRunToolContext(
      { materialScope: true, hasSkillBindings: false },
      sources,
    ).map((tool) => tool.name);

    expect(names).toContain('read_artifact');
    expect(names).toContain('read_office_material');
    expect(createScopedReadTextFile).toHaveBeenCalledOnce();
  });

  it('keeps bound Skill and MCP tools outside the built-in Expert allow-list', () => {
    const { sources } = createSources();

    const names = createRunToolContext(
      { materialScope: false, hasSkillBindings: true },
      { ...sources, allowedBuiltinToolNames: new Set() },
    ).map((tool) => tool.name);

    expect(names).toContain('skill_read_resource');
    expect(names).toContain('task_write_file');
    expect(names).toContain('skill_execute');
    expect(names).toContain('artifact_register_file');
    expect(names).toContain('mcp_lookup');
    expect(names).not.toContain('calculator');
    expect(names).not.toContain('knowledge_search');
  });
});
