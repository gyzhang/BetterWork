import type {
  ModelProfileInput,
  ModelProfileSummary,
  RunSummary,
} from '@betterwork/agent-protocol';

export const emptyModel: ModelProfileInput = {
  name: '',
  provider: 'openai-compatible',
  baseUrl: '',
  model: '',
  role: 'language',
  apiKey: '',
  maxContextTokens: 8192,
  maxOutputTokens: 8192,
  temperature: 0.7,
  enabled: true,
};
export const roleName: Record<ModelProfileSummary['role'], string> = {
  language: '语言',
  vision: '视觉',
  embedding: '嵌入',
};
export const runStatusName: Record<RunSummary['status'], string> = {
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已停止',
};
export const connectionStatusName: Record<ModelProfileSummary['connectionStatus'], string> = {
  untested: '尚未验证',
  connected: '连接成功',
  failed: '连接失败',
};

/**
 * 工具名到用户可读阶段名的映射，过程面板与工具卡片共用这一份。
 *
 * 新增工具时必须同步这里，否则界面会退化成通用的「处理工作材料」，
 * 用户看不出算台到底在做什么（docs/10 §11.1）。
 */
const TOOL_LABELS: Readonly<Record<string, string>> = {
  calculator: '计算数据',
  read_text_file: '阅读资料',
  knowledge_search: '查阅个人资料',
  web_search: '搜索网络资料',
};

export const FALLBACK_TOOL_LABEL = '处理工作材料';

export const toolStageLabel = (name: string | undefined): string =>
  (name ? TOOL_LABELS[name] : undefined) ?? FALLBACK_TOOL_LABEL;
