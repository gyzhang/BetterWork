import { describe, expect, it } from 'vitest';

import {
  auditMaterialFacts,
  createMaterialFactLedger,
  type MaterialFactLedger,
  recordMaterialFacts,
} from './material-fact-policy';

const ledgerWithRead = (content: string, prompt = ''): MaterialFactLedger => {
  const ledger = createMaterialFactLedger({
    materialScope: true,
    selectedMaterialCount: 1,
    prompt,
  });
  recordMaterialFacts(ledger, { kind: 'material-read', content });
  return ledger;
};

describe('material fact policy', () => {
  it.each([
    [false, 0, false],
    [false, 1, false],
    [true, 0, false],
    [true, 1, true],
    [true, 2_000, true],
  ])(
    'uses only material scope %s and selected count %s',
    (materialScope, selectedMaterialCount, enabled) => {
      const ledger = createMaterialFactLedger({ materialScope, selectedMaterialCount, prompt: '' });
      expect(ledger.enabled).toBe(enabled);
      const error = auditMaterialFacts(ledger, '记录777万元，已续约。');
      if (enabled) expect(error).toContain('没有成功读取任何材料');
      else expect(error).toBeUndefined();
    },
  );

  it('does not count the prompt or deterministic results as a material read', () => {
    const ledger = createMaterialFactLedger({
      materialScope: true,
      selectedMaterialCount: 1,
      prompt: '原值80万元。',
    });
    recordMaterialFacts(ledger, {
      kind: 'deterministic-result',
      content: '{"current":130,"previous":100,"changeRate":0.3}',
    });
    expect(auditMaterialFacts(ledger, '130万元；30%。')).toContain('没有成功读取任何材料');
    recordMaterialFacts(ledger, { kind: 'material-read', content: '已实际返回的口径说明。' });
    expect(auditMaterialFacts(ledger, '130万元；30%。')).toBeUndefined();
  });

  it.each([
    ['家', ' ', '10'],
    ['户', '\t', '-12.5'],
    ['客户', '　', '+10.25'],
    ['%', '\n', '10.5'],
    ['％', '　', '-12.5'],
    ['万元', '\t', '130'],
    ['元', ' ', '1.23456'],
  ])('keeps %s normalization with %j before %s', (unit, whitespace, value) => {
    const fact = `记录${value}${whitespace}${unit}。`;
    expect(auditMaterialFacts(ledgerWithRead(fact), `记录${value}${unit}。`)).toBeUndefined();
    expect(
      auditMaterialFacts(ledgerWithRead('实际口径说明。', fact), `记录${value}${unit}。`),
    ).toBeUndefined();
  });

  it('does not take bare prompt numbers as facts', () => {
    expect(
      auditMaterialFacts(ledgerWithRead('实际口径说明。', '请分析第777项。'), '777万元。'),
    ).toContain('数字（777）');
    expect(
      auditMaterialFacts(ledgerWithRead('实际口径说明。', '输入777万元。'), '777万元。'),
    ).toBeUndefined();
  });

  it.each(['客户数（家） | 本期 | 10', '客户数量：10', '客户数是10', '客户数本期10'])(
    'retains count label %s',
    (content) => {
      expect(auditMaterialFacts(ledgerWithRead(content), '客户数：10')).toBeUndefined();
      expect(auditMaterialFacts(ledgerWithRead(content), '客户数量：11')).toContain('数字（11）');
    },
  );

  it('keeps count claims separate from rounded amounts and derived differences', () => {
    const ledger = ledgerWithRead('收入130万元，上期100万元，新增10家。');
    expect(auditMaterialFacts(ledger, '变化30万元，变化率30%，比例130%。')).toBeUndefined();
    expect(auditMaterialFacts(ledger, '新增30家。')).toContain('数字（30）');
    expect(auditMaterialFacts(ledger, '新增10.5户。')).toContain('数字（10.5）');
    expect(auditMaterialFacts(ledger, '新增10客户。')).toBeUndefined();
  });

  it('retains explicit percentage values and the legacy self-ratio', () => {
    const ledger = ledgerWithRead('金额130万元。');
    expect(auditMaterialFacts(ledger, '100%。')).toBeUndefined();
    expect(auditMaterialFacts(ledger, '130%。')).toContain('数字（130）');
    recordMaterialFacts(ledger, { kind: 'material-read', content: '实际比例130％。' });
    expect(auditMaterialFacts(ledger, '130%。')).toBeUndefined();
  });

  it('retains negative comparison and rounding behavior', () => {
    expect(
      auditMaterialFacts(ledgerWithRead('本期-80，上期-100。'), '变化20元，变化率20%。'),
    ).toBeUndefined();
    const rounded = ledgerWithRead('记录1.23456元。');
    expect(auditMaterialFacts(rounded, '1.23元，1.2元，1元。')).toBeUndefined();
    expect(auditMaterialFacts(rounded, '1.25元。')).toContain('数字（1.25）');
  });

  it('retains the legacy distinction between a serialized fraction and a percentage claim', () => {
    const ledger = ledgerWithRead('实际口径说明。');
    recordMaterialFacts(ledger, { kind: 'deterministic-result', content: '{"changeRate":0.3}' });
    expect(auditMaterialFacts(ledger, '30元。')).toBeUndefined();
    expect(auditMaterialFacts(ledger, '30%。')).toContain('数字（30）');
  });

  it('does not derive ratios from a zero comparison', () => {
    const ledger = ledgerWithRead('唯一输入0元。');
    expect(auditMaterialFacts(ledger, '0元。')).toBeUndefined();
    expect(auditMaterialFacts(ledger, '100%。')).toContain('数字（100）');
  });

  it('retains the strict tolerance for count claims', () => {
    const ledger = ledgerWithRead('新增0家。');
    expect(auditMaterialFacts(ledger, '新增0.00999家。')).toBeUndefined();
    expect(auditMaterialFacts(ledger, '新增0.01家。')).toContain('数字（0.01）');
    expect(auditMaterialFacts(ledger, '新增-0.01家。')).toContain('数字（-0.01）');
  });

  it('matches multiple nearby output queries without losing a different unit category', () => {
    const ledger = ledgerWithRead('本期130，上期100。');
    expect(auditMaterialFacts(ledger, '30.009元；29.991元；30%；130%；100%。')).toBeUndefined();
    expect(auditMaterialFacts(ledger, '30元；30家；30%；30户。')).toContain('数字（30）');
    expect(auditMaterialFacts(ledger, '777元；888%；777元；客户数：999')).toContain(
      '数字（777、888、999）',
    );
  });

  it('matches derived values across reads and retains decisions after more input arrives', () => {
    const ledger = ledgerWithRead('本期130。');
    expect(auditMaterialFacts(ledger, '30元。')).toContain('数字（30）');
    recordMaterialFacts(ledger, { kind: 'material-read', content: '上期100。' });
    expect(auditMaterialFacts(ledger, '30元；30%。')).toBeUndefined();
    recordMaterialFacts(ledger, { kind: 'material-read', content: '上期100。' });
    expect(auditMaterialFacts(ledger, '30元；30%。')).toBeUndefined();
  });

  it.each(['已续约', '已流失', '平均客单价', '续约率', '流失率', '客户总数', '总客户数'])(
    'requires affirmative support for %s',
    (claim) => {
      expect(auditMaterialFacts(ledgerWithRead('实际口径说明。'), `${claim}。`)).toContain(
        '定性事实',
      );
      expect(auditMaterialFacts(ledgerWithRead(`${claim}。`), `${claim}。`)).toBeUndefined();
      expect(
        auditMaterialFacts(ledgerWithRead(`是否${claim}，材料未提供。`), `${claim}。`),
      ).toContain('定性事实');
    },
  );

  it.each([
    '材料未提供已续约状态。',
    '是否已续约？',
    '建议确认已续约状态。',
    '如果已续约再更新。',
    '已续约状态未知。',
  ])('allows a nonassertive output %s', (content) => {
    expect(auditMaterialFacts(ledgerWithRead('实际口径说明。'), content)).toBeUndefined();
  });

  it('keeps the local negation window and checks a later affirmative occurrence', () => {
    const ledger = ledgerWithRead('实际口径说明。');
    const separated = `材料未提供。${'。'.repeat(60)}已续约。`;
    expect(auditMaterialFacts(ledger, separated)).toContain('已续约状态');
    recordMaterialFacts(ledger, { kind: 'material-read', content: separated });
    expect(auditMaterialFacts(ledger, '已续约。')).toBeUndefined();
  });

  it('reports numeric failures before qualitative failures with the original wording', () => {
    const error = auditMaterialFacts(ledgerWithRead('实际口径说明。'), '777元，已续约。');
    expect(error).toBe(
      '材料事实校验失败：最终输出包含本次 Run 材料或确定性工具未提供的数字（777）。请重新读取材料，并将缺失数据明确写为“材料未提供”。',
    );
  });

  it('keeps separate Runs independent', () => {
    const first = ledgerWithRead('新增1家。');
    const second = ledgerWithRead('新增2家。');
    expect(auditMaterialFacts(first, '1家。')).toBeUndefined();
    expect(auditMaterialFacts(first, '2家。')).toContain('数字（2）');
    expect(auditMaterialFacts(second, '2家。')).toBeUndefined();
    expect(auditMaterialFacts(second, '1家。')).toContain('数字（1）');
  });
});
