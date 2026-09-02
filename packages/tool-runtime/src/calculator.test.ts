import { describe, expect, it } from 'vitest';
import { calculatorTool } from './calculator';

const context = {
  runId: 'run-1',
  workspacePath: '.',
  signal: new AbortController().signal,
  reportProgress() {},
};

describe('calculatorTool', () => {
  it('respects arithmetic precedence', async () => {
    await expect(calculatorTool.execute({ expression: '(12 + 8) * 3' }, context))
      .resolves.toEqual({ expression: '(12 + 8) * 3', result: 60 });
  });

  it('rejects executable input', async () => {
    await expect(calculatorTool.execute({ expression: 'process.exit()' }, context))
      .rejects.toThrow('Expected number');
  });
});
