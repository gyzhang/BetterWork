import type {
  KnowledgeDocumentSummary,
  KnowledgeJobSummary,
  KnowledgeResearchDraftMaterial,
  KnowledgeResearchDraftResult,
  KnowledgeSearchHit,
} from '@betterwork/agent-protocol';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';

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
}

/**
 * 本地资料库的界面状态与动作。
 *
 * 两个不变量：
 * - 所有失败都写进 `message` / `issues` 呈现给用户，不静默；
 * - 任何动作都不得修改或删除用户源文件，移除与刷新只作用于本地索引，
 *   文案必须把这一点说清楚。
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
  const researchSeq = useRef(0);
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
  const reportJob = useCallback((jobId: string): void => {
    trackAction(
      window.betterwork.knowledge.job({ jobId }).then((detail) => {
        if (!detail) return;
        const failed = detail.items.filter((item) => item.status === 'failed');
        setIssues(
          failed.map(
            (item) =>
              `${item.fileName ?? item.documentId ?? '资料'}：${item.failure?.message ?? '处理失败'}`,
          ),
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
  }, []);

  const trackJob = useCallback((jobId: string): void => {
    pendingJobs.current.add(jobId);
  }, []);

  useEffect(() => {
    const unsubscribe = window.betterwork.knowledge.onJobEvent((job: KnowledgeJobSummary) => {
      if (!pendingJobs.current.has(job.id)) return;
      if (job.status === 'queued' || job.status === 'running') return;
      pendingJobs.current.delete(job.id);
      reportJob(job.id);
    });
    return unsubscribe;
  }, [reportJob]);

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
        results
          .map((result) => [
            materialKey(result),
            { reference: result.reference, purpose: 'background' },
          ]),
      ),
    );
  }, [results]);

  const onSearch = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const term = query.trim();
    if (!term) {
      setResults([]);
      return;
    }
    try {
      const response = await window.betterwork.knowledge.search({ query: term });
      setResults(response.results);
      if (response.degradedReason) {
        setMessage(`语义检索已降级（${response.degradedReason}），当前展示关键词与已兼容向量的结果。`);
      }
      // 切换搜索后清空结果勾选，避免隐形的跨查询选择。
      setSelected((current) => {
        if (current.size > 0) setMessage('搜索结果已更新，此前的勾选已清空。');
        return new Map();
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '检索资料失败。');
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
