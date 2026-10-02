import '../../apps/desktop/src/renderer/src/styles.css';
import './ui-render-fixture.css';

import type {
  ArtifactDetail,
  ArtifactVersionDetail,
  ArtifactVersionSummary,
  KnowledgeDocumentSummary,
  KnowledgeRevisionSummary,
  KnowledgeTextPage,
} from '@betterwork/agent-protocol';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { applyAppearance } from '../../apps/desktop/src/renderer/src/appearance';
import type { KnowledgeLibrary } from '../../apps/desktop/src/renderer/src/hooks/use-knowledge-library';
import { ArtifactPage } from '../../apps/desktop/src/renderer/src/views/ArtifactView';
import { KnowledgePage } from '../../apps/desktop/src/renderer/src/views/KnowledgeView';

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
Object.defineProperty(window, 'betterwork', { value: { artifacts: artifactApi } });

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
  const button = [...document.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find(
    (item) =>
      item.getAttribute('aria-label') === name ||
      item.textContent?.trim() === name ||
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
function layoutChecks(): { headerHeight: number; width: number; alerts: number } {
  const header = requireElement<HTMLElement>('.page-header').getBoundingClientRect();
  if (
    header.height < 70 ||
    Math.abs(header.width - innerWidth) > 1 ||
    document.documentElement.scrollWidth > innerWidth + 1
  )
    throw new Error(
      `页面骨架或横向溢出异常：${header.height}/${document.documentElement.scrollWidth}/${innerWidth}`,
    );
  for (const element of document.querySelectorAll<HTMLElement>(
    '.page-header button, [role="alert"], .knowledge-detail-text, .artifact-editor',
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
  return {
    headerHeight: header.height,
    width: innerWidth,
    alerts: document.querySelectorAll('[role="alert"]').length,
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
    applyAppearance({ mode, scheme: 'jade' });
    window.uiPageChecks = {
      steps: pageId === 'artifact' ? artifactSteps : knowledgeSteps,
      runStep,
    };
    document.documentElement.dataset.fixtureReady = 'true';
  }, [pageId, mode]);
  return (
    <main className="fixture-main">
      <section className="main-stage">
        {pageId === 'artifact' ? <ArtifactScenario /> : <KnowledgeScenario />}
      </section>
    </main>
  );
}
const host = document.getElementById('root');
if (!host) throw new Error('缺页面测试挂载节点');
createRoot(host).render(<PageScenario />);
