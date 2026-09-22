export type AppView = 'work' | 'artifacts' | 'knowledge' | 'skills' | 'experts' | 'settings';
/**
 * 上下文面板页签（docs/10 §6.1.3、§6.2）：
 * 记忆页签承载「下次运行可用 / 本次运行记忆 / 历史上下文调整」三段，
 * 简报页签承载工作空间简报——两者都在同一个可关闭面板里，不新增一级导航。
 */
export type ContextTab = 'process' | 'sources' | 'memory' | 'brief' | 'artifacts';
export type SettingsTab = 'models' | 'search' | 'mcp' | 'memory' | 'appearance' | 'general';
