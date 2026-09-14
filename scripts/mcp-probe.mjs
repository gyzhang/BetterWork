import { once } from 'node:events';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const server = path.join(process.cwd(), 'scripts', 'fixtures', 'mcp-finance-readonly-server.mjs');
const child = spawn(process.execPath, [server], { stdio: ['pipe', 'pipe', 'pipe'] });
let nextId = 1;
let buffer = '';
const pending = new Map();

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    const resolve = pending.get(message.id);
    if (!resolve) continue;
    pending.delete(message.id);
    resolve(message);
  }
});

const request = (method, params = {}) => {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP probe timed out: ${method}`));
    }, 2_000);
    pending.set(id, (message) => {
      globalThis.clearTimeout(timeout);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  });
};

try {
  const initialized = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'betterwork-probe', version: '0.1.0' },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const discovered = await request('tools/list');
  if (initialized.serverInfo?.name !== 'betterwork-finance-fixture')
    throw new Error('handshake failed');
  if (!discovered.tools?.some((tool) => tool.name === 'finance.monthly_summary')) {
    throw new Error('finance tool was not discovered');
  }
  const result = await request('tools/call', {
    name: 'finance.monthly_summary',
    arguments: { month: '2026-08' },
  });
  if (result.isError || !result.content?.[0]?.text?.includes('2026-08')) {
    throw new Error('finance tool result was invalid');
  }
  child.stdin.end();
  await once(child, 'close');
  if (child.exitCode !== 0) throw new Error(`MCP fixture exited with ${child.exitCode}`);
  globalThis.console.log('MCP probe passed: initialize -> tools/list -> tools/call -> clean close');
} catch (error) {
  child.kill('SIGTERM');
  await once(child, 'close').catch(() => undefined);
  globalThis.console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
