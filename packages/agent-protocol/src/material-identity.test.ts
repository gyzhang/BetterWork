import { describe, expect, it } from 'vitest';

import {
  materialListIdentity,
  type MaterialReference,
  materialReferenceFingerprint,
  materialReferenceSchema,
  sameKnowledgeReference,
  sameMaterialVersion,
} from './index';

const knowledge = {
  kind: 'knowledge-revision' as const,
  knowledgeDocumentId: 'doc',
  knowledgeRevisionId: 'revision',
  contentHash: 'hash',
  sourcePath: '/source.md',
};
const artifact = {
  kind: 'artifact-version' as const,
  artifactId: 'artifact',
  artifactVersionId: 'version',
  contentHash: 'hash',
  originWorkspaceId: 'workspace',
};
const snapshot = {
  kind: 'workspace-input-snapshot' as const,
  snapshotId: 'snapshot',
  workspaceId: 'workspace',
  contentHash: 'hash',
  format: 'markdown',
  fileKey: 'input.md',
};
const references: MaterialReference[] = [knowledge, artifact, snapshot];

describe('material identity policies', () => {
  it.each(references)('distinguishes list identity from content for $kind', (reference) => {
    const changed = { ...reference, contentHash: 'different' };
    expect(materialListIdentity(changed)).toBe(materialListIdentity(reference));
    expect(sameMaterialVersion(changed, reference)).toBe(false);
    expect(materialReferenceFingerprint(changed)).not.toBe(materialReferenceFingerprint(reference));
  });

  it.each([
    [knowledge, 'knowledgeDocumentId'],
    [knowledge, 'knowledgeRevisionId'],
    [knowledge, 'sourcePath'],
    [knowledge, 'originWorkspaceId'],
    [artifact, 'artifactId'],
    [artifact, 'artifactVersionId'],
    [artifact, 'originWorkspaceId'],
    [snapshot, 'snapshotId'],
    [snapshot, 'workspaceId'],
    [snapshot, 'format'],
    [snapshot, 'fileKey'],
  ] as const)('requires exact %s field %s', (reference, field) => {
    const changed = materialReferenceSchema.parse({ ...reference, [field]: 'different' });
    expect(sameMaterialVersion(reference, changed)).toBe(false);
    expect(sameMaterialVersion(changed, reference)).toBe(false);
  });

  it.each(references)('canonicalizes field order without losing fields for $kind', (reference) => {
    const reversed = Object.fromEntries(Object.entries(reference).reverse()) as MaterialReference;
    expect(sameMaterialVersion(reference, reversed)).toBe(true);
    expect(materialReferenceFingerprint(reference)).toBe(materialReferenceFingerprint(reversed));
    expect(JSON.parse(materialReferenceFingerprint(reversed))).toEqual(reference);
    expect(materialReferenceFingerprint(reference)).toBe(JSON.stringify(reference));
  });

  it('preserves optional audit fields while separating snapshot read identity', () => {
    const withPath = { ...snapshot, sourcePath: '/original.md' };
    expect(sameMaterialVersion(snapshot, withPath)).toBe(true);
    expect(materialReferenceFingerprint(snapshot)).not.toBe(materialReferenceFingerprint(withPath));
    expect(JSON.parse(materialReferenceFingerprint(withPath)).sourcePath).toBe('/original.md');
    const withOrigin = { ...knowledge, originWorkspaceId: 'workspace' };
    expect(sameMaterialVersion(knowledge, withOrigin)).toBe(false);
    expect(sameKnowledgeReference(knowledge, withOrigin)).toBe(true);
    expect(materialReferenceFingerprint(knowledge)).not.toBe(
      materialReferenceFingerprint(withOrigin),
    );
  });

  it.each([knowledge, snapshot])('normalizes omitted optional values for $kind', (reference) => {
    const field = reference.kind === 'knowledge-revision' ? 'originWorkspaceId' : 'sourcePath';
    const explicit = materialReferenceSchema.parse({ ...reference, [field]: undefined });
    expect(sameMaterialVersion(reference, explicit)).toBe(true);
    expect(materialReferenceFingerprint(reference)).toBe(materialReferenceFingerprint(explicit));
  });

  it('does not conflate identical content or IDs across reference kinds', () => {
    expect(sameMaterialVersion(knowledge, artifact)).toBe(false);
    expect(materialListIdentity({ ...knowledge, knowledgeRevisionId: 'same' })).not.toBe(
      materialListIdentity({ ...artifact, artifactVersionId: 'same' }),
    );
  });
});
