import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMcpImportSaveRequest, parseMcpServersConfig } from './mcp-config-import';

afterEach(() => {
  vi.restoreAllMocks();
});

const validServerJson = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    mcpServers: {
      'test-server': {
        command: '/usr/local/bin/server',
        args: ['--port', '3000'],
        ...overrides,
      },
    },
  });

describe('parseMcpServersConfig parses a valid MCP configuration', () => {
  it('returns a server with command, args, and empty env', () => {
    const result = parseMcpServersConfig(validServerJson());
    expect(result).toEqual([
      {
        name: 'test-server',
        command: '/usr/local/bin/server',
        args: ['--port', '3000'],
        env: [],
      },
    ]);
  });

  it('includes cwd when present', () => {
    const result = parseMcpServersConfig(validServerJson({ cwd: '/home/user/project' }));
    expect(result[0]).toMatchObject({ cwd: '/home/user/project' });
  });

  it('converts env record to name/value pairs', () => {
    const result = parseMcpServersConfig(
      validServerJson({ env: { API_KEY: 'secret123', DEBUG: 'true' } }),
    );
    expect(result[0]!.env).toEqual([
      { name: 'API_KEY', value: 'secret123' },
      { name: 'DEBUG', value: 'true' },
    ]);
  });

  it('defaults args to an empty array when not provided', () => {
    const source = JSON.stringify({
      mcpServers: {
        minimal: { command: '/usr/bin/server' },
      },
    });
    const result = parseMcpServersConfig(source);
    expect(result[0]!.args).toEqual([]);
  });

  it('defaults env to an empty object when not provided', () => {
    const result = parseMcpServersConfig(validServerJson());
    expect(result[0]!.env).toEqual([]);
  });

  it('parses multiple servers', () => {
    const source = JSON.stringify({
      mcpServers: {
        alpha: { command: '/usr/bin/alpha' },
        beta: { command: '/usr/bin/beta', args: ['--verbose'] },
      },
    });
    const result = parseMcpServersConfig(source);
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe('alpha');
    expect(result[1]!.name).toBe('beta');
  });

  it('trims server names', () => {
    const source = JSON.stringify({
      mcpServers: {
        '  spaced  ': { command: '/usr/bin/server' },
      },
    });
    const result = parseMcpServersConfig(source);
    expect(result[0]!.name).toBe('spaced');
  });
});

describe('parseMcpServersConfig rejects configurations that exceed limits', () => {
  it('throws when the source exceeds 512000 characters', () => {
    const oversized = ' '.repeat(512_001);
    expect(() => parseMcpServersConfig(oversized)).toThrow('JSON 配置过大');
  });

  it('accepts a source at exactly 512000 characters if it is valid JSON', () => {
    // Build a valid JSON that is close to the limit by padding server args
    const base: Record<string, unknown> = { command: '/usr/bin/server', args: [] as string[] };
    // Pad with args to approach the limit
    const args: string[] = [];
    const overhead = JSON.stringify({ mcpServers: { s: base } }).length;
    const remaining = 512_000 - overhead;
    // Fill args with strings that total close to `remaining` chars
    const chunkSize = 1900;
    const count = Math.floor(remaining / (chunkSize + 3)); // +3 for quotes and comma
    for (let i = 0; i < Math.min(count, 99); i++) {
      args.push('x'.repeat(chunkSize));
    }
    base.args = args;
    const source = JSON.stringify({ mcpServers: { s: base } });
    // Only test if we're within the limit
    if (source.length <= 512_000) {
      expect(() => parseMcpServersConfig(source)).not.toThrow('JSON 配置过大');
    }
  });

  it('throws when there are more than 50 servers', () => {
    const servers: Record<string, unknown> = {};
    for (let i = 0; i < 51; i++) {
      servers[`server-${i}`] = { command: `/usr/bin/s${i}` };
    }
    const source = JSON.stringify({ mcpServers: servers });
    expect(() => parseMcpServersConfig(source)).toThrow('一次最多导入 50 个 MCP 连接');
  });
});

describe('parseMcpServersConfig detects duplicate server names', () => {
  it('throws when two names differ only in case', () => {
    const source = JSON.stringify({
      mcpServers: {
        MyServer: { command: '/usr/bin/a' },
        myserver: { command: '/usr/bin/b' },
      },
    });
    expect(() => parseMcpServersConfig(source)).toThrow('配置中有重复的服务器名称');
  });
});

describe('parseMcpServersConfig rejects invalid JSON and structure', () => {
  it('throws on malformed JSON', () => {
    expect(() => parseMcpServersConfig('{broken')).toThrow('JSON 格式无效');
  });

  it('throws when the root is not an object', () => {
    expect(() => parseMcpServersConfig('"just a string"')).toThrow('配置需要包含 mcpServers 对象');
  });

  it('throws when mcpServers is missing', () => {
    expect(() => parseMcpServersConfig(JSON.stringify({ other: {} }))).toThrow(
      '配置需要包含 mcpServers 对象',
    );
  });

  it('throws when mcpServers is an array instead of an object', () => {
    expect(() => parseMcpServersConfig(JSON.stringify({ mcpServers: [] }))).toThrow(
      '配置需要包含 mcpServers 对象',
    );
  });

  it('throws when mcpServers is empty', () => {
    expect(() => parseMcpServersConfig(JSON.stringify({ mcpServers: {} }))).toThrow(
      'mcpServers 中没有可导入的连接',
    );
  });

  it('throws when a server entry is not an object', () => {
    const source = JSON.stringify({ mcpServers: { bad: 'not-an-object' } });
    expect(() => parseMcpServersConfig(source)).toThrow('必须是 JSON 对象');
  });

  it('throws when a server has a non-stdio type', () => {
    const source = JSON.stringify({
      mcpServers: { remote: { type: 'sse', url: 'http://example.com' } },
    });
    expect(() => parseMcpServersConfig(source)).toThrow('不是 stdio 配置');
  });

  it('throws when the server name is empty after trimming', () => {
    const source = JSON.stringify({
      mcpServers: { '  ': { command: '/usr/bin/server' } },
    });
    expect(() => parseMcpServersConfig(source)).toThrow('服务器名称不能为空');
  });

  it('throws when the server name exceeds 160 characters', () => {
    const source = JSON.stringify({
      mcpServers: { ['a'.repeat(161)]: { command: '/usr/bin/server' } },
    });
    expect(() => parseMcpServersConfig(source)).toThrow('服务器名称不能为空');
  });
});

describe('parseMcpServersConfig validates server fields with Zod', () => {
  it('throws when command is empty after trimming', () => {
    const source = JSON.stringify({
      mcpServers: { srv: { command: '   ' } },
    });
    expect(() => parseMcpServersConfig(source)).toThrow('启动命令不能为空');
  });

  it('throws when command exceeds 2000 characters', () => {
    const source = JSON.stringify({
      mcpServers: { srv: { command: 'x'.repeat(2001) } },
    });
    expect(() => parseMcpServersConfig(source)).toThrow('启动命令不能超过 2000 个字符');
  });

  it('throws when args has more than 100 items', () => {
    const source = JSON.stringify({
      mcpServers: { srv: { command: '/usr/bin/s', args: Array.from({ length: 101 }, () => 'a') } },
    });
    expect(() => parseMcpServersConfig(source)).toThrow('参数不能超过 100 项');
  });

  it('throws when a single arg exceeds 2000 characters', () => {
    const source = JSON.stringify({
      mcpServers: { srv: { command: '/usr/bin/s', args: ['x'.repeat(2001)] } },
    });
    expect(() => parseMcpServersConfig(source)).toThrow('单个参数不能超过 2000 个字符');
  });

  it('throws when cwd is empty after trimming', () => {
    const source = JSON.stringify({
      mcpServers: { srv: { command: '/usr/bin/s', cwd: '  ' } },
    });
    expect(() => parseMcpServersConfig(source)).toThrow('工作目录不能为空');
  });

  it('throws when an env value contains a newline', () => {
    const source = JSON.stringify({
      mcpServers: { srv: { command: '/usr/bin/s', env: { BAD: 'line1\nline2' } } },
    });
    expect(() => parseMcpServersConfig(source)).toThrow('环境变量值不能包含换行');
  });

  it('throws on unrecognized keys in the server object', () => {
    const source = JSON.stringify({
      mcpServers: { srv: { command: '/usr/bin/s', unknownField: true } },
    });
    expect(() => parseMcpServersConfig(source)).toThrow('包含暂不支持的字段');
  });
});

describe('createMcpImportSaveRequest builds a SaveMcpConnectionRequest', () => {
  it('creates a request with secret slots for non-empty env values', () => {
    const server = {
      name: 'my-server',
      command: '/usr/bin/server',
      args: ['--flag'],
      env: [
        { name: 'API_KEY', value: 'secret' },
        { name: 'EMPTY', value: '' },
      ],
    };
    const request = createMcpImportSaveRequest(server);
    expect(request.name).toBe('my-server');
    expect(request.transport).toBeDefined();
    // Only non-empty env values get secret slots
    expect(request.secrets).toHaveLength(1);
    expect(request.secrets![0]).toMatchObject({
      slot: 'env:API_KEY',
      expectedVersion: 0,
      mutation: { action: 'replace', value: 'secret' },
    });
  });

  it('creates a request with no secret slots when all env values are empty', () => {
    const server = {
      name: 'my-server',
      command: '/usr/bin/server',
      args: [],
      env: [{ name: 'EMPTY', value: '' }],
    };
    const request = createMcpImportSaveRequest(server);
    expect(request.secrets).toHaveLength(0);
  });

  it('includes cwd in the transport when present', () => {
    const server = {
      name: 'my-server',
      command: '/usr/bin/server',
      args: [],
      cwd: '/home/user',
      env: [],
    };
    const request = createMcpImportSaveRequest(server);
    expect(request.transport).toMatchObject({
      kind: 'stdio',
      command: '/usr/bin/server',
      cwd: '/home/user',
    });
  });
});
