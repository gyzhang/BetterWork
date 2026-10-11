import { Buffer } from 'node:buffer';

import type { KnowledgeWorkerRequest } from '@betterwork/agent-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExtractDocument } = vi.hoisted(() => {
  process.env.BETTERWORK_KNOWLEDGE_WORKER_NONCE = 'test-nonce';
  return { mockExtractDocument: vi.fn<() => Promise<unknown>>() };
});

vi.mock('../services/knowledge-extract.ts', () => ({
  extractDocument: mockExtractDocument,
}));

import { float32From, handleLine, scanBatch } from './knowledge-worker.ts';

const encodeFloat32 = (values: number[]): string =>
  Buffer.from(new Float32Array(values).buffer).toString('base64');

interface WrittenResponse {
  readonly id: string;
  readonly nonce: string;
  readonly kind: string;
}

let writtenLines: WrittenResponse[];
let originalStdoutWrite: typeof process.stdout.write | undefined;

beforeEach(() => {
  writtenLines = [];
  mockExtractDocument.mockReset();
  originalStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (text: string | Uint8Array) => {
    if (typeof text === 'string') {
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          writtenLines.push(JSON.parse(trimmed) as WrittenResponse);
        }
      }
    }
    return true;
  };
});

afterEach(() => {
  if (originalStdoutWrite) {
    process.stdout.write = originalStdoutWrite;
    originalStdoutWrite = undefined;
  }
  vi.restoreAllMocks();
});

describe('float32From', () => {
  it('decodes base64-encoded float32 values', () => {
    const result = float32From(encodeFloat32([1.0, 2.0, 3.0]));
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(3);
    expect(result[0]).toBeCloseTo(1.0);
    expect(result[1]).toBeCloseTo(2.0);
    expect(result[2]).toBeCloseTo(3.0);
  });

  it('returns an empty array for an empty buffer', () => {
    const result = float32From(Buffer.alloc(0).toString('base64'));
    expect(result.length).toBe(0);
  });

  it('truncates trailing bytes that do not fill a complete float32', () => {
    const result = float32From(Buffer.from([0, 0, 128, 63, 99]).toString('base64'));
    expect(result.length).toBe(1);
    expect(result[0]).toBeCloseTo(1.0);
  });
});

describe('scanBatch', () => {
  it('returns scores sorted descending by cosine similarity', () => {
    const query = new Float32Array([1, 0]);
    const entries = [
      { chunkId: 'a', vectorBase64: encodeFloat32([0, 1]) },
      { chunkId: 'b', vectorBase64: encodeFloat32([1, 0]) },
      { chunkId: 'c', vectorBase64: encodeFloat32([0.7071, 0.7071]) },
    ];
    const result = scanBatch(query, 2, entries);
    expect(result[0]?.chunkId).toBe('b');
    expect(result[1]?.chunkId).toBe('c');
    expect(result[2]?.chunkId).toBe('a');
  });

  it('limits results to at most 50 entries', () => {
    const query = new Float32Array([1, 0]);
    const entries = Array.from({ length: 60 }, (_, index) => ({
      chunkId: `c-${String(index).padStart(2, '0')}`,
      vectorBase64: encodeFloat32([1, 0]),
    }));
    const result = scanBatch(query, 2, entries);
    expect(result.length).toBe(50);
  });

  it('breaks score ties by chunkId in locale order', () => {
    const query = new Float32Array([1, 0]);
    const entries = [
      { chunkId: 'z', vectorBase64: encodeFloat32([1, 0]) },
      { chunkId: 'a', vectorBase64: encodeFloat32([1, 0]) },
      { chunkId: 'm', vectorBase64: encodeFloat32([1, 0]) },
    ];
    const result = scanBatch(query, 2, entries);
    expect(result.map((entry) => entry.chunkId)).toEqual(['a', 'm', 'z']);
  });

  it('throws when an entry vector dimension does not match the space', () => {
    const query = new Float32Array([1, 0]);
    const entries = [{ chunkId: 'wrong', vectorBase64: encodeFloat32([1, 0, 0]) }];
    expect(() => {
      scanBatch(query, 2, entries);
    }).toThrow(/向量维度与空间不符/u);
  });
});

describe('handleLine', () => {
  it('ignores empty and whitespace-only lines', async () => {
    await handleLine('');
    await handleLine('   ');
    await handleLine('\t');
    expect(writtenLines).toHaveLength(0);
  });

  it('returns WORKER_REQUEST_INVALID for malformed JSON', async () => {
    await handleLine('{not valid json');
    expect(writtenLines).toHaveLength(1);
    expect(writtenLines[0]).toMatchObject({
      id: 'invalid',
      nonce: 'unknown',
      kind: 'error',
    });
  });

  it('returns WORKER_REQUEST_INVALID when the schema does not match', async () => {
    await handleLine(JSON.stringify({ id: 'req-1' }));
    expect(writtenLines).toHaveLength(1);
    expect(writtenLines[0]).toMatchObject({
      id: 'req-1',
      nonce: 'unknown',
      kind: 'error',
    });
  });

  it('returns WORKER_NONCE_MISMATCH when the nonce differs', async () => {
    const request = {
      id: 'req-2',
      nonce: 'wrong-nonce',
      op: 'shutdown' as const,
    };
    await handleLine(JSON.stringify(request));
    expect(writtenLines).toHaveLength(1);
    expect(writtenLines[0]).toMatchObject({
      id: 'req-2',
      kind: 'error',
    });
  });

  it('responds with shutdown and calls process.exit on shutdown op', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('EXIT_CALLED');
    });
    const request = {
      id: 'req-3',
      nonce: 'test-nonce',
      op: 'shutdown',
    };
    try {
      await handleLine(JSON.stringify(request));
    } catch {
      // process.exit throws in test
    }
    expect(writtenLines).toHaveLength(1);
    expect(writtenLines[0]).toMatchObject({
      id: 'req-3',
      nonce: 'test-nonce',
      kind: 'shutdown',
    });
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it('returns scores for a valid scan request', async () => {
    const request = {
      id: 'scan-1',
      nonce: 'test-nonce',
      op: 'scan' as const,
      spaceId: 'space-1',
      dimension: 2,
      queryBase64: encodeFloat32([1, 0]),
      entries: [
        { chunkId: 'a', vectorBase64: encodeFloat32([1, 0]) },
        { chunkId: 'b', vectorBase64: encodeFloat32([0, 1]) },
      ],
    };
    await handleLine(JSON.stringify(request));
    expect(writtenLines).toHaveLength(1);
    expect(writtenLines[0]).toMatchObject({
      id: 'scan-1',
      nonce: 'test-nonce',
      kind: 'scores',
    });
  });

  it('returns WORKER_SCAN_FAILED when the query dimension mismatches', async () => {
    const request = {
      id: 'scan-2',
      nonce: 'test-nonce',
      op: 'scan' as const,
      spaceId: 'space-1',
      dimension: 3,
      queryBase64: encodeFloat32([1, 0]),
      entries: [{ chunkId: 'a', vectorBase64: encodeFloat32([1, 0, 0]) }],
    };
    await handleLine(JSON.stringify(request));
    expect(writtenLines).toHaveLength(1);
    expect(writtenLines[0]).toMatchObject({
      id: 'scan-2',
      kind: 'error',
    });
  });

  it('returns a result for a valid extract request', async () => {
    mockExtractDocument.mockResolvedValue({
      format: 'markdown',
      content: '# Hello',
      warnings: [],
      sections: [{ title: 'Hello', level: 1, body: 'Hello' }],
    });
    const request: KnowledgeWorkerRequest = {
      id: 'ext-1',
      nonce: 'test-nonce',
      op: 'extract',
      job: { jobId: 'job-1', attempt: 1 },
      format: 'markdown',
      dataBase64: Buffer.from('# Hello').toString('base64'),
    };
    await handleLine(JSON.stringify(request));
    expect(writtenLines).toHaveLength(1);
    expect(writtenLines[0]).toMatchObject({
      id: 'ext-1',
      nonce: 'test-nonce',
      kind: 'result',
    });
  });

  it('returns WORKER_EXTRACT_FAILED when extraction throws', async () => {
    mockExtractDocument.mockRejectedValue(new Error('boom'));
    const request: KnowledgeWorkerRequest = {
      id: 'ext-2',
      nonce: 'test-nonce',
      op: 'extract',
      job: { jobId: 'job-2', attempt: 1 },
      format: 'markdown',
      dataBase64: Buffer.from('data').toString('base64'),
    };
    await handleLine(JSON.stringify(request));
    expect(writtenLines).toHaveLength(1);
    expect(writtenLines[0]).toMatchObject({
      id: 'ext-2',
      kind: 'error',
    });
  });
});
