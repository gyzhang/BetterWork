import { analyzeSourcedBusinessMetrics } from '@betterwork/tool-runtime';
import { describe, expect, it } from 'vitest';

import {
  auditMaterialFacts,
  createBusinessMetricFactsValidator,
  createMaterialFactLedger,
  type MaterialFactLedger,
  recordDeterministicBusinessMetrics,
  recordMaterialFacts,
  validateAndRecordBusinessMetricFacts,
} from './material-fact-policy';

const createLedger = (
  sourceContent = '收入 2026-09：120 万元。收入 2026-08：100 万元。',
): MaterialFactLedger => {
  const ledger = createMaterialFactLedger({
    explicitBusinessAnalysis: true,
    materialScope: true,
    selectedMaterialCount: 1,
    prompt: '',
  });
  recordMaterialFacts(ledger, {
    kind: 'material-read',
    sourceId: 'read-1:0',
    content: sourceContent,
  });
  return ledger;
};

const sourcedInput = {
  period: '2026-09',
  current: {
    收入: { value: 120, unit: '万元', period: '2026-09', sourceId: 'read-1:0' },
  },
  previous: {
    收入: { value: 100, unit: '万元', period: '2026-08', sourceId: 'read-1:0' },
  },
};

describe('material fact policy for explicitly scoped business analysis', () => {
  it('does not apply numeric business policy to ordinary selected-material runs', () => {
    const ledger = createMaterialFactLedger({
      explicitBusinessAnalysis: false,
      materialScope: true,
      selectedMaterialCount: 1,
      prompt: '',
    });
    expect(ledger.enabled).toBe(false);
    expect(auditMaterialFacts(ledger, '收入777万元。')).toBeUndefined();
    expect(auditMaterialFacts(ledger, '客户已续约。')).toContain('定性事实');
    expect(() => createBusinessMetricFactsValidator(ledger)(sourcedInput)).toThrow(
      '当前 Run 未启用显式经营分析',
    );
  });

  it('requires selected material to be read before completing an explicit analysis', () => {
    const ledger = createMaterialFactLedger({
      explicitBusinessAnalysis: true,
      materialScope: true,
      selectedMaterialCount: 1,
      prompt: '',
    });
    expect(auditMaterialFacts(ledger, '')).toContain('没有成功读取任何材料');
    recordMaterialFacts(ledger, {
      kind: 'material-read',
      sourceId: 'empty-read',
      content: '没有数值的说明。',
    });
    expect(auditMaterialFacts(ledger, '')).toBeUndefined();
  });

  it('requires a source read in this Run and verifies metric, value, unit and period there', () => {
    const ledger = createLedger();
    expect(() =>
      validateAndRecordBusinessMetricFacts(ledger, {
        ...sourcedInput,
        current: {
          收入: { ...sourcedInput.current.收入, sourceId: 'unread-source' },
        },
      }),
    ).toThrow('本次 Run 未读取的来源');
    expect(() =>
      validateAndRecordBusinessMetricFacts(ledger, {
        ...sourcedInput,
        current: {
          收入: { ...sourcedInput.current.收入, value: 121 },
        },
      }),
    ).toThrow('来源未同时提供指标“收入”的数值、单位和期间');
    expect(() =>
      validateAndRecordBusinessMetricFacts(ledger, {
        ...sourcedInput,
        current: {
          收入: { ...sourcedInput.current.收入, period: '2026-07' },
        },
      }),
    ).toThrow('来源未同时提供指标“收入”的数值、单位和期间');
    expect(ledger.facts).toEqual([]);
  });

  it('binds facts to their own claim clause instead of pooling a source line', () => {
    const source = '2026-10 收入 100 万元，成本 80 万元；2026-09 收入 90 万元。';
    const accepted = createLedger(source);
    validateAndRecordBusinessMetricFacts(accepted, {
      period: '2026-10',
      current: {
        收入: { value: 100, unit: '万元', period: '2026-10', sourceId: 'read-1:0' },
      },
    });
    expect(accepted.facts).toHaveLength(1);

    for (const value of [80, 90]) {
      const rejected = createLedger(source);
      expect(() =>
        validateAndRecordBusinessMetricFacts(rejected, {
          period: '2026-10',
          current: {
            收入: { value, unit: '万元', period: '2026-10', sourceId: 'read-1:0' },
          },
        }),
      ).toThrow('来源未同时提供指标“收入”的数值、单位和期间');
      expect(rejected.facts).toEqual([]);
    }
  });

  it('shares one explicit period across separate metric clauses and rejects ambiguous pairing', () => {
    const sharedPeriod = createLedger('2026-10 收入 100 万元，成本 80 万元。');
    validateAndRecordBusinessMetricFacts(sharedPeriod, {
      period: '2026-10',
      current: {
        收入: { value: 100, unit: '万元', period: '2026-10', sourceId: 'read-1:0' },
        成本: { value: 80, unit: '万元', period: '2026-10', sourceId: 'read-1:0' },
      },
    });
    expect(sharedPeriod.facts).toHaveLength(2);

    const ambiguous = createLedger('2026-10 收入和成本分别为 100 万元和 80 万元。');
    expect(() =>
      validateAndRecordBusinessMetricFacts(ambiguous, {
        period: '2026-10',
        current: {
          收入: { value: 100, unit: '万元', period: '2026-10', sourceId: 'read-1:0' },
          成本: { value: 80, unit: '万元', period: '2026-10', sourceId: 'read-1:0' },
        },
      }),
    ).toThrow('来源未同时提供指标“收入”的数值、单位和期间');
    expect(ambiguous.facts).toEqual([]);
  });

  it('rejects conflicting assertions for the same actual metric and period', () => {
    const ledger = createLedger('收入 2026-09：120万元。收入 2026-09：121万元。');
    expect(() =>
      validateAndRecordBusinessMetricFacts(ledger, {
        period: '2026-09',
        current: {
          收入: { value: 120, unit: '万元', period: '2026-09', sourceId: 'read-1:0' },
        },
      }),
    ).toThrow('来源存在相互冲突的指标“收入”事实');
    expect(ledger.facts).toEqual([]);
  });

  it('does not treat a pending numeric statement as an asserted actual fact', () => {
    const ledger = createLedger('收入 2026-09 待确认：120万元。');
    expect(() =>
      validateAndRecordBusinessMetricFacts(ledger, {
        period: '2026-09',
        current: {
          收入: { value: 120, unit: '万元', period: '2026-09', sourceId: 'read-1:0' },
        },
      }),
    ).toThrow('来源未同时提供指标“收入”的数值、单位和期间');
  });

  it('normalizes explicit month spellings while keeping actual and budget values distinct', () => {
    const ledger = createLedger('2026年10月实际收入为100万元且预算收入为80万元。');
    validateAndRecordBusinessMetricFacts(ledger, {
      period: '2026-10',
      current: {
        收入: { value: 100, unit: '万元', period: '2026-10', sourceId: 'read-1:0' },
      },
    });
    validateAndRecordBusinessMetricFacts(ledger, {
      period: '2026-10',
      current: {
        收入: { value: 100, unit: '万元', period: '2026-10', sourceId: 'read-1:0' },
      },
      budget: {
        收入: { value: 80, unit: '万元', period: '2026年10月', sourceId: 'read-1:0' },
      },
    });
    expect(ledger.facts).toHaveLength(2);

    const actualOnly = createLedger('2026年10月实际收入为100万元。');
    expect(() =>
      validateAndRecordBusinessMetricFacts(actualOnly, {
        period: '2026-10',
        current: {
          收入: { value: 100, unit: '万元', period: '2026-10', sourceId: 'read-1:0' },
        },
        budget: {
          收入: { value: 80, unit: '万元', period: '2026-10', sourceId: 'read-1:0' },
        },
      }),
    ).toThrow('来源未同时提供指标“收入”的数值、单位和期间');
    expect(actualOnly.facts).toEqual([]);
  });

  it('normalizes explicit dates without allowing a different day to support the fact', () => {
    const ledger = createLedger('收入 2026年10月02日：120万元。');
    expect(() =>
      validateAndRecordBusinessMetricFacts(ledger, {
        period: '2026-10-02',
        current: {
          收入: { value: 120, unit: '万元', period: '2026-10-02', sourceId: 'read-1:0' },
        },
      }),
    ).not.toThrow();

    const wrongDay = createLedger('收入 2026年10月02日：120万元。');
    expect(() =>
      validateAndRecordBusinessMetricFacts(wrongDay, {
        period: '2026-10-01',
        current: {
          收入: { value: 120, unit: '万元', period: '2026-10-01', sourceId: 'read-1:0' },
        },
      }),
    ).toThrow('来源未同时提供指标“收入”的数值、单位和期间');
    expect(wrongDay.facts).toEqual([]);
  });

  it('rejects same-basis conflicts across separately read sources before recording any facts', () => {
    const ledger = createLedger('收入 2026-09：120万元。');
    recordMaterialFacts(ledger, {
      kind: 'material-read',
      sourceId: 'read-2:0',
      content: '收入 2026-09：121万元。',
    });
    expect(() =>
      validateAndRecordBusinessMetricFacts(ledger, {
        period: '2026-09',
        current: {
          收入: { value: 120, unit: '万元', period: '2026-09', sourceId: 'read-1:0' },
        },
        previous: {
          收入: { value: 121, unit: '万元', period: '2026-09', sourceId: 'read-2:0' },
        },
      }),
    ).toThrow('来源存在相互冲突的指标事实');
    expect(ledger.facts).toEqual([]);
  });

  it('does not leave a valid earlier fact in the ledger when a later fact is rejected', () => {
    const ledger = createLedger('收入 2026-09：120万元。成本 2026-09：80万元。');
    expect(() =>
      validateAndRecordBusinessMetricFacts(ledger, {
        period: '2026-09',
        current: {
          收入: { value: 120, unit: '万元', period: '2026-09', sourceId: 'read-1:0' },
          成本: { value: 81, unit: '万元', period: '2026-09', sourceId: 'read-1:0' },
        },
      }),
    ).toThrow();
    expect(ledger.facts).toEqual([]);
  });

  it('preserves whitespace and full-width percent normalization while requiring an exact unit', () => {
    const ledger = createLedger('收入 2026-09：120　万元；毛利率 2026-09：12.5 ％。');
    validateAndRecordBusinessMetricFacts(ledger, {
      period: '2026-09',
      current: {
        收入: { value: 120, unit: '万元', period: '2026-09', sourceId: 'read-1:0' },
        毛利率: { value: 12.5, unit: '%', period: '2026-09', sourceId: 'read-1:0' },
      },
    });
    expect(ledger.facts).toHaveLength(2);
    expect(() =>
      validateAndRecordBusinessMetricFacts(ledger, {
        period: '2026-09',
        current: {
          收入: { value: 120, unit: '元', period: '2026-09', sourceId: 'read-1:0' },
        },
      }),
    ).toThrow('来源未同时提供指标“收入”的数值、单位和期间');
  });

  it('allows only source-linked direct facts and deterministic derived facts with matching dimensions', () => {
    const ledger = createLedger();
    validateAndRecordBusinessMetricFacts(ledger, sourcedInput);
    expect(
      auditMaterialFacts(ledger, '收入 2026-09：120万元；收入 2026-08：100万元。'),
    ).toBeUndefined();
    expect(
      auditMaterialFacts(ledger, '收入 2026-09 对比 2026-08 变化 20万元、变化率20%。'),
    ).toContain('缺少同一指标、单位、期间和来源关联');

    const result = analyzeSourcedBusinessMetrics(sourcedInput);
    recordDeterministicBusinessMetrics(ledger, result);
    expect(
      auditMaterialFacts(
        ledger,
        '收入 2026-09：120万元；收入 2026-08：100万元；收入 2026-09 对比 2026-08 变化 20万元，变化率20%。',
      ),
    ).toBeUndefined();
    expect(auditMaterialFacts(ledger, '成本 2026-09 对比 2026-08 变化 20万元。')).toContain(
      '数字（20）',
    );
    expect(auditMaterialFacts(ledger, '收入 2026-09 对比 2026-07 变化 20万元。')).toContain(
      '数字（20）',
    );
    expect(auditMaterialFacts(ledger, '收入 2026-09 对比 2026-08 变化 20元。')).toContain(
      '数字（20）',
    );
  });

  it('does not authorize arithmetic combinations until a deterministic result records them', () => {
    const ledger = createLedger('收入 2026-09：120万元；客户数 2026-09：100家。');
    validateAndRecordBusinessMetricFacts(ledger, {
      period: '2026-09',
      current: {
        收入: { value: 120, unit: '万元', period: '2026-09', sourceId: 'read-1:0' },
        客户数: { value: 100, unit: '家', period: '2026-09', sourceId: 'read-1:0' },
      },
    });
    expect(auditMaterialFacts(ledger, '收入 2026-09 多 20万元。')).toContain('数字（20）');
    expect(auditMaterialFacts(ledger, '客户数 2026-09 为 100家。')).toBeUndefined();
  });

  it('audits explicit units beyond currency and percentage spellings', () => {
    const ledger = createLedger('订单量 2026-09：12箱。');
    validateAndRecordBusinessMetricFacts(ledger, {
      period: '2026-09',
      current: {
        订单量: { value: 12, unit: '箱', period: '2026-09', sourceId: 'read-1:0' },
      },
    });
    expect(auditMaterialFacts(ledger, '订单量 2026-09：12箱。')).toBeUndefined();
    expect(auditMaterialFacts(ledger, '订单量 2026-09：12人。')).toContain('数字（12）');
  });

  it('rejects a tool result that cannot be traced to the facts validated before calculation', () => {
    const ledger = createLedger();
    validateAndRecordBusinessMetricFacts(ledger, sourcedInput);
    const result = analyzeSourcedBusinessMetrics(sourcedInput);
    const invalidResult = {
      ...result,
      metrics: result.metrics.map((metric) => ({ ...metric, currentSourceId: 'other' })),
    };
    expect(() => recordDeterministicBusinessMetrics(ledger, invalidResult)).toThrow(
      '未匹配已核验输入',
    );
  });

  it('retains run-local fact sources and rejects source ID collisions', () => {
    const ledger = createLedger();
    const other = createLedger('成本 2026-09：120万元。');
    validateAndRecordBusinessMetricFacts(ledger, {
      period: '2026-09',
      current: { 收入: sourcedInput.current.收入 },
    });
    expect(ledger.facts).toHaveLength(1);
    expect(other.facts).toHaveLength(0);
    expect(() =>
      recordMaterialFacts(ledger, {
        kind: 'material-read',
        sourceId: 'read-1:0',
        content: '被替换的另一份来源。',
      }),
    ).toThrow('来源 ID 冲突');
  });
});
