import readline from 'node:readline';
import process from 'node:process';

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
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
const error = (id, code, message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);

const handle = (message) => {
  if (
    message.method === 'notifications/initialized' ||
    message.method === 'notifications/cancelled'
  )
    return;
  if (message.method === 'initialize') {
    reply(message.id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo,
    });
    return;
  }
  if (message.method === 'tools/list') {
    reply(message.id, { tools });
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
    reply(message.id, {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ month, revenue: 1200000, cost: 760000, source: 'fixture-ledger' }),
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
