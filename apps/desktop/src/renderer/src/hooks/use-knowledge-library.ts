import type {
  KnowledgeCollection,
  KnowledgeCursor,
  KnowledgeDocumentSummary,
  KnowledgeJobItemStatus,
  KnowledgeJobItemSummary,
  KnowledgeJobPhase,
  KnowledgeJobStatus,
  KnowledgeJobSummary,
  KnowledgeLibraryFilter,
  KnowledgeResearchDraftMaterial,
  KnowledgeResearchDraftResult,
  KnowledgeRevisionSummary,
  KnowledgeSearchCoverage,
  KnowledgeSearchDegradedReason,
  KnowledgeSearchEffectiveMode,
  KnowledgeSearchHit,
  KnowledgeSearchSettings,
  KnowledgeTextPage,
  ModelProfileSummary,
} from '@betterwork/agent-protocol';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';

/** 最近一次检索的真实生效方式与覆盖度（契约 §9 response 的界面投影）。 */
export interface KnowledgeSearchStatus {
  effectiveMode: KnowledgeSearchEffectiveMode;
  coverage: KnowledgeSearchCoverage;
  degradedReason?: KnowledgeSearchDegradedReason;
}

export interface KnowledgeLibrary {
  documents: KnowledgeDocumentSummary[];
  results: KnowledgeSearchHit[];
  query: string;
  setQuery: (query: string) => void;
  message: string;
  /** 局部信息写入（如 KM03 迟到成功的可找回提示）。 */
  setMessage: (message: string) => void;
  issues: string[];
  importing: boolean;
  loading: boolean;
  loadError: string;
  /** KM11：集合筛选与单层分类；筛选只影响知识页视图，不改 Task 材料。 */
  collections: KnowledgeCollection[];
  filter: KnowledgeLibraryFilter;
  setFilter: (filter: KnowledgeLibraryFilter) => void;
  createCollection: (name: string) => Promise<void>;
  renameCollection: (id: string, name: string, expectedRevision: number) => Promise<void>;
  deleteCollection: (id: string, expectedRevision: number) => Promise<void>;
  saveDocumentCollections: (
    documentId: string,
    expectedMembershipRevision: number,
    collectionIds: string[],
  ) => Promise<void>;
  /** KM09：语义设置、合格嵌入模型、进行中的作业与最近检索状态。 */
  settings: KnowledgeSearchSettings | undefined;
  embeddingModels: ModelProfileSummary[];
  activeJobs: KnowledgeJobSummary[];
  /** 已收口的作业（含取消/失败）留在面板上供回看，新作业按提交倒序排在前面。 */
  recentJobs: KnowledgeJobSummary[];
  /** 展开查看逐条目阶段与原因的作业；同时只展开一个。 */
  jobDetail: { jobId: string; items: KnowledgeJobItemSummary[] } | undefined;
  jobDetailLoading: boolean;
  jobDetailError: string;
  searchStatus: KnowledgeSearchStatus | undefined;
  /** 最近一个已收口作业里可重试（失败/中断/取消）的条目；成功后清空。 */
  retryTarget: { jobId: string; itemIds: string[]; kind: KnowledgeJobSummary['kind'] } | undefined;
  /** 后台重新拉取资料清单；永不 reject。 */
  refresh: () => void;
  onImport: () => Promise<void>;
  onSearch: (event: FormEvent) => Promise<void>;
  onOpenSource: (sourcePath: string) => Promise<void>;
  onRefresh: (document: KnowledgeDocumentSummary) => Promise<void>;
  onRemove: (document: KnowledgeDocumentSummary) => Promise<void>;
  /** KM03：当前搜索结果中被勾选的固定修订材料（默认用途 background）。 */
  selectedMaterials: KnowledgeResearchDraftMaterial[];
  isSelected: (result: KnowledgeSearchHit) => boolean;
  toggleSelect: (result: KnowledgeSearchHit, checked: boolean) => void;
  selectAllResults: () => void;
  clearSelection: () => void;
  researchBusy: boolean;
  /** 返回结果与 stale 标记：迟到的成功不再导航，只提示可从最近任务找回。 */
  research: (
    prompt: string,
    workspaceId: string,
  ) => Promise<{ result: KnowledgeResearchDraftResult; stale: boolean } | undefined>;
  /** KM09：启用/停用/显式切换嵌入模型都走 CAS；启用不会自动补建历史索引。 */
  saveSettings: (input: { semanticEnabled: boolean; embeddingProfileId?: string }) => Promise<void>;
  /** 普通语义重建（兼容现有空间）与强制重建（退役旧空间）走同一入口、必须区分确认。 */
  rebuildSemantic: (forced: boolean) => Promise<void>;
  /** 关键词重建只重建本地派生索引、不调用模型；覆盖资料库当前全部登记资料。 */
  rebuildKeyword: () => Promise<void>;
  /** 展开/收回某个作业的逐条目结果。 */
  openJobDetail: (jobId: string) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
  retryFailedItems: () => Promise<void>;
  /** KM10：主区详情子视图；列表状态（query/results/勾选）在打开期间保持不变。 */
  detailDocument: KnowledgeDocumentSummary | undefined;
  detailRevisions: KnowledgeRevisionSummary[];
  detailRevisionId: string | undefined;
  detailPage: KnowledgeTextPage | undefined;
  detailLoading: boolean;
  detailError: string;
  detailCanGoBack: boolean;
  openDocument: (document: KnowledgeDocumentSummary) => Promise<void>;
  closeDocument: () => void;
  selectDetailRevision: (revisionId: string) => Promise<void>;
  loadNextDetailPage: () => Promise<void>;
  loadPreviousDetailPage: () => Promise<void>;
  checkDocumentSource: (documentId: string) => Promise<void>;
  /** 一次作业检查当前列表内的全部原件（随集合筛选变化）；超过单次上限时分批提交并如实报数。 */
  checkAllSources: () => Promise<void>;
}

const TERMINAL_STATUSES = new Set<KnowledgeJobSummary['status']>([
  'succeeded',
  'partial',
  'failed',
  'cancelled',
  'interrupted',
]);

/** 已收口作业在界面上保留的条数；历史真相在数据库里，界面只做最近回看。 */
const RECENT_JOBS_LIMIT = 10;

/** 来源检查单次可提交的资料数上限，与契约 §12 的协议校验一致。 */
const CHECK_SOURCES_BATCH_MAX = 200;

const RETRYABLE_ITEM_STATUSES = new Set<KnowledgeJobSummary['status']>([
  'failed',
  'interrupted',
  'cancelled',
]);

/**
 * 本地资料库的界面状态与动作。
 *
 * 三个不变量：
 * - 所有失败都写进 `message` / `issues` 呈现给用户，不静默；
 * - 任何动作都不得修改或删除用户源文件，移除与刷新只作用于本地索引，
 *   文案必须把这一点说清楚；
 * - 作业事件与检索响应都必须按新旧程度合并（sequence / 序号守卫），
 *   迟到结果永不覆盖当前状态。
 */
export function useKnowledgeLibrary(): KnowledgeLibrary {
  const [documents, setDocuments] = useState<KnowledgeDocumentSummary[]>([]);
  const [results, setResults] = useState<KnowledgeSearchHit[]>([]);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<Map<string, KnowledgeResearchDraftMaterial>>(
    () => new Map(),
  );
  const [researchBusy, setResearchBusy] = useState(false);
  const [settings, setSettings] = useState<KnowledgeSearchSettings | undefined>(undefined);
  const [collections, setCollections] = useState<KnowledgeCollection[]>([]);
  const [filter, setFilterState] = useState<KnowledgeLibraryFilter>({ kind: 'all' });
  const filterRef = useRef<KnowledgeLibraryFilter>(filter);
  const [embeddingModels, setEmbeddingModels] = useState<ModelProfileSummary[]>([]);
  const [activeJobs, setActiveJobs] = useState<Map<string, KnowledgeJobSummary>>(() => new Map());
  const [recentJobs, setRecentJobs] = useState<Map<string, KnowledgeJobSummary>>(() => new Map());
  const [jobDetail, setJobDetail] = useState<
    { jobId: string; items: KnowledgeJobItemSummary[] } | undefined
  >(undefined);
  const [jobDetailLoading, setJobDetailLoading] = useState(false);
  const [jobDetailError, setJobDetailError] = useState('');
  const [searchStatus, setSearchStatus] = useState<KnowledgeSearchStatus | undefined>(undefined);
  const [retryTarget, setRetryTarget] = useState<
    { jobId: string; itemIds: string[]; kind: KnowledgeJobSummary['kind'] } | undefined
  >(undefined);
  const [detailId, setDetailId] = useState<string | undefined>(undefined);
  const [detailRevisions, setDetailRevisions] = useState<KnowledgeRevisionSummary[]>([]);
  const [detailRevisionId, setDetailRevisionId] = useState<string | undefined>(undefined);
  const [detailPage, setDetailPage] = useState<KnowledgeTextPage | undefined>(undefined);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [cursorStack, setCursorStack] = useState<Array<KnowledgeCursor | undefined>>([]);
  const currentCursor = useRef<KnowledgeCursor | undefined>(undefined);
  const detailSeq = useRef(0);
  const researchSeq = useRef(0);
  const searchSeq = useRef(0);
  const pendingJobs = useRef(new Set<string>());
  const openDetailIdRef = useRef<string | undefined>(undefined);
  /** 作业终态后重新读取打开中的详情；每次渲染刷新到最新闭包，避免让 effect 重新订阅。 */
  const reloadDetailRef = useRef<() => void>(() => {});
  const operationByInput = useRef<Map<string, string>>(new Map());

  const refresh = useCallback((): void => {
    setLoading(true);
    setLoadError('');
    trackAction(
      window.betterwork.knowledge
        .list({ filter: filterRef.current })
        .then(setDocuments)
        .catch((error: unknown) => {
          setLoadError(describeActionError(error, '资料库加载失败，请重试。'));
        })
        .finally(() => setLoading(false)),
      '刷新资料库',
    );
    // 详情打开时同步重读版本与正文，避免「刷新内容已完成但界面还是旧版」。
    reloadDetailRef.current();
  }, []);

  const loadSettings = useCallback((): void => {
    trackAction(
      window.betterwork.knowledge
        .settings()
        .then(setSettings)
        .catch(() => {
          // 设置读取失败保持旧值；下一次动作仍会在错误里可解释。
        }),
      '读取索引设置',
    );
  }, []);

  useEffect(() => {
    trackAction(
      window.betterwork.knowledge
        .jobs({ limit: 10 })
        .then((page) => {
          const running = page.jobs.filter((job) => !TERMINAL_STATUSES.has(job.status));
          for (const job of running) pendingJobs.current.add(job.id);
          if (running.length > 0) {
            setActiveJobs(new Map(running.map((job) => [job.id, job] as const)));
          }
          // 首页里的终态作业留在「最近作业」里，取消/失败后界面不再是空白。
          const finished = page.jobs.filter((job) => TERMINAL_STATUSES.has(job.status));
          if (finished.length > 0) {
            setRecentJobs(
              new Map(finished.slice(0, RECENT_JOBS_LIMIT).map((job) => [job.id, job] as const)),
            );
          }
        })
        .catch(() => {
          // 作业面板是可重建的投影；拉不到首页不影响资料与检索。
        }),
      '读取进行中作业',
    );
    trackAction(
      window.betterwork.models
        .list()
        .then((models) =>
          setEmbeddingModels(
            models.filter(
              (model) => model.role === 'embedding' && model.enabled && model.apiKeyConfigured,
            ),
          ),
        )
        .catch(() => {
          // 模型清单失败只让管理面板少选项，错误由模型设置页负责呈现。
        }),
      '读取嵌入模型清单',
    );
  }, []);

  const onImport = async (): Promise<void> => {
    setImporting(true);
    setMessage('');
    setIssues([]);
    try {
      const ack = await window.betterwork.knowledge.importFromDialog();
      if (ack.cancelled || !ack.jobId) {
        setMessage('已取消导入，未选择文件。');
      } else {
        setMessage('已提交导入作业，索引正在后台建立。');
        trackJob(ack.jobId);
      }
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入资料失败。');
    } finally {
      setImporting(false);
    }
  };

  const onOpenSource = async (sourcePath: string): Promise<void> => {
    setMessage('');
    const result = await window.betterwork.knowledge.openSource({ sourcePath });
    if (!result.opened) throw new Error(result.error ?? '无法打开原始资料。');
  };

  const onRemove = async (document: KnowledgeDocumentSummary): Promise<void> => {
    try {
      const result = await window.betterwork.knowledge.remove({ id: document.id });
      // 被移除的资料若正开着详情，先收掉详情，避免后续刷新重读一个已不存在的登记。
      if (openDetailIdRef.current === document.id) {
        openDetailIdRef.current = undefined;
        setDetailId(undefined);
        setDetailPage(undefined);
        setDetailRevisionId(undefined);
        setDetailRevisions([]);
        setCursorStack([]);
        setDetailError('');
      }
      setMessage(
        result.removed
          ? `已从资料库移除「${document.title}」，原始文件未受影响。`
          : '资料已不在当前资料库中。',
      );
      setQuery('');
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '移出资料库失败，请重试。');
    }
  };

  const onRefresh = async (document: KnowledgeDocumentSummary): Promise<void> => {
    setImporting(true);
    setMessage('');
    try {
      const ack = await window.betterwork.knowledge.refresh({ id: document.id });
      setMessage(`已提交「${document.title}」的刷新作业，索引正在后台重建。`);
      setQuery('');
      trackJob(ack.jobId);
      refresh();
    } catch (error) {
      const message = describeActionError(error, '刷新索引失败，请重试。');
      setMessage(`刷新索引失败：${message}`);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      setImporting(false);
    }
  };

  /** 作业终态后把结果与逐条目失败原因回填到界面；取消不报失败。 */
  const reportJob = useCallback(
    (jobId: string): void => {
      trackAction(
        window.betterwork.knowledge.job({ jobId }).then((detail) => {
          if (!detail) return;
          // 作业终态可能改变登记与来源状态，列表和详情摘要都要拉回最新投影。
          refresh();
          const failed = detail.items.filter((item) => item.status === 'failed');
          setIssues(
            failed.map(
              (item) =>
                `${item.fileName ?? item.documentId ?? '资料'}：${item.failure?.message ?? '处理失败'}`,
            ),
          );
          const retryable = detail.items.filter((item) => RETRYABLE_ITEM_STATUSES.has(item.status));
          setRetryTarget(
            detail.job.status === 'succeeded' || retryable.length === 0
              ? undefined
              : {
                  jobId: detail.job.id,
                  itemIds: retryable.map((item) => item.id),
                  kind: detail.job.kind,
                },
          );
          if (detail.job.status === 'succeeded') {
            setMessage(
              `${titleOfJob(detail.job)}完成（${detail.job.completedCount}/${detail.job.totalCount}）。`,
            );
          } else if (detail.job.status === 'partial') {
            setMessage(
              `${titleOfJob(detail.job)}部分完成（${detail.job.completedCount}/${detail.job.totalCount}）。`,
            );
          } else if (detail.job.status !== 'cancelled') {
            setMessage(
              `${titleOfJob(detail.job)}未完成：${detail.job.failure?.message ?? detail.job.status}`,
            );
          }
        }),
        '回读索引作业结果',
      );
    },
    [refresh],
  );

  const trackJob = useCallback((jobId: string): void => {
    pendingJobs.current.add(jobId);
  }, []);

  useEffect(() => {
    const unsubscribe = window.betterwork.knowledge.onJobEvent((job: KnowledgeJobSummary) => {
      const tracked = pendingJobs.current.has(job.id);
      setActiveJobs((current) => {
        const known = current.get(job.id);
        // 未跟踪的作业事件不得污染面板；已跟踪的按 sequence 单调合并。
        if (!tracked && !known) return current;
        const next = new Map(current);
        if (TERMINAL_STATUSES.has(job.status)) {
          next.delete(job.id);
        } else if (!known || job.sequence > known.sequence) {
          next.set(job.id, job);
        }
        return next;
      });
      if (!tracked) return;
      if (job.status === 'queued' || job.status === 'running') return;
      pendingJobs.current.delete(job.id);
      // 收口后的作业不进消失通道：作为最近作业第一条留下，供回看条目与原因。
      setRecentJobs((current) => {
        const merged: Array<[string, KnowledgeJobSummary]> = [[job.id, job], ...current.entries()];
        return new Map(merged.slice(0, RECENT_JOBS_LIMIT));
      });
      setJobDetail((detail) => (detail?.jobId === job.id ? undefined : detail));
      reportJob(job.id);
    });
    return unsubscribe;
  }, [reportJob]);

  useEffect(() => {
    loadSettings();
    trackAction(
      window.betterwork.knowledge
        .listCollections()
        .then(setCollections)
        .catch(() => {
          // 集合列表失败只让筛选少选项，不阻塞资料页。
        }),
      '读取集合列表',
    );
  }, [loadSettings]);

  const setFilter = (next: KnowledgeLibraryFilter): void => {
    filterRef.current = next;
    setFilterState(next);
    setQuery('');
    setResults([]);
    setSearchStatus(undefined);
    refresh();
  };

  const createCollection = async (name: string): Promise<void> => {
    try {
      setCollections(await window.betterwork.knowledge.saveCollection({ mode: 'create', name }));
      setMessage(`已创建集合「${name.trim()}」。`);
    } catch (error) {
      setMessage(describeActionError(error, '创建集合失败。'));
    }
  };

  const renameCollection = async (
    id: string,
    name: string,
    expectedRevision: number,
  ): Promise<void> => {
    try {
      setCollections(
        await window.betterwork.knowledge.saveCollection({
          mode: 'rename',
          id,
          name,
          expectedRevision,
        }),
      );
      setMessage(`集合已改名为「${name.trim()}」。`);
    } catch (error) {
      setMessage(describeActionError(error, '改名集合失败。'));
    }
  };

  const deleteCollection = async (id: string, expectedRevision: number): Promise<void> => {
    try {
      setCollections(await window.betterwork.knowledge.deleteCollection({ id, expectedRevision }));
      const current = filterRef.current;
      if (current.kind === 'collection' && current.collectionId === id) {
        setFilter({ kind: 'all' });
      }
      setMessage('已删除集合；资料本身与原件不受影响。');
    } catch (error) {
      setMessage(describeActionError(error, '删除集合失败。'));
    }
  };

  const saveDocumentCollections = async (
    documentId: string,
    expectedMembershipRevision: number,
    collectionIds: string[],
  ): Promise<void> => {
    try {
      await window.betterwork.knowledge.setCollectionMembers({
        documentId,
        expectedMembershipRevision,
        collectionIds,
      });
      setMessage('分类已保存；不会改变内容版本与已选任务材料。');
      refresh();
    } catch (error) {
      setMessage(describeActionError(error, '保存分类失败，可能已被其他窗口更新。'));
    }
  };

  const materialKey = (result: KnowledgeSearchHit): string =>
    `${result.reference.knowledgeDocumentId}:${result.reference.knowledgeRevisionId}`;

  const isSelected = useCallback(
    (result: KnowledgeSearchHit): boolean => selected.has(materialKey(result)),
    [selected],
  );
  const toggleSelect = useCallback((result: KnowledgeSearchHit, checked: boolean): void => {
    setSelected((current) => {
      const next = new Map(current);
      const key = materialKey(result);
      if (checked) {
        next.set(key, { reference: result.reference, purpose: 'background' });
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);
  const clearSelection = useCallback((): void => setSelected(new Map()), []);
  const selectAllResults = useCallback((): void => {
    setSelected(
      new Map(
        results.map((result) => [
          materialKey(result),
          { reference: result.reference, purpose: 'background' },
        ]),
      ),
    );
  }, [results]);

  const onSearch = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const term = query.trim();
    const seq = searchSeq.current + 1;
    searchSeq.current = seq;
    if (!term) {
      setResults([]);
      setSearchStatus(undefined);
      return;
    }
    try {
      const response = await window.betterwork.knowledge.search({
        query: term,
        filter,
      });
      // 迟到的检索响应不覆盖当前查询的结果与状态。
      if (searchSeq.current !== seq) return;
      setResults(response.results);
      setSearchStatus({
        effectiveMode: response.effectiveMode,
        coverage: response.coverage,
        ...(response.degradedReason ? { degradedReason: response.degradedReason } : {}),
      });
      // 降级解释与勾选清空各写一句，但合成一条内联消息，后写的不能把降级原因盖掉。
      const notes: string[] = [];
      if (response.degradedReason) {
        notes.push(
          `本次检索以关键词为主（${knowledgeDegradedLabel(response.degradedReason)}），兼容向量结果照常返回`,
        );
      }
      // 切换搜索后清空结果勾选，避免隐形的跨查询选择。
      if (selected.size > 0) {
        notes.push('此前的结果勾选已清空');
        setSelected(new Map());
      }
      if (notes.length > 0) setMessage(`${notes.join('；')}。`);
    } catch (error) {
      if (searchSeq.current !== seq) return;
      setMessage(error instanceof Error ? error.message : '检索资料失败。');
    }
  };

  const saveSettings = async (input: {
    semanticEnabled: boolean;
    embeddingProfileId?: string;
  }): Promise<void> => {
    try {
      const next = await window.betterwork.knowledge.saveSettings({
        expectedRevision: settings?.revision ?? 1,
        semanticEnabled: input.semanticEnabled,
        ...(input.embeddingProfileId ? { embeddingProfileId: input.embeddingProfileId } : {}),
      });
      setSettings(next);
      setMessage(
        input.semanticEnabled
          ? '已启用语义检索。历史资料需手动重建向量索引；新导入资料会自动纳入。'
          : '已停用语义检索；关键词搜索不受影响。',
      );
    } catch (error) {
      setMessage(describeActionError(error, '保存索引设置失败，请重试。'));
    }
  };

  const rebuildSemantic = async (forced: boolean): Promise<void> => {
    try {
      const ack = await window.betterwork.knowledge.rebuildIndex({
        kind: 'semantic',
        ...(forced ? { resetSemanticSpace: true } : {}),
      });
      trackJob(ack.jobId);
      setMessage(
        forced
          ? '已提交强制重建：旧语义索引立即停用，关键词检索保持可用。'
          : '已提交语义索引重建作业。',
      );
    } catch (error) {
      setMessage(describeActionError(error, '提交重建作业失败，请重试。'));
    }
  };

  /** 关键词重建只重建本地派生索引，不调用模型；覆盖资料库当前全部登记资料。 */
  const rebuildKeyword = async (): Promise<void> => {
    try {
      const ack = await window.betterwork.knowledge.rebuildIndex({ kind: 'keyword' });
      trackJob(ack.jobId);
      setMessage('已提交关键词索引重建；不调用模型，向量索引与覆盖状态不受影响。');
    } catch (error) {
      setMessage(describeActionError(error, '提交关键词重建失败，请重试。'));
    }
  };

  /** 展开某个作业的逐条目阶段与原因；再次点击同一作业即收回。 */
  const openJobDetail = async (jobId: string): Promise<void> => {
    if (jobDetail?.jobId === jobId) {
      setJobDetail(undefined);
      return;
    }
    setJobDetail(undefined);
    setJobDetailError('');
    setJobDetailLoading(true);
    try {
      const detail = await window.betterwork.knowledge.job({ jobId });
      if (!detail) {
        setJobDetailError('这条作业的结果已不可回看。');
        return;
      }
      setJobDetail({ jobId, items: detail.items });
    } catch (error) {
      setJobDetailError(describeActionError(error, '读取作业条目失败。'));
    } finally {
      setJobDetailLoading(false);
    }
  };

  const cancelJob = async (jobId: string): Promise<void> => {
    try {
      const ack = await window.betterwork.knowledge.cancelJob({ jobId });
      setMessage(
        ack.cancelled ? '已请求取消，作业将停在当前条目边界。' : '该作业已结束，无法取消。',
      );
    } catch (error) {
      setMessage(describeActionError(error, '取消作业失败。'));
    }
  };

  const retryFailedItems = async (): Promise<void> => {
    if (!retryTarget) return;
    const target = retryTarget;
    try {
      const ack = await window.betterwork.knowledge.retryJob({
        jobId: target.jobId,
        itemIds: target.itemIds,
      });
      setRetryTarget(undefined);
      trackJob(ack.jobId);
      setMessage(`已提交重试作业（${target.itemIds.length} 个条目）。`);
    } catch (error) {
      setMessage(describeActionError(error, '重试失败条目未提交，请重试。'));
    }
  };

  const loadDetailPage = async (
    documentId: string,
    revisionId: string,
    cursor: KnowledgeCursor | undefined,
  ): Promise<void> => {
    const seq = detailSeq.current + 1;
    detailSeq.current = seq;
    setDetailLoading(true);
    setDetailError('');
    try {
      const page = await window.betterwork.knowledge.preview({
        documentId,
        revisionId,
        ...(cursor ? { cursor } : {}),
      });
      if (detailSeq.current !== seq) return;
      setDetailRevisionId(revisionId);
      setDetailPage(page);
      currentCursor.current = cursor;
    } catch (error) {
      if (detailSeq.current === seq) {
        setDetailError(describeActionError(error, '读取保存文本失败。'));
      }
    } finally {
      if (detailSeq.current === seq) setDetailLoading(false);
    }
  };

  /** 重读版本列表与最新修订正文；详情打开期间的列表刷新与作业终态都走这里。 */
  const loadDetail = async (documentId: string): Promise<void> => {
    const seq = detailSeq.current + 1;
    detailSeq.current = seq;
    setDetailLoading(true);
    setDetailError('');
    setCursorStack([]);
    currentCursor.current = undefined;
    try {
      const revisions = await window.betterwork.knowledge.listRevisions({
        documentId,
      });
      if (detailSeq.current !== seq) return;
      setDetailRevisions(revisions);
      const first = revisions[0];
      if (!first) {
        setDetailError('该资料没有可预览的保存修订。');
        return;
      }
      await loadDetailPage(documentId, first.id, undefined);
    } catch (error) {
      if (detailSeq.current === seq) {
        setDetailError(describeActionError(error, '读取版本列表失败。'));
      }
    } finally {
      if (detailSeq.current === seq) setDetailLoading(false);
    }
  };

  useEffect((): void => {
    reloadDetailRef.current = (): void => {
      const documentId = openDetailIdRef.current;
      if (documentId) trackAction(loadDetail(documentId), '重读资料详情');
    };
  });

  const openDocument = async (document: KnowledgeDocumentSummary): Promise<void> => {
    openDetailIdRef.current = document.id;
    setDetailId(document.id);
    setDetailRevisions([]);
    setDetailPage(undefined);
    setDetailRevisionId(undefined);
    setDetailError('');
    await loadDetail(document.id);
  };

  const closeDocument = (): void => {
    openDetailIdRef.current = undefined;
    detailSeq.current += 1;
    setDetailId(undefined);
    setDetailPage(undefined);
    setDetailRevisionId(undefined);
    setDetailRevisions([]);
    setCursorStack([]);
    setDetailError('');
    setDetailLoading(false);
  };

  const selectDetailRevision = async (revisionId: string): Promise<void> => {
    if (!detailId) return;
    setCursorStack([]);
    currentCursor.current = undefined;
    await loadDetailPage(detailId, revisionId, undefined);
  };

  const loadNextDetailPage = async (): Promise<void> => {
    if (!detailId || !detailRevisionId || !detailPage?.nextCursor) return;
    const previous = currentCursor.current;
    setCursorStack((stack) => [...stack, previous]);
    await loadDetailPage(detailId, detailRevisionId, detailPage.nextCursor);
  };

  const loadPreviousDetailPage = async (): Promise<void> => {
    if (!detailId || !detailRevisionId || cursorStack.length === 0) return;
    const target = cursorStack[cursorStack.length - 1];
    setCursorStack((stack) => stack.slice(0, -1));
    await loadDetailPage(detailId, detailRevisionId, target);
  };

  const checkDocumentSource = async (documentId: string): Promise<void> => {
    try {
      const ack = await window.betterwork.knowledge.checkSources({ documentIds: [documentId] });
      trackJob(ack.jobId);
      setMessage('已提交来源检查，原件与登记内容的比对在后台进行。');
    } catch (error) {
      setMessage(describeActionError(error, '提交来源检查失败。'));
    }
  };

  /** 契约 §12 单次最多 200 份：超出时分批提交，每批各有作业与终态。 */
  const checkAllSources = async (): Promise<void> => {
    const ids = documents.map((document) => document.id);
    if (ids.length === 0) {
      setMessage('资料库里现在没有可检查的资料。');
      return;
    }
    const batches: string[][] = [];
    for (let index = 0; index < ids.length; index += CHECK_SOURCES_BATCH_MAX) {
      batches.push(ids.slice(index, index + CHECK_SOURCES_BATCH_MAX));
    }
    try {
      for (const batch of batches) {
        const ack = await window.betterwork.knowledge.checkSources({ documentIds: batch });
        trackJob(ack.jobId);
      }
      setMessage(
        `已提交 ${ids.length} 份资料的原件检查${
          batches.length > 1 ? `（分 ${batches.length} 批）` : ''
        }，比对在后台进行，未检查项不会显示为正常。`,
      );
    } catch (error) {
      setMessage(describeActionError(error, '提交来源检查失败。'));
    }
  };

  const research = async (
    prompt: string,
    workspaceId: string,
  ): Promise<{ result: KnowledgeResearchDraftResult; stale: boolean } | undefined> => {
    const materials = [...selected.values()];
    if (materials.length === 0 || researchBusy) return undefined;
    const inputKey = JSON.stringify([prompt, workspaceId, materials]);
    const existing = operationByInput.current.get(inputKey);
    const operationId = existing ?? crypto.randomUUID();
    operationByInput.current.set(inputKey, operationId);
    const seq = researchSeq.current + 1;
    researchSeq.current = seq;
    setResearchBusy(true);
    try {
      const result = await window.betterwork.knowledge.createResearchDraft({
        operationId,
        workspaceId,
        prompt,
        materials,
      });
      return { result, stale: researchSeq.current !== seq };
    } finally {
      setResearchBusy(false);
    }
  };

  return {
    documents,
    results,
    query,
    setQuery,
    message,
    setMessage,
    issues,
    importing,
    loading,
    loadError,
    settings,
    embeddingModels,
    collections,
    filter,
    setFilter,
    createCollection,
    renameCollection,
    deleteCollection,
    saveDocumentCollections,
    activeJobs: [...activeJobs.values()],
    recentJobs: [...recentJobs.values()].sort(
      (left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id),
    ),
    jobDetail,
    jobDetailLoading,
    jobDetailError,
    openJobDetail,
    searchStatus,
    retryTarget,
    refresh,
    onImport,
    onSearch,
    onOpenSource,
    onRefresh,
    onRemove,
    selectedMaterials: [...selected.values()],
    isSelected,
    toggleSelect,
    selectAllResults,
    clearSelection,
    researchBusy,
    research,
    saveSettings,
    rebuildSemantic,
    rebuildKeyword,
    cancelJob,
    retryFailedItems,
    detailDocument: documents.find((document) => document.id === detailId),
    detailRevisions,
    detailRevisionId,
    detailPage,
    detailLoading,
    detailError,
    detailCanGoBack: cursorStack.length > 0,
    openDocument,
    closeDocument,
    selectDetailRevision,
    loadNextDetailPage,
    loadPreviousDetailPage,
    checkDocumentSource,
    checkAllSources,
  };
}

const JOB_TITLES: Record<KnowledgeJobSummary['kind'], string> = {
  import: '资料导入',
  refresh: '资料刷新',
  'rebuild-keyword': '关键词索引重建',
  'rebuild-semantic': '向量索引重建',
  'check-source': '来源检查',
};

const titleOfJob = (job: KnowledgeJobSummary): string => JOB_TITLES[job.kind];

/** 供作业面板按 kind 显示中文名。 */
export const knowledgeJobTitle = (kind: KnowledgeJobSummary['kind']): string => JOB_TITLES[kind];

const JOB_STATUS_LABELS: Record<KnowledgeJobStatus, string> = {
  queued: '排队中',
  running: '进行中',
  succeeded: '已完成',
  partial: '部分完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
};

const JOB_ITEM_STATUS_LABELS: Record<KnowledgeJobItemStatus, string> = {
  queued: '排队中',
  running: '处理中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
};

const JOB_PHASE_LABELS: Record<KnowledgeJobPhase, string> = {
  read: '读取原件',
  extract: '解析提取',
  chunk: '切分索引块',
  embed: '生成向量',
  publish: '发布索引',
  check: '比对原件',
};

/** 检索实际生效的方式，与契约 §9 的 effectiveMode 一一对应。 */
export const knowledgeModeLabel = (mode: KnowledgeSearchEffectiveMode): string => MODE_LABELS[mode];

/** 降级原因的唯一中文口径：内联消息与检索状态条共用，不再漏英文枚举。 */
export const knowledgeDegradedLabel = (reason: KnowledgeSearchDegradedReason): string =>
  DEGRADED_LABELS[reason];

/** 作业、条目与阶段的中文名。 */
export const knowledgeJobStatusLabel = (status: KnowledgeJobStatus): string =>
  JOB_STATUS_LABELS[status];
export const knowledgeJobItemStatusLabel = (status: KnowledgeJobItemStatus): string =>
  JOB_ITEM_STATUS_LABELS[status];
export const knowledgeJobPhaseLabel = (phase: KnowledgeJobPhase): string => JOB_PHASE_LABELS[phase];

const MODE_LABELS: Record<KnowledgeSearchEffectiveMode, string> = {
  keyword: '关键词',
  hybrid: '关键词＋语义',
  vector: '语义（向量）',
};

const DEGRADED_LABELS: Record<KnowledgeSearchDegradedReason, string> = {
  'semantic-disabled': '未启用语义检索',
  'model-unavailable': '嵌入模型不可用',
  'index-missing': '尚未建立语义索引',
  'index-partial': '部分资料未完成向量索引',
  'index-stale': '索引代次已过期，需要重建',
  'embedding-failed': '嵌入服务调用失败',
  'capacity-exceeded': '索引规模已达上限',
};
