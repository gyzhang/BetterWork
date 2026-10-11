import { randomUUID } from 'node:crypto';

import type { MemoryRecord } from '@betterwork/agent-protocol';

import type { AppStore } from '../../persistence';
import type {
  MemoryCreateInput,
  MemoryGovernanceEntry,
  MemoryRepository,
} from '../../persistence/memory-repository';
import { normalizedMemoryHash } from '../memory-content-policy';
import { buildLegacyProvenance } from '../memory-provenance';

type SeedOptions = Partial<
  Pick<
    MemoryCreateInput,
    | 'scope'
    | 'status'
    | 'topicKey'
    | 'validFrom'
    | 'validUntil'
    | 'candidateDisposition'
    | 'createdAt'
    | 'provenance'
  >
>;

export const seedGovernanceMemory = (
  repository: MemoryRepository,
  content: string,
  options: SeedOptions = {},
): MemoryRecord =>
  repository.create({
    scope: { kind: 'user' },
    status: 'confirmed',
    facet: 'fact',
    normalizedHash: normalizedMemoryHash(content),
    provenance: buildLegacyProvenance({ sourceType: 'user-explicit' }),
    confidence: 0.9,
    content,
    ...options,
  }).record;

export const governanceEntryOf = (record: MemoryRecord): MemoryGovernanceEntry => ({
  id: record.id,
  revisionId: record.revisionId,
  scope: record.scope,
  normalizedHash: record.normalizedHash,
  status: record.status,
  ...(record.topicKey === undefined ? {} : { topicKey: record.topicKey }),
  ...(record.validFrom === undefined ? {} : { validFrom: record.validFrom }),
  ...(record.validUntil === undefined ? {} : { validUntil: record.validUntil }),
  ...(record.candidateDisposition === undefined
    ? {}
    : { candidateDisposition: record.candidateDisposition }),
});

export const recordGovernanceDecision = (
  store: AppStore,
  left: MemoryRecord,
  right: MemoryRecord,
  note: string,
): void => {
  store.memoryOperations.recordConflictResolution({
    operationId: randomUUID(),
    requestHash: normalizedMemoryHash(note),
    leftRevisionId: left.revisionId,
    rightRevisionId: right.revisionId,
    decision: 'keep-both',
    applicabilityNote: note,
  });
};
