import {
  type McpAuthentication,
  type McpConnectionSummary,
  type McpOAuthPreparation,
  type McpSecretMutation,
  type McpTransport,
  saveMcpConnectionRequestSchema,
} from '@betterwork/agent-protocol';
import { useRef, useState } from 'react';

import { ActionBar } from '../components/ActionBar';
import { InlineLoading } from '../components/AsyncButton';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { Disclosure } from '../components/Disclosure';
import { EmptyNotice } from '../components/EmptyState';
import { Field } from '../components/Field';
import { FieldSelect } from '../components/FieldSelect';
import { InlineError } from '../components/InlineError';
import { ListRow } from '../components/ListRow';
import { PopoverMenu } from '../components/PopoverMenu';
import { SectionHeader } from '../components/SectionHeader';
import { StatusNote } from '../components/StatusNote';
import { Switch } from '../components/Switch';
import { TextArea, TextField } from '../components/TextField';
import { TransientToast } from '../components/TransientToast';
import type { McpConnectionsState } from '../hooks/use-mcp-connections';
import { useTransientToast } from '../hooks/use-transient-toast';
import { describeActionError, trackAction } from '../lib/async-action';

interface SecretEnv {
  name: string;
  value: string;
  clear: boolean;
}
interface McpForm {
  name: string;
  kind: McpTransport['kind'];
  command: string;
  args: string;
  cwd: string;
  endpoint: string;
  networkMode: 'public' | 'private' | 'loopback';
  networkApproved: boolean;
  auth: McpAuthentication['mode'];
  headerName: string;
  secret: string;
  clearSecret: boolean;
  issuer: string;
  clientId: string;
  clientMetadataUrl: string;
  callbackPort: string;
  approvedOrigins: string;
  allowLegacySse: boolean;
  env: string;
  secretEnv: SecretEnv[];
}
const emptyForm = (): McpForm => ({
  name: '',
  kind: 'stdio',
  command: '',
  args: '',
  cwd: '',
  endpoint: '',
  networkMode: 'public',
  networkApproved: false,
  auth: 'none',
  headerName: 'X-API-Key',
  secret: '',
  clearSecret: false,
  issuer: '',
  clientId: '',
  clientMetadataUrl: '',
  callbackPort: '',
  approvedOrigins: '',
  allowLegacySse: false,
  env: '',
  secretEnv: [],
});
const transportOptions = [
  { id: 'stdio', label: '本地命令 · stdio' },
  { id: 'streamable-http', label: 'HTTP · Streamable HTTP' },
  { id: 'sse', label: '旧版 SSE · HTTP+SSE' },
];
const authOptions = [
  { id: 'none', label: '无认证' },
  { id: 'bearer', label: 'Bearer Token' },
  { id: 'api-key-header', label: 'API Key 请求头' },
  { id: 'oauth', label: 'OAuth 浏览器登录' },
];
const statusNames = {
  unconfigured: '未检测',
  connecting: '检测中',
  ready: '可用',
  failed: '失败',
  disconnected: '已断开',
};

export function McpSettings({ state }: { state: McpConnectionsState }): React.JSX.Element {
  const [form, setForm] = useState<McpForm>();
  const [editing, setEditing] = useState<McpConnectionSummary>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<{
    id: string;
    operationId: string;
    kind: 'test' | 'login' | 'save';
  }>();
  const [login, setLogin] = useState<{
    connection: McpConnectionSummary;
    preparation: McpOAuthPreparation;
    issuer: string;
  }>();
  const [confirmation, setConfirmation] = useState<McpConnectionSummary>();
  const generation = useRef(0);
  const { toast, showToast, dismissToast } = useTransientToast();
  const change = (patch: Partial<McpForm>): void =>
    setForm((current) => (current ? { ...current, ...patch } : current));
  const beginEdit = (connection?: McpConnectionSummary): void => {
    setError('');
    setEditing(connection);
    if (!connection) {
      setForm(emptyForm());
      return;
    }
    const transport = connection.transport;
    const next = { ...emptyForm(), name: connection.name, kind: transport.kind };
    if (transport.kind === 'stdio') {
      next.command = transport.command;
      next.args = transport.args.join('\n');
      next.cwd = transport.cwd ?? '';
      next.env = (transport.env ?? [])
        .filter((item) => !item.secret)
        .map((item) => `${item.name}=${item.value ?? ''}`)
        .join('\n');
      next.secretEnv = (transport.env ?? [])
        .filter((item) => item.secret)
        .map((item) => ({ name: item.name, value: '', clear: false }));
    } else {
      next.endpoint = transport.endpoint;
      next.networkMode = transport.networkMode;
      next.networkApproved = transport.networkApproved;
      next.auth = transport.authentication.mode;
      next.allowLegacySse =
        transport.kind === 'streamable-http' && (transport.allowLegacySse ?? false);
      if (transport.authentication.mode === 'api-key-header')
        next.headerName = transport.authentication.headerName;
      if (transport.authentication.mode === 'oauth') {
        next.issuer = transport.authentication.issuer ?? '';
        next.clientId = transport.authentication.clientId ?? '';
        next.clientMetadataUrl = transport.authentication.clientMetadataUrl ?? '';
        next.callbackPort = transport.authentication.callbackPort?.toString() ?? '';
        next.approvedOrigins = (transport.authentication.approvedOrigins ?? [])
          .map((item) => `${item.networkMode} ${item.origin}`)
          .join('\n');
      }
    }
    setForm(next);
  };
  const act = (operation: () => Promise<unknown>, label: string, success?: string): void => {
    setError('');
    trackAction(
      Promise.resolve()
        .then(operation)
        .then(() => {
          state.refresh();
          if (success) showToast('success', success);
        })
        .catch((failure: unknown) => setError(describeActionError(failure, label))),
      label,
    );
  };
  const save = (): void => {
    if (!form) return;
    try {
      const secret = (slot: string, value: string, clear: boolean): McpSecretMutation => ({
        slot,
        expectedVersion: editing?.credentialSlots?.find((item) => item.slot === slot)?.version ?? 0,
        mutation: clear
          ? { action: 'clear' }
          : value
            ? { action: 'replace', value }
            : { action: 'keep' },
      });
      const secrets: McpSecretMutation[] = [];
      let transport: McpTransport;
      if (form.kind === 'stdio') {
        const env = form.env
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const equals = line.indexOf('=');
            if (equals < 1) throw new Error('普通环境变量请按 NAME=value 填写。');
            return { name: line.slice(0, equals), value: line.slice(equals + 1), secret: false };
          });
        for (const item of form.secretEnv)
          secrets.push(secret(`env:${item.name}`, item.value, item.clear));
        transport = {
          kind: 'stdio',
          command: form.command,
          args: form.args.split('\n').filter((value) => value !== ''),
          ...(form.cwd ? { cwd: form.cwd } : {}),
          env: [...env, ...form.secretEnv.map((item) => ({ name: item.name, secret: true }))],
        };
      } else {
        let authentication: McpAuthentication = { mode: 'none' };
        if (form.auth === 'bearer') authentication = { mode: 'bearer' };
        if (form.auth === 'api-key-header')
          authentication = { mode: 'api-key-header', headerName: form.headerName };
        if (form.auth === 'oauth')
          authentication = {
            mode: 'oauth',
            ...(form.issuer ? { issuer: form.issuer } : {}),
            ...(form.clientId ? { clientId: form.clientId } : {}),
            ...(form.clientMetadataUrl ? { clientMetadataUrl: form.clientMetadataUrl } : {}),
            ...(form.callbackPort ? { callbackPort: Number(form.callbackPort) } : {}),
            approvedOrigins: form.approvedOrigins
              .split('\n')
              .filter(Boolean)
              .map((line) => {
                const [networkMode, origin] = line.split(' ');
                if (!origin || !['private', 'loopback'].includes(networkMode ?? ''))
                  throw new Error(
                    '认证目的地请按 private https://host:port 或 loopback http://127.0.0.1:port 填写。',
                  );
                return { origin, networkMode: networkMode as 'private' | 'loopback' };
              }),
          };
        if (form.auth !== 'none')
          secrets.push(
            secret(
              form.auth === 'oauth' ? 'oauth-client-secret' : 'http-token',
              form.secret,
              form.clearSecret,
            ),
          );
        transport = {
          kind: form.kind,
          endpoint: form.endpoint,
          networkMode: form.networkMode,
          networkApproved: form.networkApproved,
          authentication,
          ...(form.kind === 'streamable-http' ? { allowLegacySse: form.allowLegacySse } : {}),
        };
      }
      const input = saveMcpConnectionRequestSchema.parse({
        ...(editing ? { id: editing.id, expectedRevisionId: editing.revisionId } : {}),
        name: form.name,
        transport,
        secrets,
      });
      setBusy({ id: editing?.id ?? 'new', operationId: crypto.randomUUID(), kind: 'save' });
      setError('');
      trackAction(
        state
          .save(input)
          .then(() => {
            setForm(undefined);
            setEditing(undefined);
            state.refresh();
            showToast('success', '连接已保存，请登录或检测后审阅具体工具。');
          })
          .catch((failure: unknown) =>
            setError(describeActionError(failure, '保存失败，请检查输入。')),
          )
          .finally(() => setBusy(undefined)),
        '保存 MCP 连接',
      );
    } catch (failure) {
      setError(describeActionError(failure, '请检查 MCP 配置字段。'));
    }
  };
  const test = (connection: McpConnectionSummary): void => {
    const operationId = crypto.randomUUID();
    const current = ++generation.current;
    setBusy({ id: connection.id, operationId, kind: 'test' });
    setError('');
    trackAction(
      state
        .test(connection.id, operationId)
        .then(() => state.refresh())
        .catch((failure: unknown) => {
          if (current === generation.current)
            setError(describeActionError(failure, 'MCP 检测失败。'));
        })
        .finally(() => {
          if (current === generation.current) setBusy(undefined);
        }),
      '检测 MCP 连接',
    );
  };
  const prepareLogin = (connection: McpConnectionSummary): void => {
    const operationId = crypto.randomUUID();
    const current = ++generation.current;
    setBusy({ id: connection.id, operationId, kind: 'login' });
    setError('');
    trackAction(
      state
        .prepareLogin(connection.id, operationId)
        .then((preparation) => {
          if (current === generation.current)
            setLogin({ connection, preparation, issuer: preparation.issuers[0] ?? '' });
        })
        .catch((failure: unknown) => {
          if (current === generation.current) {
            setBusy(undefined);
            setError(describeActionError(failure, 'OAuth 发现失败。'));
          }
        }),
      '准备 OAuth 登录',
    );
  };
  const continueLogin = (): void => {
    if (!login?.connection.revisionId) return;
    const current = generation.current;
    const input = {
      id: login.connection.id,
      expectedRevisionId: login.connection.revisionId,
      operationId: login.preparation.operationId,
      issuer: login.issuer,
      consent: true as const,
    };
    setLogin(undefined);
    trackAction(
      state
        .continueLogin(input)
        .then(() => state.refresh())
        .catch((failure: unknown) => {
          if (current === generation.current)
            setError(describeActionError(failure, 'OAuth 登录失败。'));
        })
        .finally(() => {
          if (current === generation.current) setBusy(undefined);
        }),
      'OAuth 浏览器登录',
    );
  };
  const cancel = (): void => {
    if (!busy) return;
    const current = busy;
    generation.current += 1;
    setLogin(undefined);
    setBusy(undefined);
    act(() => state.cancel(current.id, current.operationId), '取消 MCP 操作失败。');
  };
  return (
    <section className="settings-section mcp-settings">
      <SectionHeader
        variant="block"
        eyebrow="MCP"
        title="连接外部工作能力"
        hint="接入本地或远程 MCP 服务，登录并检测后，为专家和任务选择工具。"
        actions={
          <Button variant="primary" size="lg" disabled={!!busy} onClick={() => beginEdit()}>
            新建连接
          </Button>
        }
      />
      {error && !form && <InlineError message={error} onDismiss={() => setError('')} />}
      {state.loading ? (
        <InlineLoading label="正在加载连接…" />
      ) : state.error ? (
        <InlineError message={state.error} onRetry={state.refresh} />
      ) : state.connections.length === 0 ? (
        <EmptyNotice
          title="还没有 MCP 连接"
          detail="支持本地 stdio、Streamable HTTP 和旧 HTTP+SSE。添加连接后检测并审阅工具。"
        />
      ) : (
        <div className="mcp-connection-list">
          {state.connections.map((connection) => (
            <ListRow
              as="article"
              key={connection.id}
              title={connection.name}
              detail={`${connection.transport.kind === 'stdio' ? connection.transport.command : connection.transport.endpoint} · ${connection.tools.length} 个工具`}
              meta={
                <>
                  <ConnectionStatus
                    status={connection.status}
                    label={statusNames[connection.status]}
                  />
                  <Badge>{connection.transport.kind}</Badge>
                  <Badge>{connection.lifecycle === 'enabled' ? '已启用' : '已停用'}</Badge>
                  {connection.oauthStatus && (
                    <Badge>{connection.oauthStatus === 'authorized' ? '已登录' : '需要登录'}</Badge>
                  )}
                </>
              }
              actions={
                <>
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={!!busy}
                    onClick={() => test(connection)}
                  >
                    检测
                  </Button>
                  {connection.transport.kind !== 'stdio' &&
                    connection.transport.authentication.mode === 'oauth' && (
                      <Button
                        variant="quiet"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => prepareLogin(connection)}
                      >
                        登录
                      </Button>
                    )}
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={!!busy}
                    onClick={() => beginEdit(connection)}
                  >
                    编辑
                  </Button>
                  <ConnectionActions
                    connection={connection}
                    disabled={!!busy}
                    onLifecycle={() => {
                      if (connection.revisionId)
                        act(
                          () =>
                            state.setLifecycle({
                              id: connection.id,
                              expectedRevisionId: connection.revisionId ?? '',
                              lifecycle:
                                connection.lifecycle === 'enabled' ? 'disabled' : 'enabled',
                            }),
                          '更改 MCP 状态失败。',
                        );
                    }}
                    onLogout={() => act(() => state.logout(connection.id), '退出登录失败。')}
                    onRemove={() => setConfirmation(connection)}
                  />
                </>
              }
            >
              {busy?.id === connection.id && busy.kind !== 'save' && (
                <ActionBar as="div" label="MCP 操作">
                  <InlineLoading
                    label={busy.kind === 'login' ? '等待授权或浏览器登录…' : '正在检测连接…'}
                  />
                  <Button size="md" variant="secondary" onClick={cancel}>
                    取消{busy.kind === 'login' ? '登录' : '检测'}
                  </Button>
                </ActionBar>
              )}
              <Disclosure label="工具与诊断">
                <StatusNote
                  message={`协议版本：${connection.protocolVersion ?? '尚未检测'}；最后检测：${connection.lastCheckedAt ? new Date(connection.lastCheckedAt).toLocaleString() : '无'}${connection.stale ? '；目录已过期' : ''}`}
                />
                {connection.failureMessage && (
                  <InlineError
                    message={connection.failureMessage}
                    onRetry={() => test(connection)}
                  />
                )}
                {connection.tools.map((tool) => (
                  <ListRow
                    key={tool.id}
                    title={tool.name}
                    detail={tool.description}
                    meta={<Badge>{tool.reviewed ? '已审阅' : '待审阅'}</Badge>}
                    actions={
                      <Button
                        variant="quiet"
                        size="sm"
                        disabled={
                          !!busy ||
                          (tool.reviewed ?? false) ||
                          !tool.contractHash ||
                          (connection.stale ?? false) ||
                          tool.annotations?.readOnlyHint === false ||
                          tool.annotations?.destructiveHint === true
                        }
                        onClick={() => {
                          if (connection.revisionId && tool.contractHash)
                            act(
                              () =>
                                state.reviewTool({
                                  connectionId: connection.id,
                                  connectionRevisionId: connection.revisionId ?? '',
                                  toolId: tool.id,
                                  contractHash: tool.contractHash ?? '',
                                  readOnlyConfirmed: true,
                                }),
                              '审阅工具失败。',
                            );
                        }}
                      >
                        确认只读合同
                      </Button>
                    }
                  >
                    <Disclosure label="查看工具合同">
                      <TextArea
                        mono
                        rows={5}
                        readOnly
                        aria-label={`${tool.name} 的合同`}
                        value={JSON.stringify(
                          {
                            inputSchema: tool.inputSchema,
                            outputSchema: tool.outputSchema,
                            annotations: tool.annotations,
                          },
                          null,
                          2,
                        )}
                      />
                    </Disclosure>
                  </ListRow>
                ))}
              </Disclosure>
            </ListRow>
          ))}
        </div>
      )}
      {login && (
        <div className="mcp-editor">
          <SectionHeader title="确认授权范围" />
          <StatusNote message={`服务：${login.preparation.resource}`} />
          <Field label="授权服务器">
            <FieldSelect
              size="md"
              value={login.issuer}
              options={login.preparation.issuers.map((issuer) => ({ id: issuer, label: issuer }))}
              onChange={(issuer) => setLogin({ ...login, issuer })}
            />
          </Field>
          <StatusNote
            message={`请求权限：${login.preparation.scopes.join('、') || '服务未声明额外权限'}`}
          />
          <ActionBar as="div" label="OAuth 授权">
            <Button size="md" variant="secondary" onClick={cancel}>
              取消登录
            </Button>
            <Button size="md" variant="primary" onClick={continueLogin}>
              在浏览器中继续
            </Button>
          </ActionBar>
        </div>
      )}
      {form && (
        <div className="mcp-editor" inert={busy?.kind === 'save'}>
          <SectionHeader title={editing ? '编辑连接' : '新建连接'} />
          <Field label="名称">
            <TextField
              autoFocus
              size="md"
              value={form.name}
              onChange={(event) => change({ name: event.target.value })}
            />
          </Field>
          <Field label="连接方式">
            <FieldSelect
              size="md"
              options={transportOptions}
              value={form.kind}
              onChange={(kind) =>
                change({ kind: kind as McpTransport['kind'], secret: '', clearSecret: false })
              }
            />
          </Field>
          {form.kind === 'stdio' ? (
            <>
              <Field label="启动命令">
                <TextField
                  size="md"
                  value={form.command}
                  placeholder="node"
                  onChange={(event) => change({ command: event.target.value })}
                />
              </Field>
              <Field label="参数（每行一个）">
                <TextArea
                  mono
                  rows={3}
                  value={form.args}
                  onChange={(event) => change({ args: event.target.value })}
                />
              </Field>
              <Field label="工作目录（可选）">
                <TextField
                  size="md"
                  value={form.cwd}
                  onChange={(event) => change({ cwd: event.target.value })}
                />
              </Field>
              <Disclosure label="环境变量">
                <Field label="普通环境变量（每行 NAME=value）">
                  <TextArea
                    mono
                    rows={3}
                    value={form.env}
                    onChange={(event) => change({ env: event.target.value })}
                  />
                </Field>
                {form.secretEnv.map((item, index) => (
                  <div key={index}>
                    <Field label={`机密变量 ${index + 1} 的名称`}>
                      <TextField
                        size="md"
                        value={item.name}
                        onChange={(event) =>
                          change({
                            secretEnv: form.secretEnv.map((entry, i) =>
                              i === index ? { ...entry, name: event.target.value } : entry,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field
                      controlId={`mcp-env-secret-${index}`}
                      label={`${item.name || '机密变量'} 的新值`}
                      hint="空白沿用已保存凭据，值只写不读。"
                    >
                      <TextField
                        size="md"
                        id={`mcp-env-secret-${index}`}
                        type="password"
                        autoComplete="new-password"
                        value={item.value}
                        onChange={(event) =>
                          change({
                            secretEnv: form.secretEnv.map((entry, i) =>
                              i === index
                                ? { ...entry, value: event.target.value, clear: false }
                                : entry,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Switch
                      label="清空此机密值"
                      checked={item.clear}
                      onChange={(clear) =>
                        change({
                          secretEnv: form.secretEnv.map((entry, i) =>
                            i === index ? { ...entry, clear, value: '' } : entry,
                          ),
                        })
                      }
                    />
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() =>
                        change({ secretEnv: form.secretEnv.filter((_, i) => i !== index) })
                      }
                    >
                      移除变量映射
                    </Button>
                  </div>
                ))}
                <Button
                  size="md"
                  variant="secondary"
                  onClick={() =>
                    change({
                      secretEnv: [...form.secretEnv, { name: '', value: '', clear: false }],
                    })
                  }
                >
                  添加机密变量
                </Button>
              </Disclosure>
            </>
          ) : (
            <>
              <Field label="服务地址">
                <TextField
                  size="md"
                  value={form.endpoint}
                  placeholder={
                    form.kind === 'sse' ? 'https://example.com/sse' : 'https://example.com/mcp'
                  }
                  onChange={(event) =>
                    change({ endpoint: event.target.value, networkApproved: false })
                  }
                />
              </Field>
              <Field label="网络范围">
                <FieldSelect
                  size="md"
                  value={form.networkMode}
                  options={[
                    { id: 'public', label: '公网 HTTPS' },
                    { id: 'private', label: '私网 HTTPS' },
                    { id: 'loopback', label: '本机 loopback' },
                  ]}
                  onChange={(networkMode) =>
                    change({
                      networkMode: networkMode as McpForm['networkMode'],
                      networkApproved: false,
                    })
                  }
                />
              </Field>
              {form.networkMode !== 'public' && (
                <Switch
                  label="允许连接此地址的精确主机与端口"
                  checked={form.networkApproved}
                  onChange={(networkApproved) => change({ networkApproved })}
                />
              )}
              <Field label="认证方式">
                <FieldSelect
                  size="md"
                  value={form.auth}
                  options={authOptions}
                  onChange={(authMode) =>
                    change({
                      auth: authMode as McpAuthentication['mode'],
                      secret: '',
                      clearSecret: false,
                    })
                  }
                />
              </Field>
              {form.auth === 'api-key-header' && (
                <Field label="API Key 请求头名称">
                  <TextField
                    size="md"
                    value={form.headerName}
                    onChange={(event) => change({ headerName: event.target.value })}
                  />
                </Field>
              )}
              {form.auth !== 'none' && form.auth !== 'oauth' && (
                <Field
                  controlId="mcp-http-secret"
                  label={form.auth === 'bearer' ? 'Bearer Token' : 'API Key'}
                  hint="空白沿用已保存凭据，值只写不读。"
                >
                  <TextField
                    size="md"
                    id="mcp-http-secret"
                    type="password"
                    placeholder={
                      editing?.credentialSlots?.some(
                        (slot) => slot.slot === 'http-token' && slot.configured,
                      )
                        ? '已配置；留空沿用'
                        : '尚未配置'
                    }
                    autoComplete="new-password"
                    value={form.secret}
                    onChange={(event) => change({ secret: event.target.value, clearSecret: false })}
                  />
                </Field>
              )}
              <Disclosure label="高级选项">
                {form.kind === 'streamable-http' && (
                  <Switch
                    label="兼容旧 SSE 服务（仅握手时回退）"
                    checked={form.allowLegacySse}
                    onChange={(allowLegacySse) => change({ allowLegacySse })}
                  />
                )}
                {form.auth === 'oauth' && (
                  <>
                    <Field label="预注册 issuer（可选）">
                      <TextField
                        size="md"
                        value={form.issuer}
                        onChange={(event) => change({ issuer: event.target.value })}
                      />
                    </Field>
                    <Field label="预注册 Client ID（可选）">
                      <TextField
                        size="md"
                        value={form.clientId}
                        onChange={(event) => change({ clientId: event.target.value })}
                      />
                    </Field>
                    <Field
                      controlId="mcp-oauth-secret"
                      label="Client Secret（可选）"
                      hint="空白沿用已保存凭据，值只写不读。"
                    >
                      <TextField
                        size="md"
                        id="mcp-oauth-secret"
                        type="password"
                        autoComplete="new-password"
                        value={form.secret}
                        onChange={(event) =>
                          change({ secret: event.target.value, clearSecret: false })
                        }
                      />
                    </Field>
                    <Field label="客户端元数据文档 URL（可选）">
                      <TextField
                        size="md"
                        value={form.clientMetadataUrl}
                        onChange={(event) => change({ clientMetadataUrl: event.target.value })}
                      />
                    </Field>
                    <Field label="固定 loopback 回调端口（可选）">
                      <TextField
                        size="md"
                        inputMode="numeric"
                        value={form.callbackPort}
                        onChange={(event) => change({ callbackPort: event.target.value })}
                      />
                    </Field>
                    <Field
                      controlId="mcp-oauth-origins"
                      label="额外认证目的地（每行网络范围和完整 origin）"
                      hint="仅为本连接的 OAuth 授权；如 private https://login.example.com:8443。"
                    >
                      <TextArea
                        id="mcp-oauth-origins"
                        rows={3}
                        value={form.approvedOrigins}
                        onChange={(event) => change({ approvedOrigins: event.target.value })}
                      />
                    </Field>
                  </>
                )}
                {form.auth !== 'none' && (
                  <Switch
                    label="清空已保存的认证机密"
                    checked={form.clearSecret}
                    onChange={(clearSecret) => change({ clearSecret, secret: '' })}
                  />
                )}
              </Disclosure>
            </>
          )}
          {error && <InlineError message={error} onRetry={save} onDismiss={() => setError('')} />}
          <ActionBar as="div" label="保存 MCP 连接">
            <Button
              variant="secondary"
              size="md"
              disabled={!!busy}
              onClick={() => {
                setForm(undefined);
                setEditing(undefined);
                setError('');
              }}
            >
              取消
            </Button>
            <Button variant="primary" size="md" disabled={!!busy} onClick={save}>
              {busy?.kind === 'save' ? '正在保存…' : '保存'}
            </Button>
          </ActionBar>
        </div>
      )}
      {confirmation && (
        <ConfirmationDialog
          title="移除 MCP 连接"
          detail="这会取消使用此连接的活跃 Run，专家和任务中的选择将失效；历史身份与来源仍会保留。"
          confirmLabel="移除连接"
          onCancel={() => setConfirmation(undefined)}
          onConfirm={() => {
            const connection = confirmation;
            setConfirmation(undefined);
            act(
              () => state.remove(connection.id),
              '移除连接失败。',
              '连接已移除，历史记录已保留。',
            );
          }}
        />
      )}
      {toast && <TransientToast {...toast} onDismiss={dismissToast} />}
    </section>
  );
}

function ConnectionActions({
  connection,
  disabled,
  onLifecycle,
  onLogout,
  onRemove,
}: {
  connection: McpConnectionSummary;
  disabled: boolean;
  onLifecycle: () => void;
  onLogout: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={anchor}
        variant="quiet"
        size="sm"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        更多操作
      </Button>
      <PopoverMenu
        open={open}
        anchorRef={anchor}
        label={`${connection.name}的操作`}
        align="end"
        items={[
          {
            id: 'lifecycle',
            label: connection.lifecycle === 'enabled' ? '停用' : '启用',
            disabled: disabled || !connection.revisionId,
          },
          ...(connection.oauthStatus ? [{ id: 'logout', label: '退出登录', disabled }] : []),
          { id: 'remove', label: '移除', tone: 'danger', disabled },
        ]}
        onDismiss={() => setOpen(false)}
        onSelect={(id) => {
          setOpen(false);
          if (id === 'lifecycle') onLifecycle();
          if (id === 'logout') onLogout();
          if (id === 'remove') onRemove();
        }}
      />
    </>
  );
}
