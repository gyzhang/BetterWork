import type { AgentRuntimeEvent, RunDiagnosticNode } from '@betterwork/agent-protocol';

const nodeKindOrder: Record<RunDiagnosticNode['kind'], number> = {
  round: 0,
  model: 1,
  tool: 2,
  host: 3,
};

export interface RunDiagnosticTreeNode {
  node: RunDiagnosticNode;
  children: RunDiagnosticTreeNode[];
  unresolvedParent: boolean;
}

const compareNodePosition = (left: RunDiagnosticNode, right: RunDiagnosticNode): number => {
  const timeDifference =
    (left.occurredAt ?? Number.MAX_SAFE_INTEGER) - (right.occurredAt ?? Number.MAX_SAFE_INTEGER);
  if (timeDifference !== 0) return timeDifference;
  const sourceDifference =
    (left.sourceKind === 'core-journal' ? 0 : 1) - (right.sourceKind === 'core-journal' ? 0 : 1);
  if (sourceDifference !== 0) return sourceDifference;
  const sequenceDifference =
    left.sourceKind === right.sourceKind
      ? (left.sourceSequenceStart ?? Number.MAX_SAFE_INTEGER) -
        (right.sourceSequenceStart ?? Number.MAX_SAFE_INTEGER)
      : 0;
  if (sequenceDifference !== 0) return sequenceDifference;
  const kindDifference = nodeKindOrder[left.kind] - nodeKindOrder[right.kind];
  if (kindDifference !== 0) return kindDifference;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
};

/** Merge query pages or a newer projection into an existing list by stable diagnostic node ID. */
export const mergeRunDiagnosticNodes = (
  snapshot: readonly RunDiagnosticNode[],
  incremental: readonly RunDiagnosticNode[],
): RunDiagnosticNode[] => {
  const byId = new Map<string, RunDiagnosticNode>();
  for (const node of snapshot) byId.set(node.id, node);
  for (const node of incremental) byId.set(node.id, node);
  return [...byId.values()].sort(compareNodePosition);
};

/** Build the display tree only from explicit parent IDs; missing parents remain visible as roots. */
export const buildRunDiagnosticTree = (
  nodes: readonly RunDiagnosticNode[],
): RunDiagnosticTreeNode[] => {
  const sorted = [...nodes].sort(compareNodePosition);
  const byId = new Map<string, RunDiagnosticTreeNode>();
  const parentIds = new Map<string, string>();
  for (const node of sorted) {
    byId.set(node.id, { node, children: [], unresolvedParent: false });
    if (node.parentId) parentIds.set(node.id, node.parentId);
  }

  const roots: RunDiagnosticTreeNode[] = [];
  for (const node of sorted) {
    const entry = byId.get(node.id);
    if (!entry) continue;
    const parentId = node.parentId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (!parentId) {
      roots.push(entry);
      continue;
    }
    if (!parent || parentId === node.id) {
      entry.unresolvedParent = true;
      roots.push(entry);
      continue;
    }

    let ancestorId: string | undefined = parentId;
    const visited = new Set<string>();
    let createsCycle = false;
    while (ancestorId) {
      if (ancestorId === node.id || visited.has(ancestorId)) {
        createsCycle = true;
        break;
      }
      visited.add(ancestorId);
      ancestorId = parentIds.get(ancestorId);
    }
    if (createsCycle) {
      entry.unresolvedParent = true;
      roots.push(entry);
      continue;
    }
    parent.children.push(entry);
  }

  const sortChildren = (entry: RunDiagnosticTreeNode): void => {
    entry.children.sort((left, right) => compareNodePosition(left.node, right.node));
    for (const child of entry.children) sortChildren(child);
  };
  roots.sort((left, right) => compareNodePosition(left.node, right.node));
  for (const root of roots) sortChildren(root);
  return roots;
};

/** True when observed Core events leave a sequence gap that a Journal snapshot can fill. */
export const hasRunEventSequenceGap = (events: readonly AgentRuntimeEvent[]): boolean => {
  const sequences = [...new Set(events.map((event) => event.sequence))].sort(
    (left, right) => left - right,
  );
  const firstSequence = sequences[0];
  if (firstSequence === undefined) return false;
  if (firstSequence !== 0) return true;
  return sequences.some((sequence, index) => {
    const previous = sequences[index - 1];
    return previous !== undefined && sequence > previous + 1;
  });
};

export const isRunDiagnosticsRelevantEvent = (event: AgentRuntimeEvent): boolean =>
  event.type.startsWith('model.') ||
  event.type.startsWith('tool.') ||
  event.type === 'run.started' ||
  event.type === 'run.completed' ||
  event.type === 'run.failed' ||
  event.type === 'run.cancelled';
