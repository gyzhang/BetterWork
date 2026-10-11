import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from './index';
import type { ResearchDraftReceipt } from './research-draft-operation-repository';

const stores: AppStore[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});

/**
 * Seeds the FK parent rows (task + task_context_revisions) that
 * research_draft_operations requires, returning valid IDs.
 */
const seedParents = (
  store: AppStore,
): { db: Database.Database; taskId: string; contextId: string } => {
  const db = (store as unknown as { db: Database.Database }).db;
  const workspace = store.workspaces.getOrCreate('/tmp/draft-op-test', 'drafts');
  const task = store.tasks.create(workspace.id, 'draft task', 'verify receipts');
  const context = store.taskContexts.save(task.task.id, {
    executor: { kind: 'general' },
    skillBindings: [],
    materials: [],
  });
  return { db, taskId: task.task.id, contextId: context.id };
};

const makeReceipt = (
  taskId: string,
  contextId: string,
  overrides: Partial<ResearchDraftReceipt> = {},
): ResearchDraftReceipt => ({
  operationId: 'op-1',
  inputHash: 'hash-abc',
  taskId,
  contextId,
  prompt: 'write a draft',
  createdAt: 1_700_000_000_000,
  ...overrides,
});

describe('ResearchDraftOperationRepository', () => {
  it('returns undefined when no operation has been inserted', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    expect(store.researchDraftOperations.get('nonexistent')).toBeUndefined();
  });

  it('retrieves a previously inserted receipt by operationId', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const { taskId, contextId } = seedParents(store);
    const receipt = makeReceipt(taskId, contextId);
    store.researchDraftOperations.insert(receipt);

    const result = store.researchDraftOperations.get(receipt.operationId);
    expect(result).toEqual(receipt);
  });

  it('throws when inserting a duplicate operationId', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const { taskId, contextId } = seedParents(store);
    const receipt = makeReceipt(taskId, contextId);
    store.researchDraftOperations.insert(receipt);

    expect(() => store.researchDraftOperations.insert(receipt)).toThrow();
  });

  it('stores and returns all fields faithfully', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const { taskId, contextId } = seedParents(store);
    const receipt = makeReceipt(taskId, contextId, {
      operationId: 'op-unique',
      inputHash: 'hash-def',
      prompt: 'long-form research on topic X',
      createdAt: 1_700_000_001_000,
    });
    store.researchDraftOperations.insert(receipt);

    const result = store.researchDraftOperations.get('op-unique');
    expect(result).toEqual(receipt);
  });

  it('distinguishes receipts by operationId', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const { taskId, contextId } = seedParents(store);
    const first = makeReceipt(taskId, contextId, { operationId: 'op-a' });
    const second = makeReceipt(taskId, contextId, {
      operationId: 'op-b',
      prompt: 'different prompt',
    });
    store.researchDraftOperations.insert(first);
    store.researchDraftOperations.insert(second);

    expect(store.researchDraftOperations.get('op-a')!.prompt).toBe('write a draft');
    expect(store.researchDraftOperations.get('op-b')!.prompt).toBe('different prompt');
  });
});
