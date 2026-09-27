import type {
  KnowledgeDocumentSummary,
  MaterialPurpose,
  ModelProfileInput,
  ModelProfileSummary,
  RunSummary,
  SkillEnvironmentStatus,
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
  analyze_business_metrics: '分析经营指标',
  read_text_file: '阅读资料',
  knowledge_search: '查阅个人资料',
  read_knowledge: '查阅资料正文',
  artifact_declare_sources: '声明采用来源',
  web_search: '搜索网络资料',
  web_fetch: '阅读网页正文',
  read_office_material: '读取 Office 材料',
  skill_read_resource: '读取技能资源',
  task_write_file: '写入任务文件',
  skill_execute: '执行技能命令',
};

export const FALLBACK_TOOL_LABEL = '处理工作材料';

export const toolStageLabel = (name: string | undefined): string =>
  (name ? TOOL_LABELS[name] : undefined) ?? FALLBACK_TOOL_LABEL;

/**
 * 材料用途的中文口径。输入框的材料选择器与任务上下文面板此前各写一份（七项全同），
 * 改一处就会让同一个用途在两个界面里叫不同名字。
 */
export const materialPurposeName: Record<MaterialPurpose, string> = {
  rule: '规则口径',
  'current-input': '本期输入',
  'historical-comparison': '历史对比',
  'structure-reference': '结构参考',
  template: '模板',
  background: '背景参考',
  other: '其他',
};

/** 资料来源检查结果（docs/04 只读索引治理）；知识卡片与知识页详情此前各写一份。 */
export const knowledgeSourceStateName: Record<KnowledgeDocumentSummary['sourceStatus'], string> = {
  unchecked: '来源未检查',
  unchanged: '来源一致',
  changed: '原件已变化',
  missing: '原件缺失',
  unreadable: '原件不可读',
};

/**
 * 技能依赖环境状态。技能卡与依赖面板曾分别写「已就绪／就绪」「无效／已失效」
 * 「准备失败／失败」——同一种状态在两个界面里字面不同，是用户能直接看见的不一致。
 * 统一取本仓既有的「已＋动词」口径（已信任／已撤销／已完成）。
 */
export const skillEnvironmentName: Record<SkillEnvironmentStatus, string> = {
  unprepared: '未准备',
  preparing: '准备中',
  ready: '已就绪',
  failed: '准备失败',
  cancelled: '已取消',
  invalid: '已失效',
};

const MIME_TYPE_LABELS: Readonly<Record<string, string>> = {
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/pdf': 'PDF',
  'text/plain': 'TXT',
};

/** 格式徽标文字：未登记的 MIME 退化成子类型大写，再退化成 FILE。 */
export const fileTypeLabel = (mimeType: string): string =>
  MIME_TYPE_LABELS[mimeType] ?? mimeType.split('/').pop()?.toUpperCase() ?? 'FILE';
