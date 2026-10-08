import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import readline from 'node:readline';
import process from 'node:process';

const modern = process.argv.includes('--modern');
if (process.env.MCP_FIXTURE_ENV_FILE)
  writeFileSync(
    process.env.MCP_FIXTURE_ENV_FILE,
    JSON.stringify({
      inheritedSecret: process.env.MCP_PARENT_SECRET ?? null,
      nodeOptions: process.env.NODE_OPTIONS ?? null,
      electronNode: process.env.ELECTRON_RUN_AS_NODE ?? null,
      explicitValue: process.env.MCP_EXPLICIT_VALUE ?? null,
    }),
  );
if (process.env.MCP_FIXTURE_PID_FILE) {
  const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  appendFileSync(process.env.MCP_FIXTURE_PID_FILE, `${process.pid},${descendant.pid}\n`);
}
const serverInfo = { name: 'betterwork-finance-fixture', version: '0.1.0' };
const tools = [
  {
    name: 'finance.monthly_summary',
    description: '只读返回指定月份的经营数字。',
    inputSchema: {
      type: 'object',
      properties: { month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' } },
      required: ['month'],
      additionalProperties: false,
    },
  },
];

const reply = (id, result) =>
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: '2.0', id, result: modern ? { ...result, resultType: 'complete' } : result })}\n`,
  );
const error = (id, code, message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);

const handle = (message) => {
  if (
    message.method === 'notifications/initialized' ||
    message.method === 'notifications/cancelled'
  )
    return;
  if (message.method === 'server/discover') {
    if (process.argv.includes('--exit-on-probe')) process.exit(0);
    if (modern) {
      reply(message.id, { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } });
      return;
    }
  }
  if (message.method === 'initialize') {
    reply(message.id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo,
    });
    return;
  }
  if (message.method === 'tools/list') {
    reply(message.id, { tools, ...(modern ? { ttlMs: 0, cacheScope: 'private' } : {}) });
    return;
  }
  if (message.method === 'tools/call') {
    const name = message.params?.name;
    const month = message.params?.arguments?.month;
    if (name !== 'finance.monthly_summary') {
      error(message.id, -32601, 'Unknown tool');
      return;
    }
    if (typeof month !== 'string' || !/^\d{4}-\d{2}$/u.test(month)) {
      error(message.id, -32602, 'month must use YYYY-MM');
      return;
    }
    if (month === '2099-98') {
      reply(message.id, {
        structuredContent: { payload: 'x'.repeat(100_001) },
        isError: false,
      });
      return;
    }
    const text =
      month === '2099-99'
        ? 'x'.repeat(100_001)
        : JSON.stringify({ month, revenue: 1200000, cost: 760000, source: 'fixture-ledger' });
    reply(message.id, {
      content: [
        {
          type: 'text',
          text,
        },
      ],
      isError: false,
    });
    return;
  }
  error(message.id, -32601, `Unknown method: ${message.method}`);
};

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  try {
    handle(JSON.parse(line));
  } catch {
    process.stderr.write('invalid JSON-RPC request\n');
  }
});
