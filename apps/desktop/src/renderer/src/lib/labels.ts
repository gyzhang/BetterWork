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
