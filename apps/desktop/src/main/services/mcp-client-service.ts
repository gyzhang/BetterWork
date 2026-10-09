import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { abortError, type AgentTool, isAbortError } from '@betterwork/agent-core';
import {
  type McpBundledServerId,
  type McpConnectionSummary,
  type McpLifecycleRequest,
  type McpLoginContinueRequest,
  type McpOperationRequest,
  type McpReviewRequest,
  type McpTestResult,
  type McpToolBinding,
  type McpToolSummary,
  type SaveMcpConnectionRequest,
  saveMcpConnectionRequestSchema,
} from '@betterwork/agent-protocol';
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  type Transport,
} from '@modelcontextprotocol/client';
import {
  DEFAULT_INHERITED_ENV_VARS,
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';

import type { GuardianRuntime } from '../infrastructure/mac-process-supervisor';
import type { McpStdioLaunch } from '../infrastructure/mcp-stdio-launch';
import type { AppStore } from '../persistence';
import {
  createMcpPolicyFetch,
  McpNetworkError,
  type McpNetworkOptions,
  validateMcpEndpoint,
} from './mcp-network-policy';
import { McpOAuthService } from './mcp-oauth-service';
import {
  mcpModelAlias,
  mcpSafeResult,
  McpToolContractError,
  summarizeMcpTool,
} from './mcp-tool-contract';

export class McpClientError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'McpClientError';
  }
}
interface Connected {
  client: Client;
  connection: McpConnectionSummary;
  secrets: string[];
  versions: Record<string, number>;
  tools: McpToolSummary[];
  close: () => Promise<void>;
}
interface RunConnections {
  controller: AbortController;
  connections: Map<string, Connected>;
  bindings: Map<string, McpToolBinding>;
  releaseSignal: () => void;
  connectionIds: Set<string>;
}
export interface McpClientOptions extends McpNetworkOptions {
  guardian?: GuardianRuntime;
  resolveBundledRuntime?: (
    serverId: McpBundledServerId,
    args: readonly string[],
    signal: AbortSignal,
  ) => Promise<McpStdioLaunch>;
  openBrowser?: (url: string) => Promise<void>;
  onOperationComplete?: (name: string, success: boolean, phase: 'test' | 'login') => void;
}

const safeFailureMessage = (error: unknown, fallback: string): string => {
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth += 1) {
    if (
      current instanceof McpClientError ||
      current instanceof McpToolContractError ||
      current instanceof McpNetworkError
    )
      return current.message;
    if ('name' in current && current.name === 'UnauthorizedError')
      return 'MCP 认证失败，请检查凭据或到设置重新登录。';
    if ('name' in current && current.name === 'UnsupportedProtocolVersionError')
      return 'MCP 协议版本不兼容，请检查服务接入方式。';
    if ('name' in current && current.name === 'TimeoutError')
      return 'MCP 请求超时，请检查服务状态后重试。';
    const data = 'data' in current ? current.data : undefined;
    const status =
      'status' in current
        ? current.status
        : data && typeof data === 'object' && 'status' in data
          ? data.status
          : undefined;
    if (status === 401) return 'MCP 认证失败，请检查凭据或到设置重新登录。';
    if (status === 403) return 'MCP 权限不足，请检查授权范围或重新登录。';
    if (status === 429) return 'MCP 服务请求过多，请稍后重试。';
    if (status === 404) return 'MCP 地址或旧会话已失效，请检查地址并重新检测。';
    if ('code' in current && typeof current.code === 'string') {
      if (
        [
          'CERT_HAS_EXPIRED',
          'DEPTH_ZERO_SELF_SIGNED_CERT',
          'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
          'ERR_TLS_CERT_ALTNAME_INVALID',
          'SELF_SIGNED_CERT_IN_CHAIN',
        ].includes(current.code)
      )
        return 'MCP 服务证书校验失败，请检查证书与地址。';
      if (['ENOTFOUND', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH'].includes(current.code))
        return 'MCP 服务不可达，请检查地址与网络。';
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return fallback;
};

const hasCauseMessage = (error: unknown, message: string): boolean => {
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth += 1) {
    if ('message' in current && current.message === message) return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
};

const sanitize = (value: unknown, secrets: readonly string[]): unknown => {
  if (typeof value === 'string')
    return secrets.reduce(
      (text, secret) => (secret ? text.split(secret).join('[REDACTED]') : text),
      value,
    );
  if (Array.isArray(value)) return value.map((item: unknown) => sanitize(item, secrets));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [sanitize(key, secrets), sanitize(item, secrets)]),
    );
  return value;
};

export class McpClientService {
  private stopping = false;
  private readonly pendingOperations = new Set<Promise<unknown>>();

  private async trackOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.stopping) throw new McpClientError('应用正在退出，不再接受 MCP 操作。');
    const pending = operation().finally(() => this.pendingOperations.delete(pending));
    this.pendingOperations.add(pending);
    return pending;
  }
  private readonly runs = new Map<string, RunConnections>();
  private readonly operations = new Map<
    string,
    { connectionId: string; controller: AbortController }
  >();
  private readonly testOwners = new Map<string, string>();
  private readonly oauth: McpOAuthService;
  private readonly unsubscribe: (() => void) | undefined;
  private cancelRun: ((runId: string) => void) | undefined;

  constructor(
    private readonly store: AppStore,
    private readonly options: McpClientOptions = {},
  ) {
    this.oauth = new McpOAuthService(store, options);
    this.unsubscribe = store.credentials?.onSuperseded((ref) => {
      if (ref.ownerKind === 'mcp-connection') this.invalidate(ref.ownerId);
    });
  }
  setRunCanceller(cancel: (runId: string) => void): void {
    this.cancelRun = cancel;
  }
  setOperationReporter(report: NonNullable<McpClientOptions['onOperationComplete']>): void {
    this.options.onOperationComplete = report;
  }
  listConnections(): McpConnectionSummary[] {
    return this.store.mcpConnections.list().map((connection) => this.oauth.summary(connection));
  }
  getConnection(id: string): McpConnectionSummary | null {
    const connection = this.store.mcpConnections.get(id);
    return connection ? this.oauth.summary(connection) : null;
  }

  saveConnection(input: SaveMcpConnectionRequest): Promise<McpConnectionSummary> {
    return this.trackOperation(() => this.saveConnectionInternal(input));
  }

  private async saveConnectionInternal(
    input: SaveMcpConnectionRequest,
  ): Promise<McpConnectionSummary> {
    const parsed = saveMcpConnectionRequestSchema.parse(input);
    if (parsed.id) this.store.mcpConnections.assertRevision(parsed.id, parsed.expectedRevisionId);
    const transport = parsed.transport;
    if (transport.kind !== 'stdio')
      validateMcpEndpoint(transport.endpoint, transport.networkMode, transport.networkApproved);
    const slots =
      transport.kind === 'stdio'
        ? (transport.env ?? []).filter((item) => item.secret).map((item) => `env:${item.name}`)
        : transport.authentication.mode === 'oauth'
          ? ['oauth-client-secret']
          : ['http-token'];
    for (const mutation of parsed.secrets ?? [])
      if (!slots.includes(mutation.slot)) throw new McpClientError('凭据槽位不属于此连接配置。');
    if (parsed.id && transport.kind !== 'stdio' && transport.authentication.mode === 'oauth') {
      const previous = this.store.mcpConnections.get(parsed.id);
      const oldAuth =
        previous?.transport.kind !== 'stdio' ? previous?.transport.authentication : undefined;
      const hasSecret = previous?.credentialSlots?.some(
        (slot) => slot.slot === 'oauth-client-secret' && slot.configured,
      );
      const identityChanged =
        oldAuth?.mode !== 'oauth' ||
        oldAuth.issuer !== transport.authentication.issuer ||
        oldAuth.clientId !== transport.authentication.clientId;
      if (
        hasSecret &&
        identityChanged &&
        !(parsed.secrets ?? []).some(
          (item) => item.slot === 'oauth-client-secret' && item.mutation.action !== 'keep',
        )
      )
        throw new McpClientError(
          '更换 OAuth issuer 或 Client ID 时，请替换或清除原 Client Secret。',
        );
    }
    const id = parsed.id ?? randomUUID();
    if (
      (parsed.secrets ?? []).some((item) => item.mutation.action !== 'keep') &&
      !this.store.credentials
    )
      throw new McpClientError('受保护存储不可用，无法保存 MCP 凭据。');
    const commit = (): McpConnectionSummary => this.store.mcpConnections.save(parsed, id);
    const result = this.store.credentials
      ? await this.store.credentials.mutateOwned(id, parsed.secrets ?? [], commit)
      : commit();
    // Ordinary configuration edits preserve clients pinned by already active Runs.
    return this.oauth.summary(result);
  }

  deleteConnection(id: string, expectedRevisionId?: string): Promise<boolean> {
    return this.trackOperation(() => this.deleteConnectionInternal(id, expectedRevisionId));
  }

  private async deleteConnectionInternal(
    id: string,
    expectedRevisionId?: string,
  ): Promise<boolean> {
    const connection = this.store.mcpConnections.assertRevision(id, expectedRevisionId);
    const commit = (): boolean => {
      const result = this.store.mcpConnections.delete(id, expectedRevisionId);
      this.store.mcpConnections.clearAuthorization(id);
      return result;
    };
    const result = this.store.credentials
      ? await this.store.credentials.mutateOwned(
          id,
          (connection.credentialSlots ?? [])
            .filter((slot) => slot.configured)
            .map((slot) => ({
              slot: slot.slot,
              expectedVersion: slot.version,
              mutation: { action: 'clear' as const },
            })),
          commit,
        )
      : commit();
    this.invalidate(id);
    await this.oauth.logout(id);
    return result;
  }
  setLifecycle(input: McpLifecycleRequest): McpConnectionSummary {
    const result = this.store.mcpConnections.setLifecycle(input);
    if (input.lifecycle === 'disabled') this.invalidate(input.id);
    return this.oauth.summary(result);
  }
  reviewTool(input: McpReviewRequest): McpConnectionSummary {
    return this.store.mcpConnections.review(input);
  }
  cancelOperation(input: McpOperationRequest): boolean {
    const operation = this.operations.get(input.operationId);
    if (operation?.connectionId === input.id) {
      operation.controller.abort();
      return true;
    }
    return this.oauth.cancel(input);
  }
  prepareLogin(input: McpOperationRequest): ReturnType<McpOAuthService['prepare']> {
    return this.trackOperation(() => this.prepareLoginInternal(input));
  }

  private async prepareLoginInternal(
    input: McpOperationRequest,
  ): ReturnType<McpOAuthService['prepare']> {
    try {
      return await this.oauth.prepare(input);
    } catch (error) {
      if (!isAbortError(error))
        this.options.onOperationComplete?.(
          this.getConnection(input.id)?.name ?? 'MCP',
          false,
          'login',
        );
      throw error;
    }
  }
  continueLogin(input: McpLoginContinueRequest): Promise<McpTestResult> {
    return this.trackOperation(() => this.continueLoginInternal(input));
  }

  private async continueLoginInternal(input: McpLoginContinueRequest): Promise<McpTestResult> {
    try {
      await this.oauth.login(input);
    } catch (error) {
      if (!isAbortError(error))
        this.options.onOperationComplete?.(
          this.getConnection(input.id)?.name ?? 'MCP',
          false,
          'login',
        );
      throw error;
    }
    return this.testConnection(input, 'login');
  }
  logout(input: McpOperationRequest): Promise<McpConnectionSummary> {
    return this.trackOperation(() => this.logoutInternal(input));
  }

  private async logoutInternal(input: McpOperationRequest): Promise<McpConnectionSummary> {
    this.store.mcpConnections.assertRevision(input.id, input.expectedRevisionId);
    this.invalidate(input.id);
    await this.oauth.logout(input.id);
    const result = this.getConnection(input.id);
    if (!result) throw new McpClientError('MCP 连接不存在。');
    return result;
  }

  testConnection(
    input: McpOperationRequest | string,
    phase: 'test' | 'login' = 'test',
  ): Promise<McpTestResult> {
    return this.trackOperation(() => this.testConnectionInternal(input, phase));
  }

  private async testConnectionInternal(
    input: McpOperationRequest | string,
    phase: 'test' | 'login' = 'test',
  ): Promise<McpTestResult> {
    const id = typeof input === 'string' ? input : input.id;
    const connection =
      typeof input === 'string'
        ? this.getConnection(id)
        : this.store.mcpConnections.assertRevision(id, input.expectedRevisionId);
    if (!connection) throw new McpClientError('MCP 连接不存在。');
    const operationId = typeof input === 'string' ? randomUUID() : input.operationId;
    if (this.operations.has(operationId)) throw new McpClientError('MCP 操作 ID 已在使用中。');
    const ownerKey = JSON.stringify([id, connection.revisionId]);
    this.testOwners.set(ownerKey, operationId);
    const ownsCatalog = (): boolean => this.testOwners.get(ownerKey) === operationId;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 90_000);
    this.operations.set(operationId, { connectionId: id, controller });
    let connected: Connected | undefined;
    try {
      connected = await this.connect(connection, controller.signal);
      await this.discover(connected, controller.signal, ownsCatalog);
      controller.signal.throwIfAborted();
      this.store.mcpConnections.assertRevision(id, connection.revisionId);
      await connected.close();
      connected = undefined;
      controller.signal.throwIfAborted();
      this.store.mcpConnections.assertRevision(id, connection.revisionId);
      const result = this.getConnection(id);
      if (!result) throw new McpClientError('MCP 连接不存在。');
      this.options.onOperationComplete?.(connection.name, true, phase);
      return { connection: result, tools: result.tools, operationId };
    } catch (error) {
      if (ownsCatalog())
        this.store.mcpConnections.updateDiscovery(
          id,
          {
            status: 'failed',
            tools: connection.tools,
            failureMessage: timedOut
              ? 'MCP 检测超过 90 秒，请检查服务状态后重试。'
              : controller.signal.aborted
                ? 'MCP 检测已取消。'
                : safeFailureMessage(error, 'MCP 检测失败，请检查地址、认证与协议。'),
            lastCheckedAt: Date.now(),
          },
          connection.revisionId,
        );
      if (controller.signal.aborted && !timedOut) throw abortError();
      this.options.onOperationComplete?.(connection.name, false, phase);
      throw new McpClientError(
        timedOut
          ? 'MCP 检测超过 90 秒，请检查服务状态后重试。'
          : safeFailureMessage(error, 'MCP 检测失败，请检查地址、凭据或登录状态。'),
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
      this.operations.delete(operationId);
      if (ownsCatalog()) this.testOwners.delete(ownerKey);
      await connected?.close();
    }
  }

  async createAgentTools(
    bindings: readonly McpToolBinding[],
    runId: string,
    signal: AbortSignal,
  ): Promise<AgentTool[]> {
    if (this.runs.has(runId)) throw new McpClientError('此 Run 已拥有 MCP 客户端。');
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    const run: RunConnections = {
      controller,
      connections: new Map(),
      bindings: new Map(),
      connectionIds: new Set(bindings.map((binding) => binding.connectionId)),
      releaseSignal: () => signal.removeEventListener('abort', abort),
    };
    this.runs.set(runId, run);
    const tools: AgentTool[] = [];
    let timedOut = false;
    const discoveryTimer = setTimeout(() => {
      timedOut = true;
      abort();
    }, 90_000);
    try {
      for (const binding of bindings) {
        if (
          !binding.connectionRevisionId ||
          !binding.contractHash ||
          !this.store.mcpConnections.isReviewed(binding)
        )
          throw new McpClientError('MCP 工具需要审阅当前合同并重新选择。');
        const connection = this.store.mcpConnections.get(
          binding.connectionId,
          binding.connectionRevisionId,
        );
        if (!connection || connection.lifecycle !== 'enabled')
          throw new McpClientError('MCP 连接已停用或移除。');
        let connected = run.connections.get(binding.connectionId);
        if (connected && connected.connection.revisionId !== binding.connectionRevisionId)
          throw new McpClientError('同一 Run 不能混用 MCP 连接的不同修订。');
        if (!connected) {
          connected = await this.connect(connection, controller.signal);
          run.connections.set(binding.connectionId, connected);
          await this.discover(connected, controller.signal);
        }
        const tool = connected.tools.find((item) => item.id === binding.toolId);
        if (!tool || tool.contractHash !== binding.contractHash)
          throw new McpClientError('MCP 工具合同已变化或已不可用，请重新检测并允许使用。');
        const alias = mcpModelAlias(binding.connectionId, binding.toolId);
        if (run.bindings.has(alias)) throw new McpClientError('MCP 工具选择重复或模型别名碰撞。');
        run.bindings.set(alias, binding);
        this.store.mcpConnections.saveRunBinding(runId, binding, alias, connected.versions);
        const client = connected.client;
        const secrets = connected.secrets;
        tools.push({
          name: alias,
          description: tool.description,
          inputSchema: tool.inputSchema,
          execute: async (input, context) => {
            if (
              context.runId !== runId ||
              this.store.mcpConnections.get(binding.connectionId)?.lifecycle !== 'enabled'
            )
              throw new McpClientError('MCP 工具不属于此 Run 或连接已撤销。');
            const parsed = z.fromJSONSchema(tool.inputSchema).safeParse(input);
            if (!parsed.success)
              throw new McpClientError(`MCP 工具输入不符合 Schema：${tool.name}`);
            const callSignal = AbortSignal.any([
              context.signal,
              controller.signal,
              AbortSignal.timeout(60_000),
            ]);
            try {
              const result = await client.callTool(
                { name: tool.name, arguments: input },
                {
                  signal: callSignal,
                  timeout: 60_000,
                  onprogress: (progress) => {
                    if (progress.message)
                      context.reportProgress(
                        sanitize(progress.message, [
                          ...secrets,
                          ...this.oauth.activeSecrets(binding.connectionId),
                        ]) as string,
                      );
                  },
                },
              );
              callSignal.throwIfAborted();
              if (
                tool.outputSchema &&
                !z
                  .fromJSONSchema(tool.outputSchema)
                  .safeParse('structuredContent' in result ? result.structuredContent : undefined)
                  .success
              )
                throw new McpClientError('工具返回数据与检测时记录的定义不一致，已停止使用。');
              return sanitize(mcpSafeResult(result), [
                ...secrets,
                ...this.oauth.activeSecrets(binding.connectionId),
              ]);
            } catch (error) {
              if (callSignal.aborted) {
                if (context.signal.aborted || controller.signal.aborted) throw abortError();
                throw new McpClientError('MCP 工具调用超过 60 秒，请检查服务状态后重试。');
              }
              if (error instanceof McpClientError || error instanceof McpToolContractError)
                throw error;
              throw new McpClientError(
                safeFailureMessage(error, 'MCP 工具调用失败，请检查连接、登录状态或权限后重试。'),
                {
                  cause: error,
                },
              );
            }
          },
        });
      }
      controller.signal.throwIfAborted();
      return tools;
    } catch (error) {
      const cancelled = controller.signal.aborted;
      await this.releaseRun(runId);
      if (cancelled && !timedOut) throw abortError();
      if (timedOut)
        throw new McpClientError('MCP 连接与工具发现超过 90 秒，请检查服务状态后重试。', {
          cause: error,
        });
      throw error;
    } finally {
      clearTimeout(discoveryTimer);
    }
  }

  getRunToolBinding(runId: string, alias: string): McpToolBinding | undefined {
    return this.runs.get(runId)?.bindings.get(alias);
  }
  async releaseRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;
    this.runs.delete(runId);
    run.releaseSignal();
    run.controller.abort();
    const results = await Promise.allSettled(
      [...run.connections.values()].map((state) => state.close()),
    );
    if (results.some((result) => result.status === 'rejected'))
      throw new McpClientError('MCP 连接清理失败。');
  }
  async shutdown(): Promise<void> {
    this.stopping = true;
    this.unsubscribe?.();
    const oauth = this.oauth.shutdown();
    for (const operation of this.operations.values()) operation.controller.abort();
    await Promise.allSettled([
      oauth,
      ...this.pendingOperations,
      ...[...this.runs.keys()].map((runId) => this.releaseRun(runId)),
    ]);
  }
  private invalidate(id: string): void {
    for (const [runId, run] of this.runs)
      if (
        [...run.bindings.values()].some((binding) => binding.connectionId === id) ||
        run.connectionIds.has(id)
      ) {
        run.controller.abort();
        this.cancelRun?.(runId);
      }
    for (const operation of this.operations.values())
      if (operation.connectionId === id) operation.controller.abort();
    this.oauth.cancelConnection(id);
  }

  private async connect(connection: McpConnectionSummary, signal: AbortSignal): Promise<Connected> {
    const lifetimeSignal = signal;
    const config = connection.transport;
    const connectionTimeoutMs = config.kind === 'stdio' ? 60_000 : 10_000;
    const timeoutMessage =
      config.kind === 'stdio'
        ? config.runtime
          ? '内置 MCP 运行时准备或握手超过 60 秒，请重试；若资源损坏，请重新安装应用。'
          : 'MCP 本地服务启动或握手超过 60 秒，请检查启动命令、包名、依赖安装和网络后重试。'
        : 'MCP 连接超过 10 秒，请检查服务状态后重试。';
    signal = AbortSignal.any([signal, AbortSignal.timeout(connectionTimeoutMs)]);
    signal.throwIfAborted();
    const secrets: string[] = [];
    const versions: Record<string, number> = {};
    const resolve = async (slot: string): Promise<string> => {
      if (!this.store.credentials) throw new McpClientError('受保护存储不可用。');
      const value = await this.store.credentials.resolveForOwner({
        ownerKind: 'mcp-connection',
        ownerId: connection.id,
        slot,
      });
      secrets.push(value.plaintext);
      versions[slot] = value.version;
      return value.plaintext;
    };
    let lastStatus = 0;
    let closing = false;
    let lastOAuthToken: string | undefined;
    let guardianCleanup: 'pending' | 'complete' | 'failed' = 'pending';
    let guardianDiagnostics = '';
    const makeTransport = (sse: boolean): Transport => {
      if (config.kind === 'stdio') throw new McpClientError('传输配置无效。');
      const policyFetch = createMcpPolicyFetch(
        [{ origin: new URL(config.endpoint).origin, networkMode: config.networkMode }],
        this.options,
      );
      const requestFetch: typeof fetch = async (input, init) => {
        const response = await policyFetch(
          input,
          closing
            ? {
                ...init,
                signal: AbortSignal.any([
                  ...(init?.signal ? [init.signal] : []),
                  AbortSignal.timeout(3_000),
                ]),
              }
            : init,
        );
        lastStatus = response.status;
        return response;
      };
      const common = {
        fetch: requestFetch,
        requestInit: { headers },
        ...(authProvider ? { authProvider } : {}),
      };
      return sse
        ? new SSEClientTransport(new URL(config.endpoint), common)
        : new StreamableHTTPClientTransport(new URL(config.endpoint), {
            ...common,
            onInsufficientScope: 'throw',
            reconnectionOptions: {
              maxRetries: 0,
              maxReconnectionDelay: 0,
              initialReconnectionDelay: 0,
              reconnectionDelayGrowFactor: 1,
            },
          });
    };
    const headers: Record<string, string> = {};
    let authProvider: { token: () => Promise<string | undefined> } | undefined;
    let transport: Transport;
    if (config.kind === 'stdio') {
      const runtime = this.options.guardian ?? {
        executable: process.execPath,
        scriptPath: path.resolve(
          process.cwd(),
          'apps/desktop/src/main/infrastructure/skill-guardian.ts',
        ),
      };
      const env = getDefaultEnvironment();
      for (const [name, value] of Object.entries(runtime.env ?? {}))
        if (
          value !== undefined &&
          !value.startsWith('()') &&
          (DEFAULT_INHERITED_ENV_VARS.includes(name) || name === 'ELECTRON_RUN_AS_NODE')
        )
          env[name] = value;
      for (const item of config.env ?? [])
        env[item.name] = item.secret ? await resolve(`env:${item.name}`) : (item.value ?? '');
      const launch = config.runtime
        ? await this.options.resolveBundledRuntime?.(config.runtime.serverId, config.args, signal)
        : config.command
          ? {
              command: config.command,
              args: config.args,
              ...(config.cwd ? { cwd: config.cwd } : {}),
            }
          : undefined;
      if (!launch) throw new McpClientError('没有配置此内置 MCP 的运行时解析器。');
      transport = new StdioClientTransport({
        command: runtime.executable,
        args: [
          ...(runtime.args ?? []),
          runtime.scriptPath,
          '--mcp-pipe',
          JSON.stringify({
            command: launch.command,
            args: launch.args,
            ...(launch.cwd ? { cwd: launch.cwd } : {}),
            ...(launch.runAsNode ? { runAsNode: true } : {}),
          }),
        ],
        env,
        stderr: 'pipe',
        maxBufferSize: 1_048_576,
      });
      if (transport instanceof StdioClientTransport)
        transport.stderr?.on('data', (chunk: Buffer) => {
          // The guardian drains server stderr. Only its fixed cleanup acknowledgment is consumed.
          guardianDiagnostics = (guardianDiagnostics + chunk.toString('utf8')).slice(-256);
          if (guardianDiagnostics.includes('BETTERWORK_MCP_CLEANUP_FAILED\n'))
            guardianCleanup = 'failed';
          else if (guardianDiagnostics.includes('BETTERWORK_MCP_CLEANUP_OK\n'))
            guardianCleanup = 'complete';
        });
    } else {
      validateMcpEndpoint(config.endpoint, config.networkMode, config.networkApproved);
      if (config.authentication.mode === 'bearer')
        headers.Authorization = `Bearer ${await resolve('http-token')}`;
      if (config.authentication.mode === 'api-key-header')
        headers[config.authentication.headerName] = await resolve('http-token');
      if (config.authentication.mode === 'oauth')
        authProvider = {
          token: async () => {
            if (closing) return lastOAuthToken;
            const token = await this.oauth.accessToken(connection, lifetimeSignal);
            lastOAuthToken = token;
            for (const secret of this.oauth.activeSecrets(connection.id))
              if (!secrets.includes(secret)) secrets.push(secret);
            const authorization = connection.revisionId
              ? this.store.mcpConnections.authorization(connection.id, connection.revisionId)
              : undefined;
            if (authorization) {
              const slot = this.store.mcpConnections
                .get(connection.id)
                ?.credentialSlots?.find((item) => item.slot === authorization.slot);
              if (slot) versions[slot.slot] = slot.version;
            }
            return token;
          },
        };
      transport = makeTransport(config.kind === 'sse');
    }
    const createClient = (legacy: boolean): Client =>
      new Client(
        { name: 'betterwork', version: '0.0.1' },
        {
          versionNegotiation: {
            mode: legacy ? 'legacy' : 'auto',
            probe: { timeoutMs: 2_000, maxRetries: 0 },
          },
          inputRequired: { autoFulfill: false },
        },
      );
    let client = createClient(config.kind === 'sse');
    try {
      try {
        await client.connect(transport, { signal, timeout: connectionTimeoutMs });
      } catch (error) {
        await client.close();
        if (
          config.kind !== 'streamable-http' ||
          !config.allowLegacySse ||
          ![404, 405].includes(lastStatus) ||
          signal.aborted
        )
          throw error;
        transport = makeTransport(true);
        client = createClient(true);
        await client.connect(transport, { signal, timeout: connectionTimeoutMs });
      }
      signal.throwIfAborted();
      return {
        client,
        connection,
        secrets,
        versions,
        tools: [],
        close: async () => {
          closing = true;
          try {
            if (transport instanceof StreamableHTTPClientTransport)
              await transport.terminateSession();
          } finally {
            await client.close();
          }
          if (config.kind === 'stdio' && guardianCleanup !== 'complete')
            throw new McpClientError('MCP 本地进程清理失败或未获确认，请检查残留进程。');
        },
      };
    } catch (error) {
      await client.close();
      if (lifetimeSignal.aborted) throw abortError();
      throw new McpClientError(
        signal.aborted
          ? timeoutMessage
          : config.kind === 'stdio' && hasCauseMessage(error, 'Connection closed')
            ? config.runtime
              ? '内置 MCP 进程在握手前退出，请检查应用内运行时资源并重试。'
              : 'MCP 本地进程在握手前退出，请检查启动命令、包名与依赖安装。'
            : safeFailureMessage(error, 'MCP 连接失败，请检查地址、认证与协议。'),
        { cause: error },
      );
    }
  }

  private async discover(
    state: Connected,
    signal: AbortSignal,
    canPersist: () => boolean = () => true,
  ): Promise<McpToolSummary[]> {
    const tools: McpToolSummary[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    try {
      do {
        const result = await state.client.request(
          { method: 'tools/list', params: { ...(cursor ? { cursor } : {}) } },
          { signal, timeout: 30_000 },
        );
        for (const tool of result.tools ?? [])
          tools.push(
            summarizeMcpTool(
              state.connection.id,
              sanitize(tool, [
                ...state.secrets,
                ...this.oauth.activeSecrets(state.connection.id),
              ]) as typeof tool,
              Date.now(),
            ),
          );
        if (tools.length > 200) throw new McpClientError('MCP 工具数量超过 200 项上限。');
        if (new Set(tools.map((tool) => tool.id)).size !== tools.length)
          throw new McpClientError('MCP 工具目录包含重复身份。');
        cursor = result.nextCursor;
        if (cursor && cursors.has(cursor)) throw new McpClientError('MCP 工具分页游标重复。');
        if (cursor) cursors.add(cursor);
        if (cursors.size > 200) throw new McpClientError('MCP 工具分页超过上限。');
      } while (cursor);
      signal.throwIfAborted();
      state.tools = tools;
      const version = state.client.getServerVersion();
      if (canPersist())
        this.store.mcpConnections.updateDiscovery(
          state.connection.id,
          {
            status: 'ready',
            tools: sanitize(tools, state.secrets) as McpToolSummary[],
            protocolVersion: state.client.getNegotiatedProtocolVersion(),
            ...(version ? { serverName: version.name, serverVersion: version.version } : {}),
            lastCheckedAt: Date.now(),
            stale: false,
          },
          state.connection.revisionId,
        );
      return tools;
    } catch (error) {
      if (canPersist() && !signal.aborted)
        this.store.mcpConnections.updateDiscovery(
          state.connection.id,
          {
            status: 'failed',
            tools: [],
            failureMessage: signal.aborted
              ? '检测已取消或超时。'
              : '工具发现失败，请检查连接与登录状态。',
            lastCheckedAt: Date.now(),
            stale: true,
          },
          state.connection.revisionId,
        );
      throw error;
    }
  }
}
