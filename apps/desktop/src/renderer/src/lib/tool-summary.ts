import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';

/**
 * 把工具输出转成一句用户能读懂的中文摘要。
 *
 * 主界面不得直接渲染 `JSON.stringify(output)`：原始事件只能在过程详情里查看
 * （docs/10 §11.1，AGENTS.md「原始 Run 事件不得成为默认主界面的视觉中心」）。
 * 工具本身已经在输出里带了 `message` 字段时优先采用，避免两处文案各说一套。
 */

type ToolCompletedEvent = Extract<AgentRuntimeEvent, { type: 'tool.completed' }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readText = (value: unknown): string => (typeof value === 'string' ? value : '');

const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const countResults = (output: unknown): number | undefined => {
  if (!isRecord(output) || !Array.isArray(output.results)) return undefined;
  return output.results.length;
};

export function summarizeToolOutput(
  toolName: string | undefined,
  output: ToolCompletedEvent['output'],
): string {
  // 工具自带的 message 是最贴近该次执行的描述，优先采用
  const message = isRecord(output) ? readText(output.message) : '';

  switch (toolName) {
    case 'calculator': {
      if (!isRecord(output)) break;
      const expression = readText(output.expression);
      const result = readNumber(output.result);
      if (expression && result !== undefined) return `${expression} = ${result}`;
      break;
    }
    case 'read_text_file': {
      if (!isRecord(output)) break;
      const path = readText(output.path);
      if (!path) break;
      return output.truncated === true
        ? `已读取 ${path}（内容较长，只取开头部分）`
        : `已读取 ${path}`;
    }
    case 'knowledge_search': {
      if (message) return message;
      const found = countResults(output);
      return found === undefined ? '已检索个人资料库' : `找到 ${found} 份相关资料`;
    }
    case 'web_search': {
      if (message) return message;
      const found = countResults(output);
      return found === undefined ? '已完成联网搜索' : `搜索到 ${found} 条网页结果`;
    }
    case 'skill_read_resource': {
      if (message) return message;
      if (!isRecord(output)) break;
      const resourcePath = readText(output.relativePath);
      return resourcePath ? `已读取 ${resourcePath}` : '已读取技能资源';
    }
    case 'task_write_file': {
      if (message) return message;
      if (!isRecord(output)) break;
      const filePath = readText(output.relativePath);
      if (!filePath) break;
      return output.created === true ? `已创建 ${filePath}` : `已更新 ${filePath}`;
    }
    case 'skill_execute': {
      if (message) return message;
      if (!isRecord(output)) break;
      const status = readText(output.status);
      if (status === 'succeeded') return '命令执行成功';
      if (status === 'failed') return `命令执行失败：${readText(output.reason) || '未知原因'}`;
      if (status === 'timed-out') return '命令执行超时';
      if (status === 'cancelled') return '命令已取消';
      break;
    }
    default:
      break;
  }

  return message || '已完成这一步';
}

/** 原始载荷只在过程详情里展开，不进主界面。 */
export const rawToolOutput = (output: ToolCompletedEvent['output']): string => {
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(typeof output);
  }
};
