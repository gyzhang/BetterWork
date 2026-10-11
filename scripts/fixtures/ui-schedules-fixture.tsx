import type {
  ExpertDetail,
  ExpertSummary,
  KnowledgeCollection,
  KnowledgeDocumentSummary,
  ScheduleCallResult,
  ScheduleDetail,
  ScheduleOccurrenceDetail,
  ScheduleOccurrenceHistoryItem,
  SchedulePreviewResult,
  WorkspaceSummary,
} from '@betterwork/agent-protocol';
import type React from 'react';
import { useState } from 'react';

import type { SchedulesState } from '../../apps/desktop/src/renderer/src/hooks/use-schedules';
import { SchedulesPage } from '../../apps/desktop/src/renderer/src/views/SchedulesView';
import { documentSummary } from './ui-page-fixture-data';

const scheduleWorkspace: WorkspaceSummary = {
  id: 'schedule-workspace-fixture',
  name: '月度经营 Workspace / Monthly Business Review',
  rootPath: '/synthetic/经营与风险复盘/Business Review Workspace',
  iconId: 'folder',
  accentId: 'moss',
  createdAt: 1,
  updatedAt: 2,
};

const scheduleExpertRevision = {
  id: 'schedule-revision-fixture',
  expertId: 'schedule-expert-fixture',
  revision: 4,
  name: '经营分析专家 · Business Analyst',
  summary: '固定读取来源快照并复盘。',
  author: '合成 UI 场景',
  tags: ['synthetic'],
  identity: '完成月度经营复盘。',
  principles: [],
  inputRequirements: [],
  deliveryRequirements: [],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' as const },
  modelReference: { mode: 'application-default' as const },
  createdAt: 1,
};

const scheduleExpert: ExpertSummary = {
  id: scheduleExpertRevision.expertId,
  sourceKind: 'user',
  lifecycle: 'active',
  name: scheduleExpertRevision.name,
  summary: scheduleExpertRevision.summary,
  author: scheduleExpertRevision.author,
  tags: [...scheduleExpertRevision.tags],
  currentRevision: scheduleExpertRevision.revision,
  blockedReasons: [],
  createdAt: 1,
  updatedAt: 2,
};

const scheduleConfig = {
  scheduleId: 'schedule-fixture',
  version: 2,
  name: '月度经营复盘 · Monthly Business Review',
  expertId: scheduleExpert.id,
  expertRevisionId: scheduleExpertRevision.id,
  requirements:
    '对照本月与历史季度资料，说明变化与依据。 Compare this month with historical quarters.',
  expectedArtifactTypes: ['markdown' as const],
  timing: {
    frequency: 'monthly' as const,
    day: 5,
    hour: 9,
    minute: 0,
    timeZone: 'Asia/Shanghai' as const,
  },
  periodRule: 'previous-month' as const,
  knowledgeSources: [],
  outputSubdirectory: '定时成果' as const,
  createdAt: 2,
};

const scheduleOccurrence: ScheduleOccurrenceHistoryItem['occurrence'] = {
  id: 'schedule-occurrence-fixture',
  scheduleId: 'schedule-fixture',
  configVersion: 2,
  trigger: 'scheduled',
  scheduledAt: 1_790_000_000_000,
  period: {
    rule: 'previous-month',
    timeZone: 'Asia/Shanghai',
    anchorAt: 1_790_000_000_000,
    startAt: 1_789_000_000_000,
    endAt: 1_790_000_000_000,
    label: '2026 年 9 月',
  },
  phase: 'closed',
  taskId: 'schedule-task-fixture',
  sessionId: 'schedule-session-fixture',
  firstRunId: 'schedule-run-fixture',
  sourceSnapshotId: 'schedule-snapshot-fixture',
  createdAt: 1_790_000_000_000,
  requestedAt: 1_790_000_000_000,
  preparedAt: 1_790_000_000_100,
  finishedAt: 1_790_000_001_000,
};

const scheduleRun = {
  id: 'schedule-run-fixture',
  taskId: 'schedule-task-fixture',
  sessionId: 'schedule-session-fixture',
  prompt: '完成 2026 年 9 月经营复盘',
  status: 'completed' as const,
  createdAt: 1_790_000_000_200,
  completedAt: 1_790_000_001_000,
};

const scheduleHistoryItem: ScheduleOccurrenceHistoryItem = {
  occurrence: scheduleOccurrence,
  result: {
    occurrence: scheduleOccurrence,
    status: 'generated',
    run: scheduleRun,
    outputReceipts: [],
  },
  run: scheduleRun,
};

const scheduleDetail: ScheduleDetail = {
  aggregate: {
    schedule: {
      id: 'schedule-fixture',
      workspaceId: scheduleWorkspace.id,
      revision: 3,
      currentConfigVersion: scheduleConfig.version,
      lifecycle: 'paused',
      createdAt: 1,
      updatedAt: 3,
    },
    config: scheduleConfig,
  },
  expertUpdate: {
    boundRevision: scheduleExpertRevision,
    currentRevision: scheduleExpertRevision,
    available: false,
  },
  history: { items: [scheduleHistoryItem] },
};

const scheduleOccurrenceDetail: ScheduleOccurrenceDetail = {
  occurrence: scheduleOccurrence,
  result: scheduleHistoryItem.result,
  config: scheduleConfig,
  task: {
    id: 'schedule-task-fixture',
    workspaceId: scheduleWorkspace.id,
    title: '2026 年 9 月经营复盘 · Business Review',
    goal: '完成本期复盘并保留来源快照。',
    createdAt: 1_790_000_000_100,
    updatedAt: 1_790_000_001_000,
  },
  run: scheduleRun,
  sourceSnapshot: {
    id: 'schedule-snapshot-fixture',
    occurrenceId: scheduleOccurrence.id,
    workspaceId: scheduleWorkspace.id,
    status: 'ready',
    configVersion: scheduleConfig.version,
    evaluatedAt: 1_790_000_000_050,
    manifestHash: 'b'.repeat(64),
    itemCount: 2,
    totalFileBytes: 2048,
    createdAt: 1_790_000_000_050,
    completedAt: 1_790_000_000_100,
  },
  outputReceipts: [],
  readMaterialCount: 2,
  adoptedMaterialCount: 1,
};

export const scheduleDocument: KnowledgeDocumentSummary = {
  ...documentSummary,
  id: 'schedule-document-fixture',
  title: '合同条款与季度经营回顾 Contract Review',
  sourcePath: `/synthetic/这是一个用于长路径换行的资料目录/${'contract-review-'.repeat(12)}.md`,
  currentRevisionId: 'schedule-document-revision-fixture',
  collectionIds: ['schedule-collection-fixture'],
};

const scheduleCollection: KnowledgeCollection = {
  id: 'schedule-collection-fixture',
  name: '季度经营历史 / Quarterly History',
  revision: 3,
  createdAt: 1,
  updatedAt: 2,
};

const scheduleSuccess = <Value,>(data: Value): ScheduleCallResult<Value> => ({
  status: 'success',
  data,
});

let scheduleSaveConflict = true;

export let scheduleContinuationRead = '';

export function installScheduleApi(): void {
  const preview: SchedulePreviewResult = {
    previewedAt: 1_790_000_000_000,
    items: [1_790_000_000_100, 1_790_100_000_100, 1_790_200_000_100].map((scheduledAt) => ({
      scheduledAt,
      period: {
        rule: 'previous-month' as const,
        timeZone: 'Asia/Shanghai' as const,
        anchorAt: scheduledAt,
        startAt: scheduledAt - 100_000,
        endAt: scheduledAt,
        label: '上一自然月',
      },
    })),
  };
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      knowledge: {
        list: async () => [scheduleDocument],
        listCollections: async () => [scheduleCollection],
      },
      schedules: {
        onChange: () => () => undefined,
        getOccurrence: async () => scheduleSuccess(scheduleOccurrenceDetail),
        listSourceItems: async () => scheduleSuccess({ items: [] }),
        listOccurrences: async () => scheduleSuccess({ items: [] }),
        preview: async () => scheduleSuccess(preview),
        preflight: async () =>
          scheduleSuccess({ status: 'ready', fingerprint: 'synthetic-ui', problems: [] }),
        save: async () => {
          if (scheduleSaveConflict) {
            scheduleSaveConflict = false;
            return {
              status: 'rejected',
              error: {
                code: 'schedule_conflict',
                message: '合成冲突：规则已有更新版本。',
                currentRevision: 4,
              },
            };
          }
          return scheduleSuccess(scheduleDetail.aggregate);
        },
      },
      evidence: { list: async () => [] },
    },
  });
}

export function SchedulesScenario(): React.JSX.Element {
  const [refreshError, setRefreshError] = useState('合成故障：刷新定时任务失败。');
  const state: SchedulesState = {
    details: [scheduleDetail],
    loading: false,
    refreshing: false,
    error: '',
    refreshError,
    refresh: () => setRefreshError(''),
  };
  const expert: ExpertDetail = {
    ...scheduleExpert,
    revision: scheduleExpertRevision,
  };
  return (
    <>
      <SchedulesPage
        state={state}
        workspaces={[scheduleWorkspace]}
        experts={[scheduleExpert]}
        expertsLoading={false}
        expertsError=""
        getExpert={async () => expert}
        onOpenTask={async (taskId, occurrence) => {
          if (
            taskId !== scheduleOccurrenceDetail.task?.id ||
            occurrence?.occurrence.id !== scheduleOccurrence.id
          )
            throw new Error('合成场景未能将本期原 Task 与实例关联');
          scheduleContinuationRead = `已打开原 Task：${taskId} · ${occurrence.occurrence.period.label}`;
        }}
        onOpenArtifactVersion={async () => undefined}
        onOpenSource={async () => undefined}
      />
    </>
  );
}

export const scheduleSteps = [
  'schedule-list',
  'schedule-list-recovered',
  'schedule-detail-open',
  'schedule-action-dialog-open',
  'schedule-action-dialog-close',
  'schedule-task-continuation',
  'schedule-detail-back',
  'schedule-edit-open',
  'schedule-conflict-preserved',
  'schedule-discard-confirm-cancel',
  'schedule-discard-confirm-accept',
  'schedule-create-open',
  'schedule-source-candidate-modal',
  'schedule-source-cancel-keyboard',
  'schedule-source-confirm',
  'schedule-create-discard',
];
export function resetScheduleFixture(): void {
  scheduleSaveConflict = true;
  scheduleContinuationRead = '';
}
