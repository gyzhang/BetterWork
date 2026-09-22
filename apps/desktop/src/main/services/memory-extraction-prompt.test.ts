import { describe, expect, it } from 'vitest';

import {
  assembleExtractionRequest,
  EXTRACTION_LIMITS,
  type ExtractionFragment,
  extractionInstructionCodePoints,
  parseExtractionOutput,
} from './memory-extraction-prompt';

const fragments: ExtractionFragment[] = [
  { id: 'f1', role: 'user-prompt', text: '收入一律按回款金额统计，不使用签约金额。' },
  { id: 'f2', role: 'assistant-answer', text: '好的，我按签约金额来算。' },
];

const validCandidate = {
  content: '收入按回款金额统计，不使用签约金额。',
  facet: 'constraint',
  evidence: [{ fragmentId: 'f1', start: 0, end: 8 }],
};

const wrap = (candidates: unknown): string => JSON.stringify({ candidates });

const okResult = (raw: string): ExtractOk => {
  const parsed = parseExtractionOutput(raw, fragments, 'stop');
  if (!parsed.ok) throw new Error(`unexpected rejection: ${parsed.detail}`);
  return parsed;
};

interface ExtractOk {
  ok: true;
  candidates: readonly unknown[];
}

describe('assembleExtractionRequest', () => {
  it('sends only the minimal evidence plus disambiguating background', () => {
    const assembled = assembleExtractionRequest({
      userPrompt: '收入一律按回款金额统计。',
      backgroundAnswer: '我按签约金额来算。',
    });
    expect(assembled.text).toContain('收入一律按回款金额统计。');
    expect(assembled.text).toContain('我按签约金额来算。');
    expect(assembled.fragments.map((fragment) => fragment.role)).toEqual([
      'user-prompt',
      'assistant-answer',
    ]);
  });

  it('keeps human feedback as the primary fragment for checkpoint jobs', () => {
    const assembled = assembleExtractionRequest({
      userPrompt: '',
      checkpointFeedback: '这里应该用不含税口径。',
      checkpointSummary: '本期续约讨论。',
    });
    expect(assembled.fragments[0]?.role).toBe('checkpoint-feedback');
    expect(assembled.fragments.some((fragment) => fragment.role === 'checkpoint-summary')).toBe(
      true,
    );
  });

  it('marks truncation instead of silently dropping the middle', () => {
    const assembled = assembleExtractionRequest({ userPrompt: '口'.repeat(5_000) });
    expect(assembled.truncated).toBe(true);
    expect(assembled.text).toContain('已截去中间内容');
  });

  it('respects the fixed instruction and whole-request code point ceilings', () => {
    expect(extractionInstructionCodePoints()).toBeLessThanOrEqual(
      EXTRACTION_LIMITS.instructionMaxCodePoints,
    );
    const assembled = assembleExtractionRequest({
      userPrompt: '径'.repeat(3_000),
      backgroundAnswer: '径'.repeat(3_000),
      checkpointSummary: '径'.repeat(1_000),
    });
    expect([...assembled.text].length).toBeLessThanOrEqual(EXTRACTION_LIMITS.requestMaxCodePoints);
  });
});

describe('parseExtractionOutput', () => {
  it('accepts zero candidates as a successful result', () => {
    expect(okResult(wrap([])).candidates).toEqual([]);
  });

  it('accepts a well-formed candidate with human evidence', () => {
    const result = okResult(wrap([validCandidate]));
    expect(result.candidates).toHaveLength(1);
  });

  it('rejects a candidate supported only by assistant text', () => {
    const parsed = parseExtractionOutput(
      wrap([{ ...validCandidate, evidence: [{ fragmentId: 'f2', start: 0, end: 5 }] }]),
      fragments,
      'stop',
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe('INVALID_MODEL_OUTPUT');
  });

  it('rejects evidence ranges outside the fragment that was actually sent', () => {
    const parsed = parseExtractionOutput(
      wrap([{ ...validCandidate, evidence: [{ fragmentId: 'f1', start: 0, end: 999 }] }]),
      fragments,
      'stop',
    );
    expect(parsed.ok).toBe(false);
  });

  it('rejects evidence pointing at a fragment that was never sent', () => {
    const parsed = parseExtractionOutput(
      wrap([{ ...validCandidate, evidence: [{ fragmentId: 'f9', start: 0, end: 3 }] }]),
      fragments,
      'stop',
    );
    expect(parsed.ok).toBe(false);
  });

  it('rejects code fences, trailing prose and any extra top-level key', () => {
    expect(parseExtractionOutput('```json\n{"candidates":[]}\n```', fragments, 'stop').ok).toBe(
      false,
    );
    expect(parseExtractionOutput('{"candidates":[]} 希望有帮助', fragments, 'stop').ok).toBe(false);
    expect(
      parseExtractionOutput('{"candidates":[],"scope":{"kind":"user"}}', fragments, 'stop').ok,
    ).toBe(false);
  });

  it('rejects host-owned fields smuggled into a candidate', () => {
    for (const forbidden of ['status', 'id', 'contentHash', 'materialDependencies']) {
      const parsed = parseExtractionOutput(
        wrap([{ ...validCandidate, [forbidden]: 'x' }]),
        fragments,
        'stop',
      );
      expect(parsed.ok, forbidden).toBe(false);
    }
  });

  it('rejects more than three candidates and an over-long body', () => {
    const four = Array.from({ length: 4 }, () => validCandidate);
    expect(parseExtractionOutput(wrap(four), fragments, 'stop').ok).toBe(false);
    const long = parseExtractionOutput(
      wrap([{ ...validCandidate, content: '口'.repeat(501) }]),
      fragments,
      'stop',
    );
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.code).toBe('OUTPUT_LIMIT');
  });

  it('distinguishes truncation, tool calls and an unknown finish reason', () => {
    expect(parseExtractionOutput(wrap([]), fragments, 'length')).toMatchObject({
      code: 'MODEL_OUTPUT_TRUNCATED',
    });
    expect(parseExtractionOutput(wrap([]), fragments, 'tool-calls')).toMatchObject({
      code: 'MODEL_TOOL_CALL_REJECTED',
    });
    expect(parseExtractionOutput(wrap([]), fragments, undefined)).toMatchObject({
      code: 'MODEL_FINISH_UNKNOWN',
    });
    expect(parseExtractionOutput(wrap([]), fragments, 'content-filter')).toMatchObject({
      code: 'MODEL_FINISH_UNKNOWN',
    });
  });

  it('rejects an unknown facet and an out-of-range confidence', () => {
    expect(
      parseExtractionOutput(wrap([{ ...validCandidate, facet: 'gossip' }]), fragments, 'stop').ok,
    ).toBe(false);
    expect(
      parseExtractionOutput(wrap([{ ...validCandidate, confidence: 2 }]), fragments, 'stop').ok,
    ).toBe(false);
  });

  it('keeps optional topicKey and confidence only when the model really returned them', () => {
    const result = okResult(wrap([{ ...validCandidate, topicKey: '收入口径', confidence: 0.8 }]));
    expect(result.candidates[0]).toMatchObject({ topicKey: '收入口径', confidence: 0.8 });
    const bare = okResult(wrap([validCandidate]));
    expect(bare.candidates[0]).not.toHaveProperty('topicKey');
  });
});
