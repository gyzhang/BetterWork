import '../../apps/desktop/src/renderer/src/styles.css';
import './ui-render-fixture.css';

import type {
  ArtifactDetail,
  ArtifactVersionDetail,
  ArtifactVersionSummary,
  ExpertDetail,
  ExpertSummary,
  KnowledgeCollection,
  KnowledgeDocumentSummary,
  KnowledgeRevisionSummary,
  KnowledgeTextPage,
  ScheduleCallResult,
  ScheduleDetail,
  ScheduleOccurrenceDetail,
  ScheduleOccurrenceHistoryItem,
  SchedulePreviewResult,
  WorkspaceSummary,
} from '@betterwork/agent-protocol';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { applyAppearance } from '../../apps/desktop/src/renderer/src/appearance';
import type { KnowledgeLibrary } from '../../apps/desktop/src/renderer/src/hooks/use-knowledge-library';
import type { SchedulesState } from '../../apps/desktop/src/renderer/src/hooks/use-schedules';
import { ArtifactPage } from '../../apps/desktop/src/renderer/src/views/ArtifactView';
import { KnowledgePage } from '../../apps/desktop/src/renderer/src/views/KnowledgeView';
import { SchedulesPage } from '../../apps/desktop/src/renderer/src/views/SchedulesView';
import {
  checkMemoryRetryIdentity,
  ExpertScenario,
  governanceApi,
  MemoryScenario,
} from './ui-governance-fixture';

// 全部资料为合成文本；宿主不挂产品 Preload、SQLite、网络或文件动作。
const longTitle = '季度复盘与合同条款核对：跨部门研究资料与长期项目的版本边界';
const longPath =
  '/synthetic/这是一个用于检验长路径换行的资料目录/' + 'contract-review-'.repeat(12) + '.md';
const current: Extract<ArtifactDetail, { type: 'markdown' }> = {
  id: 'artifact-fixture',
  workspaceId: 'workspace-fixture',
  taskId: 'task-fixture',
  type: 'markdown',
  title: longTitle,
  currentVersionId: 'version-2',
  versionNumber: 2,
  origin: 'assistant-run',
  sourceRunId: 'run-fixture',
  createdAt: 1,
  updatedAt: 2,
  content: '# 当前版本\n\n这份成果保留来源、版本与可继续编辑的正文。\n\n' + longPath,
  contentHash: 'b'.repeat(64),
  evidence: [],
};
const history: ArtifactVersionDetail = {
  id: 'version-1',
  artifactId: current.id,
  versionNumber: 1,
  origin: 'assistant-run',
  createdAt: 1,
  type: 'markdown',
  content: '# 历史版本\n\n旧版结论仍可回溯。',
  contentHash: 'a'.repeat(64),
  evidence: [],
};
const versions: ArtifactVersionSummary[] = [
  {
    id: 'version-2',
    artifactId: current.id,
    versionNumber: 2,
    origin: 'assistant-run',
    type: 'markdown',
    createdAt: 2,
  },
  {
    id: 'version-1',
    artifactId: current.id,
    versionNumber: 1,
    origin: 'assistant-run',
    type: 'markdown',
    createdAt: 1,
  },
];
let failVersion = true;
let failSave = true;
const artifactApi: Pick<Window['betterwork']['artifacts'], 'listVersions' | 'getVersion'> = {
  listVersions: async () => versions,
  getVersion: async ({ id }) => {
    if (id !== history.id) throw new Error('本场景未覆盖该历史版本');
    if (failVersion) {
      failVersion = false;
      throw new Error('合成故障：历史版本暂不可读');
    }
    return history;
  },
};
Object.defineProperty(window, 'betterwork', {
  configurable: true,
  value: { artifacts: artifactApi, ...governanceApi },
});

function ArtifactScenario(): React.JSX.Element {
  const [artifact, setArtifact] = useState(current);
  const [selected, setSelected] = useState<ArtifactDetail>();
  return (
    <ArtifactPage
      artifacts={[artifact]}
      selected={selected}
      onSelect={() => setSelected(artifact)}
      onBack={() => setSelected(undefined)}
      onSave={async (_artifact, title, content) => {
        if (failSave) {
          failSave = false;
          throw new Error('合成故障：保存失败，草稿保留');
        }
        const saved: Extract<ArtifactDetail, { type: 'markdown' }> = {
          ...artifact,
          title,
          content,
          currentVersionId: 'version-3',
          versionNumber: 3,
          origin: 'user-edit',
          contentHash: 'c'.repeat(64),
          updatedAt: 3,
        };
        versions.unshift({
          id: 'version-3',
          artifactId: artifact.id,
          type: 'markdown',
          versionNumber: 3,
          origin: 'user-edit',
          createdAt: 3,
        });
        setArtifact(saved);
        setSelected(saved);
      }}
      onExport={async () => {
        throw new Error('本场景不执行导出');
      }}
      onOpenFile={async () => {
        throw new Error('本场景不打开系统文件');
      }}
      onOpenSource={async () => {
        throw new Error('本场景不打开原始资料');
      }}
      onStartFromVersion={async () => {
        throw new Error('本场景不执行模型任务');
      }}
    />
  );
}

const revision: KnowledgeRevisionSummary = {
  id: 'rev-2',
  documentId: 'doc-1',
  revision: 2,
  title: '合同条款',
  sourcePath: '/tmp/合同条款.md',
  format: 'markdown',
  byteSize: 24,
  contentHash: 'b'.repeat(64),
  parserVersion: 'text-extract-v1',
  chunkingVersion: 'format-locator-v1',
  textHash: 'c'.repeat(64),
  sectionCount: 1,
  warnings: [],
  importedAt: 1,
  createdAt: 2,
};

const page: KnowledgeTextPage = {
  reference: {
    kind: 'knowledge-revision',
    knowledgeDocumentId: 'doc-1',
    knowledgeRevisionId: 'rev-2',
    contentHash: 'b'.repeat(64),
    sourcePath: '/tmp/合同条款.md',
  },
  textHash: 'c'.repeat(64),
  title: '合同条款',
  parserVersion: 'text-extract-v1',
  chunkingVersion: 'format-locator-v1',
  warnings: [],
  parts: [
    {
      span: { sectionOrdinal: 0, start: 0, end: 7 },
      locator: '全文',
      text: '第二段保存文本',
      excerptHash: 'd'.repeat(64),
    },
  ],
  returnedCodePoints: 7,
  complete: true,
};

const libraryStub = (overrides: Partial<KnowledgeLibrary> = {}): KnowledgeLibrary => ({
  documents: [],
  results: [],
  query: '',
  setQuery: () => undefined,
  error: '',
  toast: undefined,
  showToast: () => undefined,
  dismissToast: () => undefined,
  issues: [],
  importing: false,
  loading: false,
  loadError: '',
  settings: { semanticEnabled: false, revision: 1, embeddingAvailable: false },
  embeddingModels: [],
  collections: [],
  filter: { kind: 'all' },
  setFilter: () => undefined,
  createCollection: async () => undefined,
  renameCollection: async () => undefined,
  deleteCollection: async () => undefined,
  saveDocumentCollections: async () => undefined,
  activeJobs: [],
  recentJobs: [],
  clearRecentJobs: async () => undefined,
  jobDetail: undefined,
  jobDetailLoading: false,
  jobDetailError: '',
  openJobDetail: async () => undefined,
  searchStatus: undefined,
  retryTarget: undefined,
  refresh: () => undefined,
  onImport: async () => undefined,
  onSearch: async () => undefined,
  onOpenSource: async () => undefined,
  onRefresh: async () => undefined,
  onRemove: async () => undefined,
  selectedMaterials: [],
  isSelected: () => false,
  toggleSelect: () => undefined,
  selectAllResults: () => undefined,
  clearSelection: () => undefined,
  researchBusy: false,
  research: async () => undefined,
  saveSettings: async () => undefined,
  rebuildSemantic: async () => undefined,
  rebuildKeyword: async () => undefined,
  checkAllSources: async () => undefined,
  cancelJob: async () => undefined,
  retryFailedItems: async () => undefined,
  detailDocument: undefined,
  detailRevisions: [],
  detailRevisionId: undefined,
  detailPage: undefined,
  detailLoading: false,
  detailError: '',
  detailCanGoBack: false,
  openDocument: async () => undefined,
  closeDocument: () => undefined,
  selectDetailRevision: async () => undefined,
  loadNextDetailPage: async () => undefined,
  loadPreviousDetailPage: async () => undefined,
  checkDocumentSource: async () => undefined,
  ...overrides,
});

const documentSummary: KnowledgeDocumentSummary = {
  id: 'doc-1',
  title: longTitle,
  sourcePath: longPath,
  format: 'markdown',
  byteSize: 24,
  contentHash: 'a'.repeat(64),
  sourceStatus: 'unchanged',
  lexicalState: 'ready',
  semanticState: 'disabled',
  collectionIds: [],
  membershipRevision: 1,
  importedAt: 1,
  updatedAt: 2,
};

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
const scheduleDocument: KnowledgeDocumentSummary = {
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
let scheduleContinuationRead = '';
function installScheduleApi(): void {
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
function SchedulesScenario(): React.JSX.Element {
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
function KnowledgeScenario(): React.JSX.Element {
  const [detail, setDetail] = useState(false);
  const [failed, setFailed] = useState(true);
  return (
    <KnowledgePage
      onResearch={() => {
        throw new Error('本场景不执行研究');
      }}
      library={libraryStub({
        documents: [documentSummary],
        detailDocument: detail ? documentSummary : undefined,
        detailRevisions: detail ? [revision] : [],
        detailRevisionId: detail ? revision.id : undefined,
        detailPage: detail && !failed ? page : undefined,
        detailError: detail && failed ? '合成故障：保存文本读取失败，可返回列表重新打开' : '',
        openDocument: async () => setDetail(true),
        closeDocument: () => {
          setDetail(false);
          setFailed(false);
        },
      })}
    />
  );
}

const requireElement = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`缺页面元素：${selector}`);
  return element;
};
const click = (name: string): void => {
  const button = [
    ...document.querySelectorAll<HTMLElement>('button, summary, [role="menuitem"]'),
  ].find(
    (item) =>
      item.getAttribute('aria-label') === name ||
      item.textContent?.trim() === name ||
      (item.getAttribute('role') === 'tab' && item.textContent?.trim().startsWith(name)) ||
      item.querySelector('.list-row-title')?.textContent === name,
  );
  if (
    !button ||
    (button instanceof HTMLButtonElement && button.disabled) ||
    button.getAttribute('aria-disabled') === 'true'
  )
    throw new Error(`缺可用页面动作：${name}`);
  button.focus();
  button.click();
};
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('页面状态未到达');
}
function layoutChecks(): {
  headerHeight: number;
  width: number;
  alerts: number;
  minimumFontPx: number;
} {
  const memoryPage = new URLSearchParams(location.search).get('page') === 'memory';
  const schedulePage = new URLSearchParams(location.search).get('page') === 'schedule';
  const header = requireElement<HTMLElement>(
    memoryPage ? '.section-header[data-variant="block"]' : '.page-header',
  ).getBoundingClientRect();
  if (
    (!memoryPage && (header.height < 70 || Math.abs(header.width - innerWidth) > 1)) ||
    document.documentElement.scrollWidth > innerWidth + 1
  )
    throw new Error(
      `页面骨架或横向溢出异常：${header.height}/${document.documentElement.scrollWidth}/${innerWidth}`,
    );
  for (const element of document.querySelectorAll<HTMLElement>(
    '.page-header button, [role="alert"], .knowledge-detail-text, .artifact-editor, .expert-editor input, .memory-editor-host textarea',
  )) {
    const rect = element.getBoundingClientRect();
    if (
      element.matches('[role="alert"]') &&
      (rect.width === 0 ||
        rect.height === 0 ||
        getComputedStyle(element).visibility === 'hidden' ||
        Number(getComputedStyle(element).opacity) === 0)
    )
      throw new Error('页面反馈不可见');
    if (rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1))
      throw new Error(`页面动作/反馈越界：${element.textContent?.slice(0, 40)}`);
  }
  const readableCopy = [
    ...document.querySelectorAll<HTMLElement>(
      '.schedules-page .page-header h1, .schedules-page .section-header-title, .schedules-page .section-header-hint, .schedules-page .field-label, .schedules-page .field-hint, .schedules-page .status-note, .schedules-page .inline-error, .schedules-page .list-row-title, .schedules-page .list-row-detail, .schedules-page .list-row-meta, .schedules-page .schedule-source-document-path, .schedules-page .action-bar-hint, .modal-panel .section-header-title, .modal-panel .section-header-hint, .modal-panel .field-label, .modal-panel .field-hint, .modal-panel .status-note, .modal-panel .inline-error, .modal-panel .action-bar-hint',
    ),
  ].filter((element) => element.getBoundingClientRect().width > 0);
  const minimumFontPx = readableCopy.length
    ? Math.min(
        ...readableCopy.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
      )
    : 0;
  if (schedulePage && readableCopy.length > 0 && minimumFontPx < 12)
    throw new Error(`定时任务正文/说明字号低于 12px：${minimumFontPx}px`);
  return {
    headerHeight: header.height,
    width: innerWidth,
    alerts: document.querySelectorAll('[role="alert"]').length,
    minimumFontPx,
  };
}
const artifactSteps = [
  'list',
  'open',
  'version-failed',
  'version-recovered',
  'edit-failed',
  'save-recovered',
  'back',
];
const expertSteps = [
  'expert-list',
  'expert-editor-open',
  'expert-load-recovered',
  'expert-select',
  'expert-keyboard',
  'expert-cancel',
  'expert-select-again',
  'expert-failed',
  'expert-stale',
  'expert-recovered',
];
const memorySteps = [
  'memory-list',
  'memory-keyboard',
  'memory-failed',
  'memory-recovered',
  'candidate-confirmed',
  'job-running',
  'job-cancelled',
  'job-zero',
  'memory-history',
];
const scheduleSteps = [
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
async function setInput(label: string, value: string): Promise<void> {
  const field = [...document.querySelectorAll('label')].find(
    (item) => item.textContent?.trim() === label,
  );
  const labelled = [...document.querySelectorAll('input, textarea')].find(
    (item) => item.getAttribute('aria-label') === label,
  );
  const input =
    labelled ??
    (field?.htmlFor
      ? document.getElementById(field.htmlFor)
      : field?.querySelector('input, textarea'));
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement))
    throw new Error(`缺输入字段：${label}`);
  const descriptor = Object.getOwnPropertyDescriptor(
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype,
    'value',
  );
  if (!descriptor?.set) throw new Error('缺原生输入接口');
  descriptor.set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
const knowledgeSteps = ['list', 'detail-failed', 'return', 'detail-recovered'];
async function runStep(step: string): Promise<ReturnType<typeof layoutChecks>> {
  const hasText = (text: string): boolean => document.body.textContent?.includes(text) ?? false;
  if (step === 'open') {
    click(longTitle);
    await waitFor(() => hasText('当前版本') && hasText('2 个版本'));
  }
  if (step === 'version-failed') {
    click('打开版本 v1');
    await waitFor(() => hasText('合成故障：历史版本暂不可读'));
    if (!hasText('当前版本') || !document.querySelector('[role="alert"]'))
      throw new Error('版本失败丢失正文或反馈');
  }
  if (step === 'version-recovered') {
    click('打开版本 v1');
    await waitFor(() => hasText('旧版结论仍可回溯。') && !document.querySelector('[role="alert"]'));
  }
  if (step === 'edit-failed') {
    click('编辑此版本');
    await waitFor(() => Boolean(document.querySelector('textarea')));
    const input = requireElement<HTMLTextAreaElement>('textarea');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (!descriptor?.set) throw new Error('缺原生文本输入接口');
    descriptor.set.call(input, `${input.value}\n\n用户修订草稿，保存失败后仍应保留。`);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    click('保存新版本');
    await waitFor(() => hasText('合成故障：保存失败，草稿保留'));
    if (
      !requireElement<HTMLTextAreaElement>('textarea').value.includes(
        '用户修订草稿，保存失败后仍应保留。',
      )
    )
      throw new Error('保存失败丢失草稿');
  }
  if (step === 'save-recovered') {
    click('保存新版本');
    await waitFor(
      () =>
        !document.querySelector('textarea') &&
        hasText('v3') &&
        hasText('用户修订草稿，保存失败后仍应保留。') &&
        hasText('3 个版本') &&
        !document.querySelector('[role="alert"]'),
    );
  }
  if (step === 'back') {
    click('成果');
    await waitFor(() => hasText('可继续工作的交付物'));
  }
  if (step === 'detail-failed' || step === 'detail-recovered') {
    click(`更多操作：${longTitle}`);
    await waitFor(() => Boolean(document.querySelector('[role="menu"]')));
    click('查看详情');
    await waitFor(() =>
      step === 'detail-failed' ? hasText('合成故障：保存文本读取失败') : hasText('第二段保存文本'),
    );
    if ((step === 'detail-failed') !== Boolean(document.querySelector('[role="alert"]')))
      throw new Error('知识详情反馈错误');
  }
  if (step === 'return') {
    click('返回列表');
    await waitFor(() => !hasText('合成故障：保存文本读取失败'));
  }
  if (step === 'expert-list') await waitFor(() => hasText('还没有可召唤的专家'));
  if (step === 'expert-editor-open') {
    click('新建专家');
    await waitFor(() => Boolean(document.querySelector('.expert-editor')));
    if (document.activeElement !== document.querySelector('.expert-editor input'))
      throw new Error('专家编辑打开未聚焦名称');
  }
  if (step === 'expert-load-recovered') {
    if (
      !hasText('合成故障：常用参考读取失败') ||
      !document.querySelector('.expert-editor [role=alert]')
    )
      throw new Error('参考读取失败被读成空态');
    await setInput('名称', '失败时的名称草稿');
    click('重试');
    await waitFor(() => !document.querySelector('.expert-editor [role=alert]'));
    if (
      document.querySelector<HTMLInputElement>('.expert-editor input')?.value !== '失败时的名称草稿'
    )
      throw new Error('参考重试丢失草稿');
  }
  if (step === 'expert-cancel') {
    click('取消');
    await waitFor(() => !document.querySelector('.expert-editor'));
    if (document.activeElement?.getAttribute('data-expert-focus') !== 'create')
      throw new Error('专家取消未归还入口焦点');
    if (!hasText('还没有可召唤的专家')) throw new Error('专家取消写入了草稿');
  }
  if (step === 'expert-select' || step === 'expert-select-again') {
    if (!document.querySelector('.expert-editor')) click('新建专家');
    await waitFor(() => Boolean(document.querySelector('.expert-editor')));
    await setInput('名称', '复盘专家 · 合成');
    await setInput('人格与职责', '核对资料与精确版本来源。');
    const group = requireElement<HTMLElement>('[aria-label="当前空间成果版本"]');
    const boxes = [...group.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    const otherDisclosure = [...document.querySelectorAll<HTMLDetailsElement>('details')].find(
      (item) => item.textContent?.includes('其他空间成果'),
    );
    if (!otherDisclosure?.open) click('其他空间成果 · 1 项（不可选）');
    await waitFor(() => Boolean(document.querySelector('[aria-label="其他空间成果"] input')));
    const other = requireElement<HTMLInputElement>(
      '[aria-label="其他空间成果"] input[type="checkbox"]',
    );
    if (!other.disabled) throw new Error('跨空间参考可被选入');
    if (!boxes[0]) throw new Error('缺当前空间参考版本');
    boxes[0]?.click();
    await setInput('筛选参考标题或版本', 'v2');
    await waitFor(() => Boolean(document.querySelector('[aria-label="已选参考"] input:checked')));
    if (document.querySelector('[aria-label="其他空间成果"] input:not(:disabled)'))
      throw new Error('跨空间参考可被选入');
  }
  if (step === 'expert-failed') {
    click('保存修订');
    await waitFor(() => hasText('合成故障：专家保存失败'));
    if (!document.querySelector('[aria-label="已选参考"] input:checked') || !hasText('v1'))
      throw new Error('专家保存失败丢失精确参考');
  }
  if (step === 'expert-stale') {
    const selected = requireElement<HTMLInputElement>('[aria-label="已选参考"] input');
    if (selected.disabled) throw new Error('失效的已选参考不可移除');
    selected.click();
    await waitFor(() => !document.querySelector('[aria-label="已选参考"] input'));
    await setInput('筛选参考标题或版本', '');
    await waitFor(() =>
      Boolean(document.querySelector('[aria-label="当前空间成果版本"] input:disabled')),
    );
    // 页面替身把来源恢复；重新加载候选不会重新创建编辑器，用户草稿应仍在。
    window.dispatchEvent(new Event('fixture-reference-recover'));
    await waitFor(
      () =>
        document.querySelector<HTMLInputElement>('[aria-label="当前空间成果版本"] input')
          ?.disabled === false,
    );
    requireElement<HTMLInputElement>('[aria-label="当前空间成果版本"] input').click();
    await waitFor(() => Boolean(document.querySelector('[aria-label="已选参考"] input:checked')));
  }
  if (step === 'expert-recovered') {
    click('保存修订');
    await waitFor(() => hasText('复盘专家 · 合成') && !document.querySelector('.expert-editor'));
    if (document.activeElement?.getAttribute('data-expert-focus') !== 'detail-edit')
      throw new Error('专家保存后未归还详情焦点');
  }
  if (step === 'memory-list') {
    await waitFor(() => hasText('待确认：复盘时标明资料缺项。') && hasText('提炼失败'));
    if (
      document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('已确认')
    )
      throw new Error('候选自动确认');
    click('已确认');
  }
  if (step === 'memory-failed') {
    click('编辑');
    await waitFor(() => Boolean(document.querySelector('.memory-editor-host textarea')));
    await setInput('记忆正文', '用户修改：每次复盘先核对口径与来源。');
    click('保存修改');
    await waitFor(() => hasText('合成故障：记忆保存失败，输入保留'));
    if (
      !requireElement<HTMLTextAreaElement>('.memory-editor-host textarea').value.includes(
        '用户修改',
      )
    )
      throw new Error('记忆失败丢失输入');
  }
  if (step === 'memory-recovered') {
    click('保存修改');
    await waitFor(() => !document.querySelector('.memory-editor-host'));
    checkMemoryRetryIdentity();
    click('设为优先带入');
    await waitFor(() => hasText('取消优先带入'));
  }
  if (step === 'candidate-confirmed') {
    click('待确认');
    await waitFor(() =>
      [...document.querySelectorAll<HTMLButtonElement>('button')].some(
        (item) => item.textContent?.trim() === '确认' && !item.disabled,
      ),
    );
    click('确认');
    await waitFor(() => !hasText('待确认：复盘时标明资料缺项。'));
    click('已确认');
    await waitFor(() => hasText('待确认：复盘时标明资料缺项。'));
  }
  if (step === 'job-running') {
    click('重新提炼');
    await waitFor(
      () =>
        hasText('正在提炼') &&
        Boolean(
          [...document.querySelectorAll('button')].find(
            (item) => item.textContent?.trim() === '取消',
          ),
        ),
    );
  }
  if (step === 'job-cancelled') {
    click('取消');
    await waitFor(
      () =>
        hasText('已取消') &&
        ![...document.querySelectorAll('button')].find(
          (item) => item.textContent?.trim() === '取消',
        ),
    );
  }
  if (step === 'job-zero') {
    click('提炼规则与历史作业');
    await waitFor(() => hasText('已完成，这次没有值得长期保留的经验'));
  }
  if (step === 'memory-history') {
    click('历史与已停用');
    await waitFor(() => hasText('以后不用：旧工作要求。'));
    const row = [...document.querySelectorAll('.memory-row')].find((item) =>
      item.textContent?.includes('以后不用：旧工作要求。'),
    );
    if (!row) throw new Error('缺终态记录');
    if (
      row?.textContent?.includes('确认') ||
      row?.querySelector('button')?.textContent?.includes('编辑')
    )
      throw new Error('终态记录可被恢复');
    click('已过期');
    await waitFor(() => hasText('已到期：旧期间约束。'));
  }
  if (step === 'schedule-list') {
    await waitFor(() => hasText('月度经营复盘 · Monthly Business Review'));
    if (!document.querySelector('[role="alert"]')) throw new Error('刷新失败未显示内联反馈');
  }
  if (step === 'schedule-list-recovered') {
    click('重试');
    await waitFor(() => !document.querySelector('[role="alert"]'));
    if (!hasText('月度经营复盘 · Monthly Business Review'))
      throw new Error('刷新恢复后列表旧事实丢失');
  }
  if (step === 'schedule-detail-open') {
    click('详情');
    await waitFor(() => hasText('2026 年 9 月') && hasText('本期固定配置'));
    if (!hasText('来源快照 · 0 项候选材料') || !hasText('2048 字节'))
      throw new Error('定时详情未呈现固定来源快照事实');
  }
  if (step === 'schedule-action-dialog-open') {
    const opener = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === '立即执行',
    );
    if (!opener) throw new Error('缺立即执行动作');
    opener.focus();
    opener.click();
    await waitFor(() => Boolean(document.querySelector('[aria-modal="true"]')));
    if (!hasText('本期统计期间以确认时刻计算')) throw new Error('立即执行确认文案缺少期间语义');
  }
  if (step === 'schedule-action-dialog-close') {
    const opener = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === '立即执行',
    );
    if (!opener || !document.querySelector('[aria-modal="true"]'))
      throw new Error('立即执行确认层没有保持打开');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(
      () => !document.querySelector('[aria-modal="true"]') && document.activeElement === opener,
    );
  }
  if (step === 'schedule-task-continuation') {
    const taskRow = requireElement<HTMLButtonElement>('.list-row[aria-label^="打开原 Task"]');
    taskRow.focus();
    taskRow.click();
    await waitFor(
      () => scheduleContinuationRead === '已打开原 Task：schedule-task-fixture · 2026 年 9 月',
    );
  }
  if (step === 'schedule-detail-back') {
    click('返回列表');
    await waitFor(() => hasText('按约定时间开始工作'));
  }
  if (step === 'schedule-edit-open') {
    click('编辑');
    await waitFor(
      () => hasText('编辑定时任务') && Boolean(document.querySelector('#schedule-name')),
    );
  }
  if (step === 'schedule-conflict-preserved') {
    await setInput('定时任务名称', '冲突后保留的草稿 Contract Review');
    click('保存并暂停');
    await waitFor(() => hasText('合成冲突：规则已有更新版本。'));
    if (
      requireElement<HTMLInputElement>('#schedule-name').value !==
      '冲突后保留的草稿 Contract Review'
    )
      throw new Error('CAS 冲突后配置草稿丢失');
  }
  if (step === 'schedule-discard-confirm-cancel') {
    click('返回列表');
    await waitFor(() => Boolean(document.querySelector('[role="alertdialog"]')));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(
      () =>
        !document.querySelector('[role="alertdialog"]') &&
        Boolean(document.querySelector('#schedule-name')),
    );
    if (
      requireElement<HTMLInputElement>('#schedule-name').value !==
      '冲突后保留的草稿 Contract Review'
    )
      throw new Error('取消放弃确认后编辑草稿未保留');
  }
  if (step === 'schedule-discard-confirm-accept') {
    click('返回列表');
    await waitFor(() => Boolean(document.querySelector('[role="alertdialog"]')));
    click('放弃草稿');
    await waitFor(() => hasText('按约定时间开始工作'));
    if (hasText('冲突后保留的草稿 Contract Review')) throw new Error('确认放弃后草稿仍显示');
  }
  if (step === 'schedule-create-open') {
    click('新建定时任务');
    await waitFor(() => hasText('新建定时任务'));
  }
  if (step === 'schedule-source-candidate-modal') {
    const opener = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === '选择知识范围',
    );
    if (!opener) throw new Error('缺知识范围入口');
    opener.focus();
    opener.click();
    await waitFor(() =>
      Boolean(document.querySelector('[role="dialog"][aria-label="选择定时任务知识范围"]')),
    );
    await setInput('搜索文档', 'contract-review');
    if (!hasText(scheduleDocument.sourcePath)) throw new Error('长英文路径搜索没有保留文档候选');
    const checkbox = requireElement<HTMLInputElement>(
      '.schedule-source-check-list input[type="checkbox"]',
    );
    checkbox.click();
    if (!checkbox.checked) throw new Error('来源候选勾选没有生效');
  }
  if (step === 'schedule-source-cancel-keyboard') {
    const opener = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === '选择知识范围',
    );
    if (!opener || !document.querySelector('[role="dialog"][aria-label="选择定时任务知识范围"]'))
      throw new Error('知识范围候选层没有保持打开');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(
      () =>
        !document.querySelector('[role="dialog"][aria-label="选择定时任务知识范围"]') &&
        document.activeElement === opener,
    );
    if (!hasText('没有附加知识范围')) throw new Error('Esc 关闭来源选择仍修改了规则草稿');
  }
  if (step === 'schedule-source-confirm') {
    click('选择知识范围');
    await waitFor(() =>
      Boolean(document.querySelector('[role="dialog"][aria-label="选择定时任务知识范围"]')),
    );
    await setInput('搜索文档', '用于长路径换行');
    const checkbox = requireElement<HTMLInputElement>(
      '.schedule-source-check-list input[type="checkbox"]',
    );
    checkbox.click();
    click('确认选择');
    await waitFor(() => hasText('已选 1 项：') && hasText('Contract Review'));
  }
  if (step === 'schedule-create-discard') {
    await setInput('定时任务名称', '新建草稿不应落库 / Unsaved draft');
    click('返回列表');
    await waitFor(() => Boolean(document.querySelector('[role="alertdialog"]')));
    click('放弃草稿');
    await waitFor(() => hasText('按约定时间开始工作'));
  }
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  return layoutChecks();
}
declare global {
  interface Window {
    uiPageChecks?: { steps: string[]; runStep: typeof runStep };
  }
}
function PageScenario(): React.JSX.Element {
  const query = new URLSearchParams(location.search);
  const pageId = query.get('page');
  const mode = query.get('mode') === 'dark' ? 'dark' : 'light';
  useEffect(() => {
    window.onerror = (message, source, line, column, error): boolean => {
      const messageText = typeof message === 'string' ? message : message.type;
      document.documentElement.dataset.fixtureError = `${messageText} ${source ?? ''}:${String(line ?? 0)}:${String(column ?? 0)} ${error?.stack ?? ''}`;
      return false;
    };
    window.onunhandledrejection = (event): void => {
      document.documentElement.dataset.fixtureError =
        event.reason instanceof Error
          ? event.reason.message
          : typeof event.reason === 'string'
            ? event.reason
            : (JSON.stringify(event.reason) ?? '发生未处理的 Promise 拒绝');
    };
    applyAppearance({ mode, scheme: 'jade' });
    if (pageId === 'schedule') {
      scheduleSaveConflict = true;
      installScheduleApi();
    }
    window.uiPageChecks = {
      steps:
        pageId === 'artifact'
          ? artifactSteps
          : pageId === 'expert'
            ? expertSteps
            : pageId === 'memory'
              ? memorySteps
              : pageId === 'schedule'
                ? scheduleSteps
                : knowledgeSteps,
      runStep,
    };
    document.documentElement.dataset.fixtureReady = 'true';
  }, [pageId, mode]);
  return (
    <main className="fixture-main">
      <section className="main-stage">
        {pageId === 'artifact' ? (
          <ArtifactScenario />
        ) : pageId === 'expert' ? (
          <ExpertScenario />
        ) : pageId === 'memory' ? (
          <MemoryScenario />
        ) : pageId === 'schedule' ? (
          <SchedulesScenario />
        ) : (
          <KnowledgeScenario />
        )}
      </section>
    </main>
  );
}
const host = document.getElementById('root');
if (!host) throw new Error('缺页面测试挂载节点');
createRoot(host).render(<PageScenario />);
