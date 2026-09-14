import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MODEL_TIMEOUT_MS = 5_000;

const fail = (message) => {
  throw new Error(message);
};

const valueAfter = (args, flag) => {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) fail(`${flag} requires a value`);
  return value;
};

const hasFlag = (args, flag) => args.includes(flag);

const endpointFor = (baseUrl) => {
  let parsed;
  try {
    parsed = new globalThis.URL(baseUrl);
  } catch {
    fail(`模型端点不是有效 URL：${baseUrl}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    fail(`模型端点只支持 HTTP(S)：${baseUrl}`);
  }
  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/models')) return parsed.toString();
  parsed.pathname = `${pathname}/models`;
  return parsed.toString();
};

const checkModelEndpoint = async (baseUrl, apiKey) => {
  const endpoint = endpointFor(baseUrl);
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const response = await globalThis.fetch(endpoint, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
    });
    const body = await response.text();
    if (!response.ok) fail(`模型端点返回 HTTP ${response.status}`);
    if (body.trim().length === 0) fail('模型端点返回空响应');
    return endpoint;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('模型端点')) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      fail(`模型端点在 ${MODEL_TIMEOUT_MS}ms 内无响应`);
    }
    fail(`模型端点检查失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    globalThis.clearTimeout(timer);
  }
};

const checkSigningIdentity = async () => {
  if (process.platform !== 'darwin') fail('签名身份检查只支持 macOS');
  let output;
  try {
    output = await execFileAsync('security', ['find-identity', '-v', '-p', 'codesigning'], {
      maxBuffer: 1_000_000,
    });
  } catch (error) {
    const details =
      error && typeof error === 'object' && 'stdout' in error && typeof error.stdout === 'string'
        ? error.stdout
        : error instanceof Error
          ? error.message
          : String(error);
    fail(`无法读取 macOS 代码签名身份：${details.trim()}`);
  }
  const match = output.stdout.match(/(\d+) valid identities found/);
  const count = Number(match?.[1] ?? 0);
  if (count < 1) fail('未找到有效的 macOS 代码签名身份');
  return count;
};

const main = async () => {
  const args = process.argv.slice(2);
  const skipModel = hasFlag(args, '--skip-model');
  const skipSigning = hasFlag(args, '--skip-signing');
  if (hasFlag(args, '--help')) {
    process.stdout.write(
      'Usage: node scripts/expert-acceptance-preflight.mjs --model-url <url> [--api-key-env <name>] [--skip-signing]\n',
    );
    return;
  }
  if (skipModel && skipSigning) fail('至少保留模型端点或签名身份检查之一');

  const modelUrl = valueAfter(args, '--model-url') ?? process.env.BETTERWORK_MODEL_BASE_URL;
  const apiKeyEnv = valueAfter(args, '--api-key-env');
  if (!skipModel && !modelUrl) {
    fail('缺少模型端点：请传入 --model-url 或设置 BETTERWORK_MODEL_BASE_URL');
  }
  const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : undefined;
  const checks = [];
  if (!skipModel && modelUrl) {
    checks.push(`模型端点 ${await checkModelEndpoint(modelUrl, apiKey)}`);
  }
  if (!skipSigning) {
    checks.push(`代码签名身份 ${await checkSigningIdentity()} 个`);
  }
  process.stdout.write(`Expert acceptance preflight passed: ${checks.join('；')}`);
};

main().catch((error) => {
  process.stderr.write(
    `Expert acceptance preflight failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
