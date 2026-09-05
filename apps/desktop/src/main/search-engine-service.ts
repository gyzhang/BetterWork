import type { WebSearchResponse } from '@betterwork/tool-runtime';

export interface QianfanSearchConfig {
  apiKey: string;
  webTopK: number;
}

interface QianfanWebSummaryResponse {
  summary?: unknown;
  references?: unknown;
  message?: unknown;
}

/** Builds the Baidu Qianfan AI Search (web_summary) client; API key never appears in error messages. */
export const createQianfanSearchClient = (config: QianfanSearchConfig, fetchImpl: typeof fetch = fetch) => {
  const search = async (query: string): Promise<WebSearchResponse> => {
    let response: Response;
    try {
      response = await fetchImpl('https://qianfan.baidubce.com/v2/ai_search/web_summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          messages: [{ role: 'user', content: query }],
          resource_type_filter: [
            { type: 'web', top_k: config.webTopK },
            { type: 'video', top_k: 0 },
            { type: 'image', top_k: 0 },
          ],
        }),
      });
    } catch (error) {
      throw new Error(`无法连接搜索服务：${error instanceof Error ? error.message : '网络错误'}`);
    }
    const payload = await response.json().catch(() => undefined) as QianfanWebSummaryResponse | undefined;
    if (!response.ok) {
      const detail = typeof payload?.message === 'string' && payload.message ? `：${payload.message}` : '';
      throw new Error(`搜索服务返回错误（HTTP ${response.status}${detail}）`);
    }
    if (!payload || typeof payload !== 'object') throw new Error('搜索服务返回了无法解析的结果');
    const references = Array.isArray(payload.references) ? payload.references : [];
    const results = references
      .filter((reference): reference is Record<string, unknown> => Boolean(reference) && typeof reference === 'object')
      .map((reference) => ({
        title: String(reference.title ?? '') || '无标题',
        url: String(reference.url ?? ''),
        snippet: String(reference.content ?? ''),
        ...(reference.site ? { site: String(reference.site) } : {}),
        ...(reference.date ? { date: String(reference.date) } : {}),
      }))
      .filter((item) => item.url !== '');
    return {
      ...(typeof payload.summary === 'string' && payload.summary ? { summary: payload.summary } : {}),
      results,
    };
  };

  const test = async (): Promise<{ ok: boolean; message: string }> => {
    try {
      await search('连接测试');
      return { ok: true, message: '搜索服务连接成功' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '搜索服务连接失败' };
    }
  };

  return { search, test };
};
