import type {
  ExpertDetail,
  ExpertRevisionDraft,
  MaterialCandidate,
  MemoryConflictPair,
  MemoryJobSummary,
  MemoryViewItem,
  MemoryWriteReceipt,
} from '@betterwork/agent-protocol';
import { useEffect, useState } from 'react';

import { NavList } from '../../apps/desktop/src/renderer/src/components/NavList';
import { TransientToast } from '../../apps/desktop/src/renderer/src/components/TransientToast';
import { useExperts } from '../../apps/desktop/src/renderer/src/hooks/use-experts';
import { useMemories } from '../../apps/desktop/src/renderer/src/hooks/use-memories';
import { useMemorySuggestions } from '../../apps/desktop/src/renderer/src/hooks/use-memory-suggestions';
import { ExpertsPage } from '../../apps/desktop/src/renderer/src/views/ExpertsView';
import { MemoryPage } from '../../apps/desktop/src/renderer/src/views/MemoryView';

const workspaceId = 'workspace-fixture';
const reference = (version: number, originWorkspaceId = workspaceId): MaterialCandidate => ({
  title: '跨部门经营复盘报告与精确版本参考',
  sourceLabel: '成果',
  status: 'ready',
  detail: `经营复盘 · v${version}`,
  reference: {
    kind: 'artifact-version',
    artifactId: 'reference-artifact',
    artifactVersionId: `reference-v${version}`,
    contentHash: 'a'.repeat(64),
    originWorkspaceId,
  },
});
let savedExpert: ExpertDetail | undefined;
let expertFailure = true;
let referencesUnavailable = false;
let memoryFailure = true;
const memoryWrites: string[] = [];
const instruction: MemoryViewItem = {
  id: 'instruction-fixture',
  revisionId: 'instruction-r1',
  revision: 1,
  recallPolicy: 'relevant',
  scope: { kind: 'workspace', workspaceId },
  kind: 'procedural',
  content: '每次复盘先核对口径与来源，再输出可追溯结论。',
  sourceType: 'user-explicit',
  confidence: 1,
  status: 'confirmed',
  contentHash: 'a'.repeat(64),
  createdAt: 1,
  updatedAt: 1,
  facet: 'method',
  normalizedHash: 'b'.repeat(64),
  provenance: {
    schemaVersion: 1,
    verification: 'verified',
    authority: 'user-instruction',
    capturedAt: 1,
    sources: [
      {
        kind: 'manual',
        start: 0,
        end: 10,
        operationId: 'manual-fixture',
        contentHash: 'a'.repeat(64),
        excerpt: '用户明确制定的要求',
        excerptHash: 'b'.repeat(64),
      },
    ],
    materialDependencies: [],
    memoryDependencies: [],
    originWorkspaceId: workspaceId,
  },
  effectiveStatus: 'confirmed',
  sourceAvailability: 'available',
  requiresMaterialSelection: false,
  conflicts: [],
};
const conflict: MemoryConflictPair = {
  leftRevisionId: 'conflict-left-r1',
  rightRevisionId: 'conflict-right-r1',
  state: 'unresolved',
};
let memories: MemoryViewItem[] = [
  instruction,
  ...['left', 'right'].map((side) => ({
    ...instruction,
    id: `conflict-${side}`,
    revisionId: `conflict-${side}-r1`,
    content: side === 'left' ? '月报按回款统计收入。' : '合同按签约统计收入。',
    topicKey: '收入口径',
    conflicts: [conflict],
  })),
  {
    ...instruction,
    id: 'candidate-fixture',
    revisionId: 'candidate-r1',
    status: 'candidate',
    effectiveStatus: 'candidate',
    candidateDisposition: 'pending',
    content: '待确认：复盘时标明资料缺项。',
  },
  {
    ...instruction,
    id: 'expired-fixture',
    revisionId: 'expired-r1',
    effectiveStatus: 'expired',
    validUntil: 1,
    content: '已到期：旧期间约束。',
  },
  {
    ...instruction,
    id: 'deleted-fixture',
    revisionId: 'deleted-r1',
    status: 'deleted',
    effectiveStatus: 'deleted',
    content: '以后不用：旧工作要求。',
  },
];
let job: MemoryJobSummary = {
  id: 'job-fixture',
  workspaceId,
  taskId: 'task-fixture',
  source: { kind: 'run', runId: 'run-fixture' },
  status: 'failed',
  revision: 1,
  attempt: 1,
  trigger: 'automatic',
  candidateCount: 0,
  errorCode: 'INVALID_MODEL_OUTPUT',
  createdAt: 1,
  updatedAt: 1,
};
const receipt = (operationId: string, revisionId: string): MemoryWriteReceipt => ({
  operationId,
  commit: 'committed',
  effect: 'updated',
  committedRevisionIds: [revisionId],
  projectionState: 'synced',
});
const saveExpert = async (draft: ExpertRevisionDraft): Promise<{ expert: ExpertDetail }> => {
  if (expertFailure) {
    expertFailure = false;
    referencesUnavailable = true;
    throw new Error('合成故障：专家保存失败，参考版本与草稿保留');
  }
  if (
    draft.referenceMaterials?.length !== 1 ||
    draft.referenceMaterials[0]?.reference.kind !== 'artifact-version' ||
    draft.referenceMaterials[0].reference.artifactVersionId !== 'reference-v1'
  )
    throw new Error('专家提交丢失精确版本');
  savedExpert = {
    id: 'expert-fixture',
    sourceKind: 'user',
    lifecycle: 'active',
    name: draft.name,
    summary: draft.summary,
    author: draft.author,
    tags: draft.tags,
    currentRevision: 1,
    blockedReasons: [],
    createdAt: 1,
    updatedAt: 1,
    revision: { ...draft, id: 'expert-r1', expertId: 'expert-fixture', revision: 1, createdAt: 1 },
  };
  return { expert: savedExpert };
};
export const governanceApi = {
  experts: {
    list: async () => (savedExpert ? [savedExpert] : []),
    get: async () => savedExpert ?? null,
    create: saveExpert,
    saveRevision: async ({ revision }: { revision: ExpertRevisionDraft }) => saveExpert(revision),
  } satisfies Pick<Window['betterwork']['experts'], 'list' | 'get' | 'create' | 'saveRevision'>,
  memories: {
    list: async (input) => ({
      ok: true as const,
      warnings: [],
      data: {
        items: input?.statuses
          ? memories.filter((item) => input.statuses?.includes(item.status))
          : memories,
      },
    }),
    update: async (input) => {
      memoryWrites.push(input.operationId);
      if (memoryFailure) {
        memoryFailure = false;
        return {
          ok: false as const,
          error: {
            code: 'STORAGE_ERROR' as const,
            retryable: true,
            message: '合成故障：记忆保存失败，输入保留',
          },
        };
      }
      const item = memories.find((item) => item.id === input.id);
      if (!item) throw new Error('缺合成记忆');
      const updated = {
        ...item,
        content: input.patch.content ?? item.content,
        recallPolicy: input.patch.recallPolicy ?? item.recallPolicy,
        revision: item.revision + 1,
        revisionId: `${item.id}-r${item.revision + 1}`,
      };
      memories = memories.map((item) => (item.id === input.id ? updated : item));
      return {
        ok: true as const,
        warnings: [],
        data: receipt(input.operationId, updated.revisionId),
      };
    },
    setStatus: async (input) => {
      const item = memories.find((item) => item.id === input.id);
      if (!item || input.action !== 'confirm') throw new Error('本场景只确认合成候选');
      memories = memories.map((item) => {
        if (item.id !== input.id) return item;
        const confirmed = { ...item };
        delete confirmed.candidateDisposition;
        return { ...confirmed, status: 'confirmed', effectiveStatus: 'confirmed' };
      });
      return { ok: true as const, warnings: [], data: receipt(input.operationId, item.revisionId) };
    },

    getSettings: async () => ({
      ok: true as const,
      warnings: [],
      data: {
        workspaceId,
        revision: 1,
        autoSuggestEnabled: true,
        consentVersion: 1,
        consentedAt: 1,
        updatedAt: 1,
      },
    }),
    listJobs: async () => ({
      ok: true as const,
      warnings: [],
      data: {
        items: [job, { ...job, id: 'job-zero', status: 'succeeded' as const, updatedAt: 0 }],
      },
    }),
    retryJob: async () => {
      job = {
        ...job,
        status: job.attempt === 1 ? 'running' : 'succeeded',
        attempt: job.attempt + 1,
        revision: job.revision + 1,
        candidateCount: 0,
      };
      return { ok: true as const, warnings: [], data: job };
    },
    cancelJob: async () => {
      job = { ...job, status: 'cancelled', revision: job.revision + 1 };
      return { ok: true as const, warnings: [], data: job };
    },
  } satisfies Pick<
    Window['betterwork']['memories'],
    'list' | 'update' | 'setStatus' | 'getSettings' | 'listJobs' | 'retryJob' | 'cancelJob'
  >,
};

export function ExpertScenario(): React.JSX.Element {
  const experts = useExperts();
  const [error, setError] = useState('');
  const [referencesError, setReferencesError] = useState('合成故障：常用参考读取失败');
  useEffect(() => {
    const recover = (): void => {
      referencesUnavailable = false;
      setError('');
    };
    window.addEventListener('fixture-reference-recover', recover);
    return () => window.removeEventListener('fixture-reference-recover', recover);
  }, []);
  const candidates = [reference(1), reference(2), reference(3, 'other-workspace')].map(
    (candidate) =>
      referencesUnavailable &&
      candidate.reference.kind === 'artifact-version' &&
      candidate.reference.artifactVersionId === 'reference-v1'
        ? { ...candidate, status: 'unavailable' as const }
        : candidate,
  );
  return (
    <>
      <ExpertsPage
        state={{ ...experts, error }}
        actions={experts}
        skills={[]}
        mcpConnections={[]}
        memories={[]}
        models={[]}
        workspaceId={workspaceId}
        materialCandidates={referencesError ? [] : candidates}
        referencesError={referencesError}
        onRetryReferences={() => setReferencesError('')}
        onSummon={async () => {
          throw new Error('页面场景不执行 Run');
        }}
        onError={setError}
        onManageMemories={() => undefined}
      />
      {error && <TransientToast tone="error" message={error} onDismiss={() => setError('')} />}
    </>
  );
}
export function MemoryScenario(): React.JSX.Element {
  const state = useMemories();
  const suggestions = useMemorySuggestions({ workspaceId, visible: true, taskId: undefined });
  return (
    <div className="settings-layout settings-layout-fixed">
      <aside className="settings-nav-list">
        <p className="eyebrow">设置</p>
        <h1>偏好与能力</h1>
        <NavList
          variant="panel"
          label="设置分区"
          value="memory"
          onSelect={() => undefined}
          items={[{ id: 'memory', label: '记忆' }]}
        />
      </aside>
      <section className="settings-content">
        <MemoryPage
          state={state}
          suggestions={suggestions}
          workspaceId={workspaceId}
          workspaceName="合成复盘工作空间"
        />
      </section>
    </div>
  );
}
export function checkMemoryRetryIdentity(): void {
  if (memoryWrites.length < 2 || memoryWrites[0] !== memoryWrites[1])
    throw new Error('保存重试未复用幂等键');
}
