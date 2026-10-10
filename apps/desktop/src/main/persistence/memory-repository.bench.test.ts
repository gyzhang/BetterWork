import { createHash } from 'node:crypto';

import type { MemoryProvenance, MemoryScope } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import { AppStore } from './index';

const digest = (content: string): string => createHash('sha256').update(content).digest('hex');
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

const measure = (read: () => unknown): { medianMs: number; p95Ms: number } => {
  read();
  const samples = Array.from({ length: 9 }, () => {
    const startedAt = performance.now();
    read();
    return performance.now() - startedAt;
  }).sort((left, right) => left - right);
  return { medianMs: samples[4]!, p95Ms: samples[8]! };
};

describe('MemoryRepository recall audit projection scale', () => {
  it('compares full records and audit payloads across 3,000 latest identities', () => {
    const store = AppStore.open(':memory:');
    try {
      const workspaces = Array.from(
        { length: 3 },
        (_, index) =>
          store.workspaces.getOrCreate(`/tmp/audit-bench/${index}`, `audit-${index}`).id,
      );
      const provenance: MemoryProvenance = {
        schemaVersion: 1,
        verification: 'legacy-unverified',
        sourceType: 'user-explicit',
      };
      let storedRows = 0;
      store.transaction(() => {
        for (let index = 0; index < 3_000; index += 1) {
          const content = `${index}: ${'收入按回款统计。'.repeat(180)}`;
          const scope: MemoryScope =
            index % 4 === 0
              ? { kind: 'user' }
              : { kind: 'workspace', workspaceId: workspaces[index % 3]! };
          const record = store.memories.create({
            scope,
            content,
            provenance,
            normalizedHash: digest(content),
            facet: 'fact',
            confidence: 0.9,
            status: index % 5 === 0 ? 'candidate' : 'confirmed',
            createdAt: 1_000 + index,
          }).record;
          storedRows += 1;
          if (index % 3 === 0) {
            const updated = `${content}修订`;
            store.memories.update({
              id: record.id,
              expectedRevision: 1,
              patch: { content: updated },
              normalizedHash: digest(updated),
              updatedAt: 10_000 + index,
            });
            storedRows += 1;
          }
        }
      });
      const full = store.memories.list();
      const audit = store.memories.listRecallAuditEntries();
      expect(audit).toEqual(full.map(({ id, revisionId, scope }) => ({ id, revisionId, scope })));
      expect(audit).toHaveLength(3_000);
      for (const entry of audit)
        expect(Object.keys(entry).sort()).toEqual(['id', 'revisionId', 'scope']);
      const fullBytes = bytes(full);
      const auditBytes = bytes(audit);
      expect(auditBytes).toBeLessThan(fullBytes / 10);
      const fullTiming = measure(() => store.memories.list());
      const auditTiming = measure(() => store.memories.listRecallAuditEntries());
      console.warn(
        JSON.stringify({
          benchmark: 'memory-recall-audit-projection',
          storedRows,
          latestIdentities: audit.length,
          fullBytes,
          auditBytes,
          fullContentBytes: full.reduce(
            (total, record) => total + Buffer.byteLength(record.content, 'utf8'),
            0,
          ),
          fullProvenanceBytes: full.reduce((total, record) => total + bytes(record.provenance), 0),
          auditContentBytes: 0,
          auditProvenanceBytes: 0,
          fullTiming,
          auditTiming,
          machine: `${process.platform} ${process.arch} node ${process.version}`,
        }),
      );
    } finally {
      store.close();
    }
  });
});
