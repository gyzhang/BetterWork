import { PassThrough } from 'node:stream';

import type { JobSpec } from '@betterwork/agent-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeChildConfig {
  readonly pid?: number;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly stdoutData?: string[];
  readonly stderrData?: string[];
}

interface FakeChild {
  readonly pid: number;
  readonly stdout: PassThrough | null;
  readonly stderr: PassThrough | null;
  readonly stdin: PassThrough | null;
  readonly on: ReturnType<typeof vi.fn>;
  readonly once: ReturnType<typeof vi.fn>;
  readonly emit: ReturnType<typeof vi.fn>;
  readonly kill: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
}

const createFakeChild = (config: FakeChildConfig = {}): FakeChild => {
  const pid = config.pid ?? 12345;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();

  const on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    const existing = handlers.get(event) ?? [];
    existing.push(handler);
    handlers.set(event, existing);
  });

  const once = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    on(event, handler);
  });

  const emit = vi.fn((event: string, ...args: unknown[]) => {
    const eventHandlers = handlers.get(event) ?? [];
    for (const handler of eventHandlers) {
      handler(...args);
    }
    return eventHandlers.length > 0;
  });

  const kill = vi.fn();
  const destroy = vi.fn();

  queueMicrotask(() => {
    for (const data of config.stdoutData ?? []) {
      stdout.write(data);
    }
    for (const data of config.stderrData ?? []) {
      stderr.write(data);
    }
    if (config.exitCode !== undefined || config.signal !== undefined) {
      emit('exit', config.exitCode ?? null, config.signal ?? null);
    }
  });

  return {
    pid,
    stdout,
    stderr,
    stdin,
    on,
    once,
    emit,
    kill,
    destroy,
  };
};

let fakeChildConfig: FakeChildConfig;
let currentFakeChild: FakeChild | undefined;
let fakeSpawn: ReturnType<typeof vi.fn>;

vi.mock('node:child_process', () => {
  fakeSpawn = vi.fn(() => {
    currentFakeChild = createFakeChild(fakeChildConfig);
    return currentFakeChild;
  });
  return { spawn: fakeSpawn };
});

const loadModule = async () => {
  vi.resetModules();
  return import('./skill-guardian.ts');
};

let fakeStdin: PassThrough;
let fakeStdout: PassThrough;
let fakeStderr: PassThrough;

beforeEach(() => {
  fakeChildConfig = { pid: 12345, exitCode: 0 };
  currentFakeChild = undefined;

  fakeStdin = new PassThrough();
  fakeStdout = new PassThrough();
  fakeStderr = new PassThrough();

  Object.defineProperty(process, 'stdin', {
    value: fakeStdin,
    configurable: true,
  });
  Object.defineProperty(process, 'stdout', {
    value: fakeStdout,
    configurable: true,
  });
  Object.defineProperty(process, 'stderr', {
    value: fakeStderr,
    configurable: true,
  });

  vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  vi.spyOn(process, 'kill').mockImplementation(() => true);

  fakeStdin.setEncoding('utf8');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

const parseEvents = (chunks: Buffer[]): unknown[] => {
  const text = chunks.map((chunk: Buffer) => chunk.toString('utf8')).join('');
  return text
    .split('\n')
    .filter((line: string) => line.trim().length > 0)
    .map((line: string) => JSON.parse(line) as unknown);
};

const specOf = (overrides: Partial<JobSpec> = {}): JobSpec => ({
  protocolVersion: 1,
  executionId: 'exec-1',
  runId: 'run-1',
  toolCallId: 'tool-1',
  bindingId: 'binding-1',
  commandId: 'cmd-1',
  executable: '/bin/echo',
  argv: ['hello'],
  cwd: '/tmp',
  env: { PATH: '/usr/bin' },
  timeoutMs: 30000,
  maxOutputBytes: 1024,
  maxLogBytes: 1024,
  expectedOutputs: [],
  ...overrides,
});

describe('skill-guardian', () => {
  describe('readLaunchCommand validation', () => {
    it('rejects wrong protocol version', async () => {
      const outputChunks: Buffer[] = [];
      fakeStdout.on('data', (chunk: Buffer) => {
        outputChunks.push(chunk);
      });

      await loadModule();

      const command = {
        type: 'launch',
        protocolVersion: 999,
        nonce: 'test-nonce',
        graceMs: 500,
        spec: specOf(),
      };
      fakeStdin.write(`${JSON.stringify(command)}\n`);

      await vi.waitFor(
        () => {
          const events = parseEvents(outputChunks);
          return events.some(
            (event) =>
              typeof event === 'object' &&
              event !== null &&
              (event as { type: string }).type === 'failure',
          );
        },
        { timeout: 1000 },
      );

      const events = parseEvents(outputChunks);
      expect(events.length).toBeGreaterThan(0);
      const failureEvent = events.find(
        (event) =>
          typeof event === 'object' &&
          event !== null &&
          (event as { type: string }).type === 'failure',
      ) as { code: string } | undefined;
      expect(failureEvent?.code).toBe('malformed-launch');
    });

    it('rejects missing nonce', async () => {
      const outputChunks: Buffer[] = [];
      fakeStdout.on('data', (chunk: Buffer) => {
        outputChunks.push(chunk);
      });

      await loadModule();

      const command = {
        type: 'launch',
        protocolVersion: 1,
        graceMs: 500,
        spec: specOf(),
      };
      fakeStdin.write(`${JSON.stringify(command)}\n`);

      await vi.waitFor(
        () => {
          const events = parseEvents(outputChunks);
          return events.some(
            (event) =>
              typeof event === 'object' &&
              event !== null &&
              (event as { type: string }).type === 'failure',
          );
        },
        { timeout: 1000 },
      );

      const events = parseEvents(outputChunks);
      const failureEvent = events.find(
        (event) =>
          typeof event === 'object' &&
          event !== null &&
          (event as { type: string }).type === 'failure',
      ) as { code: string } | undefined;
      expect(failureEvent?.code).toBe('malformed-launch');
    });

    it('rejects empty nonce', async () => {
      const outputChunks: Buffer[] = [];
      fakeStdout.on('data', (chunk: Buffer) => {
        outputChunks.push(chunk);
      });

      await loadModule();

      const command = {
        type: 'launch',
        protocolVersion: 1,
        nonce: '',
        graceMs: 500,
        spec: specOf(),
      };
      fakeStdin.write(`${JSON.stringify(command)}\n`);

      await vi.waitFor(
        () => {
          const events = parseEvents(outputChunks);
          return events.some(
            (event) =>
              typeof event === 'object' &&
              event !== null &&
              (event as { type: string }).type === 'failure',
          );
        },
        { timeout: 1000 },
      );

      const events = parseEvents(outputChunks);
      const failureEvent = events.find(
        (event) =>
          typeof event === 'object' &&
          event !== null &&
          (event as { type: string }).type === 'failure',
      ) as { code: string } | undefined;
      expect(failureEvent?.code).toBe('malformed-launch');
    });

    it('rejects non-positive graceMs', async () => {
      const outputChunks: Buffer[] = [];
      fakeStdout.on('data', (chunk: Buffer) => {
        outputChunks.push(chunk);
      });

      await loadModule();

      const command = {
        type: 'launch',
        protocolVersion: 1,
        nonce: 'test-nonce',
        graceMs: 0,
        spec: specOf(),
      };
      fakeStdin.write(`${JSON.stringify(command)}\n`);

      await vi.waitFor(
        () => {
          const events = parseEvents(outputChunks);
          return events.some(
            (event) =>
              typeof event === 'object' &&
              event !== null &&
              (event as { type: string }).type === 'failure',
          );
        },
        { timeout: 1000 },
      );

      const events = parseEvents(outputChunks);
      const failureEvent = events.find(
        (event) =>
          typeof event === 'object' &&
          event !== null &&
          (event as { type: string }).type === 'failure',
      ) as { code: string } | undefined;
      expect(failureEvent?.code).toBe('malformed-launch');
    });
  });

  describe('protocol handling', () => {
    it('rejects malformed JSON', async () => {
      const outputChunks: Buffer[] = [];
      fakeStdout.on('data', (chunk: Buffer) => {
        outputChunks.push(chunk);
      });

      await loadModule();

      fakeStdin.write('{not valid json\n');

      await vi.waitFor(
        () => {
          const events = parseEvents(outputChunks);
          return events.some(
            (event) =>
              typeof event === 'object' &&
              event !== null &&
              (event as { type: string }).type === 'failure',
          );
        },
        { timeout: 1000 },
      );

      const events = parseEvents(outputChunks);
      const failureEvent = events.find(
        (event) =>
          typeof event === 'object' &&
          event !== null &&
          (event as { type: string }).type === 'failure',
      ) as { code: string } | undefined;
      expect(failureEvent?.code).toBe('malformed-command');
    });

    it('rejects non-object commands', async () => {
      const outputChunks: Buffer[] = [];
      fakeStdout.on('data', (chunk: Buffer) => {
        outputChunks.push(chunk);
      });

      await loadModule();

      fakeStdin.write('"just a string"\n');

      await vi.waitFor(
        () => {
          const events = parseEvents(outputChunks);
          return events.some(
            (event) =>
              typeof event === 'object' &&
              event !== null &&
              (event as { type: string }).type === 'failure',
          );
        },
        { timeout: 1000 },
      );

      const events = parseEvents(outputChunks);
      const failureEvent = events.find(
        (event) =>
          typeof event === 'object' &&
          event !== null &&
          (event as { type: string }).type === 'failure',
      ) as { code: string } | undefined;
      expect(failureEvent?.code).toBe('malformed-command');
    });
  });

  describe('launch flow', () => {
    it('spawns child and emits started event', async () => {
      const outputChunks: Buffer[] = [];
      fakeStdout.on('data', (chunk: Buffer) => {
        outputChunks.push(chunk);
      });

      fakeChildConfig = { pid: 99999, exitCode: 0 };

      await loadModule();

      const command = {
        type: 'launch',
        protocolVersion: 1,
        nonce: 'test-nonce',
        graceMs: 500,
        spec: specOf(),
      };
      fakeStdin.write(`${JSON.stringify(command)}\n`);

      await vi.waitFor(
        () => {
          const events = parseEvents(outputChunks);
          return events.some(
            (event) =>
              typeof event === 'object' &&
              event !== null &&
              (event as { type: string }).type === 'started',
          );
        },
        { timeout: 2000 },
      );

      const events = parseEvents(outputChunks);
      const startedEvent = events.find(
        (event) =>
          typeof event === 'object' &&
          event !== null &&
          (event as { type: string }).type === 'started',
      ) as { type: string; pid: number; nonce: string } | undefined;
      expect(startedEvent?.pid).toBe(99999);
      expect(startedEvent?.nonce).toBe('test-nonce');

      expect(fakeSpawn).toHaveBeenCalled();

      // Wait for async cleanup to complete
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    });
  });
});
