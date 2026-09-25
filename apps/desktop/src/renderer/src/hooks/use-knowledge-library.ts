import type {
  KnowledgeCursor,
  KnowledgeDocumentSummary,
  KnowledgeJobSummary,
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
  /** KM09：语义设置、合格嵌入模型、进行中的作业与最近检索状态。 */
  settings: KnowledgeSearchSettings | undefined;
  embeddingModels: ModelProfileSummary[];
  activeJobs: KnowledgeJobSummary[];
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
}

const TERMINAL_STATUSES = new Set<KnowledgeJobSummary['status']>([
  'succeeded',
  'partial',
  'failed',
  'cancelled',
  'interrupted',
]);

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
  const [embeddingModels, setEmbeddingModels] = useState<ModelProfileSummary[]>([]);
  const [activeJobs, setActiveJobs] = useState<Map<string, KnowledgeJobSummary>>(() => new Map());
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
  const operationByInput = useRef<Map<string, string>>(new Map());

  const refresh = useCallback((): void => {
    setLoading(true);
    setLoadError('');
    trackAction(
      window.betterwork.knowledge
        .list()
        .then(setDocuments)
        .catch((error: unknown) => {
          setLoadError(describeActionError(error, '资料库加载失败，请重试。'));
        })
        .finally(() => setLoading(false)),
      '刷新资料库',
    );
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
          if (running.length === 0) return;
          setActiveJobs(new Map(running.map((job) => [job.id, job] as const)));
          for (const job of running) pendingJobs.current.add(job.id);
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
      reportJob(job.id);
    });
    return unsubscribe;
  }, [reportJob]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

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
      const response = await window.betterwork.knowledge.search({ query: term });
      // 迟到的检索响应不覆盖当前查询的结果与状态。
      if (searchSeq.current !== seq) return;
      setResults(response.results);
      setSearchStatus({
        effectiveMode: response.effectiveMode,
        coverage: response.coverage,
        ...(response.degradedReason ? { degradedReason: response.degradedReason } : {}),
      });
      if (response.degradedReason) {
        setMessage(`本次检索以关键词为主（${response.degradedReason}），兼容向量结果照常返回。`);
      }
      // 切换搜索后清空结果勾选，避免隐形的跨查询选择。
      setSelected((current) => {
        if (current.size > 0) setMessage('搜索结果已更新，此前的勾选已清空。');
        return new Map();
      });
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

  const openDocument = async (document: KnowledgeDocumentSummary): Promise<void> => {
    const seq = detailSeq.current + 1;
    detailSeq.current = seq;
    setDetailId(document.id);
    setDetailRevisions([]);
    setDetailPage(undefined);
    setDetailRevisionId(undefined);
    setDetailError('');
    setCursorStack([]);
    currentCursor.current = undefined;
    setDetailLoading(true);
    try {
      const revisions = await window.betterwork.knowledge.listRevisions({
        documentId: document.id,
      });
      if (detailSeq.current !== seq) return;
      setDetailRevisions(revisions);
      const first = revisions[0];
      if (!first) {
        setDetailError('该资料没有可预览的保存修订。');
        return;
      }
      await loadDetailPage(document.id, first.id, undefined);
    } catch (error) {
      if (detailSeq.current === seq) {
        setDetailError(describeActionError(error, '读取版本列表失败。'));
      }
    } finally {
      if (detailSeq.current === seq) setDetailLoading(false);
    }
  };

  const closeDocument = (): void => {
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
    activeJobs: [...activeJobs.values()],
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
