import type { ModelRole } from '@betterwork/agent-protocol';

export interface ConnectivityResult {
  ok: boolean;
  message: string;
}

export interface ModelConnectionTarget {
  baseUrl: string;
  model: string;
  role: ModelRole;
  apiKey: string;
}

/** 连通性探测的超时上限；公司内网服务偶尔慢，但没有理由让设置页无限等待。 */
const PROBE_TIMEOUT_MS = 15_000;
const PROBE_MAX_TOKENS = 8;

/**
 * 把用户填的 base URL 归一化为具体端点。
 * 用户可能填 `https://host/v1`、`https://host/v1/` 或已经写全的
 * `https://host/v1/chat/completions`，三种都要能用。
 *
 * 只接受 http/https：Zod 的 `url()` 会放过 `file://` 之类的协议，
 * 而这里要拿它去发起网络请求，必须在边界上收窄。
 */
export function resolveEndpoint(baseUrl: string, role: ModelRole): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  const url = new URL(normalized);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('模型 API 地址必须是 http 或 https');
  }
  // 用户可能已经写全了端点，两种后缀都要认，否则会被再拼一次路径
  if (normalized.endsWith('/chat/completions') || normalized.endsWith('/embeddings')) {
    return normalized;
  }
  return `${normalized}/${role === 'embedding' ? 'embeddings' : 'chat/completions'}`;
}

const buildProbeBody = (target: ModelConnectionTarget): unknown =>
  target.role === 'embedding'
    ? { model: target.model, input: '算台连接测试' }
    : {
        model: target.model,
        messages: [{ role: 'user', content: '请只回复：连接成功' }],
        max_tokens: PROBE_MAX_TOKENS,
      };

const successMessage = (role: ModelRole): string =>
  role === 'embedding' ? 'Embedding 模型连接成功' : '模型连接成功';

/**
 * 用一次最小请求验证模型服务可达。
 *
 * 纯函数式设计（fetch 可注入）便于测试；不落库、不广播，
 * 结果如何持久化由调用方决定。错误信息只包含 HTTP 状态与网络原因，
 * 绝不包含 API Key。
 */
export async function probeModelConnection(
  target: ModelConnectionTarget,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectivityResult> {
  let endpoint: string;
  try {
    endpoint = resolveEndpoint(target.baseUrl, target.role);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'API 地址无效' };
  }

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}),
      },
      body: JSON.stringify(buildProbeBody(target)),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, message: `连接失败（HTTP ${response.status}）` };
    return { ok: true, message: successMessage(target.role) };
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { ok: false, message: `连接超时（超过 ${PROBE_TIMEOUT_MS / 1000} 秒）` };
    }
    return { ok: false, message: error instanceof Error ? error.message : '连接失败' };
  }
}
