import { createHash } from 'node:crypto';

import type { MemoryScope, WorkspaceArtifactReference } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import {
  type BriefMemoryRow,
  type BriefReader,
  buildWorkspaceBrief,
} from './workspace-brief-service';

const NOW = 1_000_000;

const sha = (value: string): string => createHash('sha256').update(value).digest('hex');

const workspaceScope: MemoryScope = { kind: 'workspace', workspaceId: 'ws-1' };
const expertWorkspaceScope: MemoryScope = {
  kind: 'expert-workspace',
  expertId: 'ex-1',
  workspaceId: 'ws-1',
};
const userScope: MemoryScope = { kind: 'user' };
const expertScope: MemoryScope = { kind: 'expert', expertId: 'ex-1' };

const row = (over: Partial<BriefMemoryRow> & { memoryId: string }): BriefMemoryRow => ({
  revisionId: `rev-${over.memoryId}`,
  contentHash: sha(`hash-${over.memoryId}`),
  content: '收入按回款金额统计。',
  facet: 'constraint',
  scope: workspaceScope,
  updatedAt: 10,
  sourceAvailability: 'available',
  requiresMaterialSelection: false,
  ...over,
});

const reference = (id: string, selectedAt: number): WorkspaceArtifactReference => ({
  id,
  workspaceId: 'ws-1',
  artifactVersionId: `v-${id}`,
  contentHash: sha(`h-${id}`),
  status: 'active',
  revision: 1,
  selectedAt,
  updatedAt: selectedAt,
});

const reader = (over: Partial<BriefReader> = {}): BriefReader => ({
  confirmedMemories: () => [],
  openCheckpoints: () => [],
  activeReferences: () => [],
  ...over,
});

describe('buildWorkspaceBrief', () => {
  it('is deterministic for the same data apart from generatedAt', () => {
    const source = reader({
      confirmedMemories: () => [
        row({ memoryId: 'b', updatedAt: 5 }),
        row({ memoryId: 'a', updatedAt: 5 }),
        row({ memoryId: 'c', updatedAt: 9, facet: 'goal' }),
      ],
    });
    const first = buildWorkspaceBrief('ws-1', source, { now: NOW });
    const second = buildWorkspaceBrief('ws-1', source, { now: NOW });
    expect({ ...first, generatedAt: 0 }).toEqual({ ...second, generatedAt: 0 });
    expect(first.constraints.items.map((item) => item.memoryId)).toEqual(['a', 'b']);
    expect(first.goals.items.map((item) => item.memoryId)).toEqual(['c']);
  });

  it('maps decision and fact into the decisions section only', () => {
    const brief = buildWorkspaceBrief(
      'ws-1',
      reader({
        confirmedMemories: () => [
          row({ memoryId: 'd', facet: 'decision' }),
          row({ memoryId: 'f', facet: 'fact' }),
          row({ memoryId: 'm', facet: 'method' }),
          row({ memoryId: 'p', facet: 'preference' }),
        ],
      }),
      { now: NOW },
    );
    expect(brief.decisions.items.map((item) => item.memoryId)).toEqual(['d', 'f']);
    expect(brief.methods.items.map((item) => item.memoryId)).toEqual(['m']);
    expect(brief.goals.items).toEqual([]);
    expect(brief.constraints.items).toEqual([]);
  });

  it('does not pass user preferences or expert methods off as workspace facts', () => {
    const brief = buildWorkspaceBrief(
      'ws-1',
      reader({
        confirmedMemories: () => [
          row({ memoryId: 'u', scope: userScope }),
          row({ memoryId: 'e', scope: expertScope }),
          row({ memoryId: 'w', scope: workspaceScope }),
        ],
      }),
      { now: NOW },
    );
    expect(brief.constraints.items.map((item) => item.memoryId)).toEqual(['w']);
  });

  it('excludes expired rows, review-required and unavailable sources from confirmed sections', () => {
    const brief = buildWorkspaceBrief(
      'ws-1',
      reader({
        confirmedMemories: () => [
          row({ memoryId: 'expired', validUntil: NOW - 1 }),
          row({ memoryId: 'future', validFrom: NOW + 1 }),
          row({ memoryId: 'review', sourceAvailability: 'review-required' }),
          row({ memoryId: 'gone', sourceAvailability: 'unavailable' }),
          row({ memoryId: 'ok', validFrom: NOW - 5, validUntil: NOW + 5 }),
        ],
      }),
      { now: NOW },
    );
    expect(brief.constraints.items.map((item) => item.memoryId)).toEqual(['ok']);
  });

  it('marks material-derived rows as still needing their material at use time', () => {
    const brief = buildWorkspaceBrief(
      'ws-1',
      reader({
        confirmedMemories: () => [row({ memoryId: 'derived', requiresMaterialSelection: true })],
      }),
      { now: NOW },
    );
    expect(brief.constraints.items[0]?.requiresMaterialSelection).toBe(true);
  });

  it('caps each confirmed section at ten and reports the total and truncation', () => {
    const many = Array.from({ length: 14 }, (_, index) =>
      row({ memoryId: `m${index}`, updatedAt: index }),
    );
    const brief = buildWorkspaceBrief('ws-1', reader({ confirmedMemories: () => many }), {
      now: NOW,
    });
    expect(brief.constraints.items).toHaveLength(10);
    expect(brief.constraints.total).toBe(14);
    expect(brief.constraints.truncated).toBe(true);
  });

  it('keeps open checkpoints marked unresolved and never confirmed', () => {
    const brief = buildWorkspaceBrief(
      'ws-1',
      reader({
        openCheckpoints: () => [
          {
            checkpointId: 'c-2',
            taskId: 't-1',
            summary: '续约口径待确认',
            feedback: '不含税',
            nextAction: '补数据',
            createdAt: 200,
          },
          { checkpointId: 'c-1', taskId: 't-1', summary: '待议', createdAt: 100 },
        ],
      }),
      { now: NOW },
    );
    expect(brief.openIssues.items.map((item) => item.checkpointId)).toEqual(['c-2', 'c-1']);
    expect(brief.openIssues.items[0]).not.toHaveProperty('resolved');
    expect(brief.openIssues.total).toBe(2);
  });

  it('lists the five most recent active references by selectedAt', () => {
    const refs = Array.from({ length: 7 }, (_, index) => ({
      reference: reference(`r${index}`, index * 10),
      artifactId: `a${index}`,
      available: index !== 6,
    }));
    const brief = buildWorkspaceBrief('ws-1', reader({ activeReferences: () => refs }), {
      now: NOW,
    });
    expect(brief.referenceVersions.items.map((item) => item.reference.id)).toEqual([
      'r6',
      'r5',
      'r4',
      'r3',
      'r2',
    ]);
    expect(brief.referenceVersions.total).toBe(7);
    expect(brief.referenceVersions.items[0]?.status).toBe('unavailable');
    expect(brief.referenceVersions.items[1]?.status).toBe('ready');
  });

  it('returns honest empty sections for an empty workspace', () => {
    const brief = buildWorkspaceBrief('ws-1', reader(), { now: NOW });
    expect(brief.goals).toEqual({ items: [], total: 0, truncated: false });
    expect(brief.openIssues.items).toEqual([]);
    expect(brief.referenceVersions.items).toEqual([]);
  });

  it('records the selected expert without widening the scope rules', () => {
    const brief = buildWorkspaceBrief(
      'ws-1',
      reader({
        confirmedMemories: () => [
          row({ memoryId: 'w', scope: workspaceScope }),
          row({ memoryId: 'ew', scope: expertWorkspaceScope }),
        ],
      }),
      { expertId: 'ex-1', now: NOW },
    );
    expect(brief.expertId).toBe('ex-1');
    // 同 updatedAt 时按 id 字节序升序，'ew' < 'w'。
    expect(brief.constraints.items.map((item) => item.memoryId)).toEqual(['ew', 'w']);
  });
});
