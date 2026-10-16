import type { ModelRole } from '@betterwork/agent-protocol';

export interface ConnectivityResult {
  ok: boolean;
  message: string;
}

export interface ModelConnectionTarget {
  baseUrl: string;
  model: string;
  roles: ModelRole[];
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
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('模型 API 地址必须是 http 或 https');
  }
  const normalizedPath = url.pathname.replace(/\/+$/, '');
  // 用户可能已经写全了端点，两种后缀都要认，否则会被再拼一次路径
  if (normalizedPath.endsWith('/chat/completions')) {
    url.pathname =
      role === 'embedding'
        ? `${normalizedPath.slice(0, -'/chat/completions'.length)}/embeddings`
        : normalizedPath;
    return url.toString();
  }
  if (normalizedPath.endsWith('/embeddings')) {
    url.pathname =
      role === 'embedding'
        ? normalizedPath
        : `${normalizedPath.slice(0, -'/embeddings'.length)}/chat/completions`;
    return url.toString();
  }
  url.pathname = `${normalizedPath}/${role === 'embedding' ? 'embeddings' : 'chat/completions'}`;
  return url.toString();
}

const buildProbeBody = (target: ModelConnectionTarget, role: ModelRole): unknown =>
  role === 'embedding'
    ? { model: target.model, input: '算台连接测试' }
    : {
        model: target.model,
        messages: [{ role: 'user', content: '请只回复：连接成功' }],
        max_tokens: PROBE_MAX_TOKENS,
      };

const successMessage = (role: ModelRole): string =>
  role === 'embedding' ? 'Embedding 模型连接成功' : '模型连接成功';

const displayEndpoint = (value: string): string => {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
};

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
  const probeRoles: ModelRole[] = [];
  if (target.roles.some((role) => role === 'language' || role === 'vision')) {
    probeRoles.push('language');
  }
  if (target.roles.includes('embedding')) probeRoles.push('embedding');
  if (probeRoles.length === 0) return { ok: false, message: '请至少选择一个模型角色' };

  const results: ConnectivityResult[] = [];
  const qualifyFailure = (role: ModelRole, message: string): string => {
    if (probeRoles.length !== 2) return message;
    return `${role === 'embedding' ? 'Embedding 接口' : '聊天接口'}：${message}`;
  };
  for (const role of probeRoles) {
    let endpoint: string;
    try {
      endpoint = resolveEndpoint(target.baseUrl, role);
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
        body: JSON.stringify(buildProbeBody(target, role)),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!response.ok) {
        return {
          ok: false,
          message: qualifyFailure(role, `连接失败（HTTP ${response.status}）`),
        };
      }
      results.push({ ok: true, message: successMessage(role) });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        return {
          ok: false,
          message: qualifyFailure(role, `连接超时（超过 ${PROBE_TIMEOUT_MS / 1000} 秒）`),
        };
      }
      const detail = error instanceof Error ? error.message : '连接失败';
      return {
        ok: false,
        message: qualifyFailure(
          role,
          `无法连接模型服务（${displayEndpoint(endpoint)}）：${detail}`,
        ),
      };
    }
  }
  if (probeRoles.length === 2) return { ok: true, message: '聊天与 Embedding 模型连接成功' };
  return results[0] ?? { ok: false, message: '连接测试失败' };
}
