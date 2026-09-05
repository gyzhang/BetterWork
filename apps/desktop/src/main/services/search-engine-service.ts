import type { WebSearchResponse } from '@betterwork/tool-runtime';

export interface QianfanSearchConfig {
  apiKey: string;
  webTopK: number;
}

export interface SearchClient {
  search(query: string): Promise<WebSearchResponse>;
  test(): Promise<{ ok: boolean; message: string }>;
}

const QIANFAN_WEB_SUMMARY_URL = 'https://qianfan.baidubce.com/v2/ai_search/web_summary';
/** 搜索要聚合网页，比模型探测慢，因此超时更宽，但同样不能无限等待。 */
const SEARCH_TIMEOUT_MS = 20_000;

interface QianfanWebSummaryResponse {
  summary?: unknown;
  references?: unknown;
  message?: unknown;
}

/**
 * 外部响应里任何字段都可能是对象或 null。直接 `String(value)` 会得到
 * `[object Object]` 并被当成标题写进 Evidence，因此只接受真正的字符串。
 */
const readString = (value: unknown): string => (typeof value === 'string' ? value : '');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : '搜索服务连接失败';

/**
 * 百度千帆 AI 搜索（`web_summary`）客户端。
 *
 * 安全约束：API Key 只出现在 Authorization 头里。任何错误信息都不得包含 Key——
 * 这些消息会直接显示在设置页并落进消息中心。
 */
export const createQianfanSearchClient = (
  config: QianfanSearchConfig,
  fetchImpl: typeof fetch = fetch,
): SearchClient => {
  const search = async (query: string): Promise<WebSearchResponse> => {
    let response: Response;
    try {
      response = await fetchImpl(QIANFAN_WEB_SUMMARY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: query }],
          resource_type_filter: [
            { type: 'web', top_k: config.webTopK },
            { type: 'video', top_k: 0 },
            { type: 'image', top_k: 0 },
          ],
        }),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error(`搜索服务响应超时（超过 ${SEARCH_TIMEOUT_MS / 1000} 秒）`, {
          cause: error,
        });
      }
      throw new Error(`无法连接搜索服务：${describeError(error)}`, { cause: error });
    }

    const payload = (await response.json().catch(() => undefined)) as
      QianfanWebSummaryResponse | undefined;
    if (!response.ok) {
      const detail = readString(payload?.message);
      throw new Error(`搜索服务返回错误（HTTP ${response.status}${detail ? `：${detail}` : ''}）`);
    }
    if (!isRecord(payload)) throw new Error('搜索服务返回了无法解析的结果');

    const references = Array.isArray(payload.references) ? payload.references : [];
    const results = references
      .filter(isRecord)
      .map((reference) => {
        const site = readString(reference.site);
        const date = readString(reference.date);
        return {
          title: readString(reference.title) || '无标题',
          url: readString(reference.url),
          snippet: readString(reference.content),
          ...(site ? { site } : {}),
          ...(date ? { date } : {}),
        };
      })
      .filter((item) => item.url !== '');

    const summary = readString(payload.summary);
    return { ...(summary ? { summary } : {}), results };
  };

  const test = async (): Promise<{ ok: boolean; message: string }> => {
    try {
      await search('连接测试');
      return { ok: true, message: '搜索服务连接成功' };
    } catch (error) {
      return { ok: false, message: describeError(error) };
    }
  };

  return { search, test };
};
