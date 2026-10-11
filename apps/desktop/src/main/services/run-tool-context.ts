import type { AgentTool } from '@betterwork/agent-core';
import {
  type ArtifactFileRegistrar,
  type ArtifactReader,
  type ArtifactSourceDeclarator,
  type BusinessMetricFactsValidator,
  calculatorTool,
  createArtifactDeclareSourcesTool,
  createArtifactReadTool,
  createArtifactRegisterFileTool,
  createBusinessMetricsTool,
  createKnowledgeReadTool,
  createKnowledgeSearchTool,
  createReadOfficeMaterialTool,
  createReadTextFileTool,
  createSkillExecuteTool,
  createSkillReadResourceTool,
  createTaskWriteFileTool,
  createWebFetchTool,
  createWebSearchTool,
  type KnowledgeRunRead,
  type KnowledgeSearch,
  type OfficeMaterialReader,
  type ReadTextFile,
  readTextFileTool,
  type SkillCommandExecuteInput,
  type SkillCommandExecuteOutput,
  type SkillResourceReadInput,
  type SkillResourceReadOutput,
  type TaskFileWriteInput,
  type TaskFileWriteOutput,
  type WebFetch,
  type WebSearch,
} from '@betterwork/tool-runtime';

export interface RunToolFactoryDependencies {
  knowledgeSearch: KnowledgeSearch;
  readKnowledge?: KnowledgeRunRead;
  readTextFile?: ReadTextFile;
  artifactReader?: ArtifactReader;
  webSearch?: WebSearch;
  webFetch?: WebFetch;
  officeMaterialReader?: OfficeMaterialReader;
  allowedBuiltinToolNames?: ReadonlySet<string>;
  businessMetricFactsValidator?: BusinessMetricFactsValidator;
  skillResourceReader?: (input: SkillResourceReadInput) => Promise<SkillResourceReadOutput>;
  taskFileWriter?: (input: TaskFileWriteInput) => Promise<TaskFileWriteOutput>;
  skillCommandExecutor?: (input: SkillCommandExecuteInput) => Promise<SkillCommandExecuteOutput>;
  artifactFileRegistrar?: ArtifactFileRegistrar;
  artifactSourceDeclarator?: ArtifactSourceDeclarator;
  mcpTools?: AgentTool[];
}

export interface RunToolContextPolicy {
  materialScope: boolean;
  hasSkillBindings: boolean;
}

/** 动态宿主服务；作用域门控由本模块应用后再交给基础工具工厂。 */
export interface RunToolContextSources extends Omit<
  RunToolFactoryDependencies,
  'readTextFile' | 'mcpTools'
> {
  createScopedReadTextFile?: () => ReadTextFile;
  mcpTools?: readonly AgentTool[];
}

/**
 * 组装一次 Run 可用的工具集。
 * `web_search` 只在存在已启用且配置了 Key 的搜索引擎时注册——
 * 给模型一个必然失败的工具只会浪费一轮调用。
 *
 * Skill 工具只在提供对应依赖时注册：无绑定的 Run 不需要它们。
 */
export const createRunTools = (dependencies: RunToolFactoryDependencies): AgentTool[] => {
  const allows = (name: string): boolean =>
    !dependencies.allowedBuiltinToolNames || dependencies.allowedBuiltinToolNames.has(name);
  const tools: AgentTool[] = [];
  if (allows(calculatorTool.name)) tools.push(calculatorTool);
  if (allows('analyze_business_metrics'))
    tools.push(createBusinessMetricsTool(dependencies.businessMetricFactsValidator));
  if (allows(readTextFileTool.name)) {
    tools.push(
      dependencies.readTextFile
        ? createReadTextFileTool(dependencies.readTextFile)
        : readTextFileTool,
    );
  }
  if (allows('knowledge_search'))
    tools.push(createKnowledgeSearchTool(dependencies.knowledgeSearch));
  if (dependencies.readKnowledge && allows('read_knowledge'))
    tools.push(createKnowledgeReadTool(dependencies.readKnowledge));
  if (dependencies.artifactSourceDeclarator && allows('artifact_declare_sources'))
    tools.push(createArtifactDeclareSourcesTool(dependencies.artifactSourceDeclarator));
  if (dependencies.artifactReader && allows('read_artifact'))
    tools.push(createArtifactReadTool(dependencies.artifactReader));
  if (dependencies.webSearch && allows('web_search'))
    tools.push(createWebSearchTool(dependencies.webSearch));
  if (dependencies.webFetch && allows('web_fetch'))
    tools.push(createWebFetchTool(dependencies.webFetch));
  if (dependencies.officeMaterialReader && allows('read_office_material'))
    tools.push(createReadOfficeMaterialTool(dependencies.officeMaterialReader));
  if (dependencies.skillResourceReader)
    tools.push(createSkillReadResourceTool(dependencies.skillResourceReader));
  if (dependencies.taskFileWriter) tools.push(createTaskWriteFileTool(dependencies.taskFileWriter));
  if (dependencies.skillCommandExecutor)
    tools.push(createSkillExecuteTool(dependencies.skillCommandExecutor));
  if (dependencies.artifactFileRegistrar)
    tools.push(createArtifactRegisterFileTool(dependencies.artifactFileRegistrar));
  if (dependencies.mcpTools) tools.push(...dependencies.mcpTools);
  return tools;
};

export const createRunToolContext = (
  policy: RunToolContextPolicy,
  sources: RunToolContextSources,
): AgentTool[] =>
  createRunTools({
    knowledgeSearch: sources.knowledgeSearch,
    ...(sources.readKnowledge ? { readKnowledge: sources.readKnowledge } : {}),
    ...(policy.materialScope && sources.createScopedReadTextFile
      ? { readTextFile: sources.createScopedReadTextFile() }
      : {}),
    ...(policy.materialScope && sources.artifactReader
      ? { artifactReader: sources.artifactReader }
      : {}),
    ...(sources.webSearch ? { webSearch: sources.webSearch } : {}),
    ...(sources.webFetch ? { webFetch: sources.webFetch } : {}),
    ...(policy.materialScope && sources.officeMaterialReader
      ? { officeMaterialReader: sources.officeMaterialReader }
      : {}),
    ...(sources.allowedBuiltinToolNames
      ? { allowedBuiltinToolNames: sources.allowedBuiltinToolNames }
      : {}),
    ...(sources.businessMetricFactsValidator
      ? { businessMetricFactsValidator: sources.businessMetricFactsValidator }
      : {}),
    ...(policy.hasSkillBindings && sources.skillResourceReader
      ? { skillResourceReader: sources.skillResourceReader }
      : {}),
    ...(policy.hasSkillBindings && sources.taskFileWriter
      ? { taskFileWriter: sources.taskFileWriter }
      : {}),
    ...(policy.hasSkillBindings && sources.skillCommandExecutor
      ? { skillCommandExecutor: sources.skillCommandExecutor }
      : {}),
    ...(policy.hasSkillBindings && sources.artifactFileRegistrar
      ? { artifactFileRegistrar: sources.artifactFileRegistrar }
      : {}),
    ...(sources.artifactSourceDeclarator
      ? { artifactSourceDeclarator: sources.artifactSourceDeclarator }
      : {}),
    ...(sources.mcpTools && sources.mcpTools.length > 0 ? { mcpTools: [...sources.mcpTools] } : {}),
  });
