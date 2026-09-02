import type { AgentTool } from '@betterwork/agent-core';
import { z } from 'zod';

const inputSchema = z.object({ expression: z.string().min(1).max(500) });

class Parser {
  private cursor = 0;

  constructor(private readonly expression: string) {}

  parse(): number {
    const result = this.parseExpression();
    this.skipWhitespace();
    if (this.cursor !== this.expression.length) throw new Error(`Unexpected token at position ${this.cursor + 1}`);
    if (!Number.isFinite(result)) throw new Error('Result is not finite');
    return result;
  }

  private parseExpression(): number {
    let value = this.parseTerm();
    while (true) {
      this.skipWhitespace();
      if (this.take('+')) value += this.parseTerm();
      else if (this.take('-')) value -= this.parseTerm();
      else return value;
    }
  }

  private parseTerm(): number {
    let value = this.parseFactor();
    while (true) {
      this.skipWhitespace();
      if (this.take('*')) value *= this.parseFactor();
      else if (this.take('/')) {
        const divisor = this.parseFactor();
        if (divisor === 0) throw new Error('Division by zero');
        value /= divisor;
      } else return value;
    }
  }

  private parseFactor(): number {
    this.skipWhitespace();
    if (this.take('+')) return this.parseFactor();
    if (this.take('-')) return -this.parseFactor();
    if (this.take('(')) {
      const value = this.parseExpression();
      this.skipWhitespace();
      if (!this.take(')')) throw new Error(`Expected closing parenthesis at position ${this.cursor + 1}`);
      return value;
    }
    const match = this.expression.slice(this.cursor).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (!match) throw new Error(`Expected number at position ${this.cursor + 1}`);
    this.cursor += match[0].length;
    return Number(match[0]);
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.expression[this.cursor] ?? '')) this.cursor += 1;
  }

  private take(token: string): boolean {
    if (this.expression[this.cursor] !== token) return false;
    this.cursor += 1;
    return true;
  }
}

export const calculatorTool: AgentTool = {
  name: 'calculator',
  description: 'Perform deterministic arithmetic with +, -, *, / and parentheses.',
  inputSchema: {
    type: 'object',
    properties: { expression: { type: 'string' } },
    required: ['expression'],
    additionalProperties: false,
  },
  async execute(rawInput, context) {
    if (context.signal.aborted) throw Object.assign(new Error('Run cancelled'), { name: 'AbortError' });
    const { expression } = inputSchema.parse(rawInput);
    context.reportProgress(`正在计算 ${expression}`);
    return { expression, result: new Parser(expression).parse() };
  },
};
