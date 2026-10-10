import type { MemoryRecord, MemoryScope } from '@betterwork/agent-protocol';

import {
  type PotentialConflictPair,
  scopesIntersect,
  validityIntersects,
} from '../memory-conflict-policy';
import { memoryContentHash, normalizedMemoryHash } from '../memory-content-policy';
import { buildUserInstructionProvenance } from '../memory-provenance';

export const conflictRecord = (
  overrides: Partial<MemoryRecord> & { id: string; content: string },
): MemoryRecord => ({
  revisionId: `rev-${overrides.id}`,
  revision: 1,
  recallPolicy: 'relevant',
  scope: { kind: 'workspace', workspaceId: 'ws-1' },
  kind: 'semantic',
  sourceType: 'user-explicit',
  confidence: 0.9,
  status: 'confirmed',
  contentHash: memoryContentHash(overrides.content),
  createdAt: 1_000,
  updatedAt: 2_000,
  facet: 'fact',
  normalizedHash: normalizedMemoryHash(overrides.content),
  provenance: buildUserInstructionProvenance({
    capturedAt: 1_000,
    operationId: '00000000-0000-4000-8000-000000000000',
    content: overrides.content,
    genericDeclaration: false,
  }),
  ...overrides,
});

export const legacyConflictPairs = (records: readonly MemoryRecord[]): PotentialConflictPair[] => {
  const pairs: PotentialConflictPair[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const left = records[index];
    if (left === undefined) continue;
    for (let next = index + 1; next < records.length; next += 1) {
      const right = records[next];
      if (right === undefined) continue;
      if (
        left.id !== right.id &&
        left.topicKey !== undefined &&
        left.topicKey === right.topicKey &&
        left.normalizedHash !== right.normalizedHash &&
        scopesIntersect(left.scope, right.scope) &&
        validityIntersects(left, right)
      )
        pairs.push({ left, right });
    }
  }
  return pairs;
};

export const mixedConflictRecords = (): MemoryRecord[] => {
  const scopes: MemoryScope[] = [
    { kind: 'user' },
    { kind: 'workspace', workspaceId: 'ws-1' },
    { kind: 'workspace', workspaceId: 'ws-2' },
    { kind: 'expert', expertId: 'ex-1' },
    { kind: 'expert', expertId: 'ex-2' },
    { kind: 'expert-workspace', expertId: 'ex-1', workspaceId: 'ws-1' },
    { kind: 'expert-workspace', expertId: 'ex-2', workspaceId: 'ws-2' },
  ];
  const topics = ['income', 'cost', 'Income', ' income', 'é', 'e\u0301', '', '__proto__'];
  const windows = [
    {},
    { validFrom: 0, validUntil: 50 },
    { validFrom: 50, validUntil: 100 },
    { validFrom: 100 },
  ];
  return Array.from({ length: 112 }, (_, index) => {
    const topicKey = index % 9 === 8 ? undefined : topics[index % 9];
    const scope = scopes[index % scopes.length];
    if (scope === undefined) throw new Error('Missing synthetic scope');
    return conflictRecord({
      id: `memory-${Math.floor(index / 2)}`,
      revisionId: `revision-${index}`,
      revision: (index % 2) + 1,
      content: `content-${index % 5}`,
      scope,
      ...(topicKey === undefined ? {} : { topicKey }),
      ...windows[Math.floor(index / 7) % windows.length],
      status: index % 3 === 0 ? 'candidate' : index % 3 === 1 ? 'confirmed' : 'expired',
    });
  });
};
