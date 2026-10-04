import type { ExpertRevision } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import { scheduleExpertRevisionChanges } from './schedule-expert-diff';

const revision = (overrides: Partial<ExpertRevision> = {}): ExpertRevision => ({
  id: 'revision-1',
  expertId: 'expert-1',
  revision: 1,
  name: '分析专家',
  summary: '财务与运营',
  author: '',
  tags: ['分析'],
  identity: '完成经营复盘',
  principles: ['依据来源'],
  inputRequirements: ['本期数据'],
  deliveryRequirements: ['Markdown'],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' },
  modelReference: { mode: 'application-default' },
  createdAt: 1,
  ...overrides,
});

describe('scheduleExpertRevisionChanges', () => {
  it('lists only changed read-only ExpertRevision fields with both exact values', () => {
    const changes = scheduleExpertRevisionChanges(
      revision(),
      revision({
        id: 'revision-2',
        revision: 2,
        identity: '同时比较季度趋势',
        principles: ['依据来源', '标记口径差异'],
        modelReference: { mode: 'profile', modelProfileId: 'profile-2' },
      }),
    );

    expect(changes.map((item) => item.key)).toEqual(['identity', 'principles', 'modelReference']);
    expect(changes[0]).toMatchObject({
      label: '人格与职责',
      before: '完成经营复盘',
      after: '同时比较季度趋势',
    });
    expect(changes[1]?.after).toContain('标记口径差异');
    expect(changes[2]?.after).toContain('profile-2');
  });

  it('treats omitted optional MCP and reference arrays as empty', () => {
    expect(
      scheduleExpertRevisionChanges(revision(), revision({ id: 'revision-2', revision: 2 })),
    ).toEqual([]);
  });
});
