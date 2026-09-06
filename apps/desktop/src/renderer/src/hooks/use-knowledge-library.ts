import type { KnowledgeDocumentSummary, KnowledgeSearchResult } from '@betterwork/agent-protocol';
import { type FormEvent, useCallback, useState } from 'react';

import { trackAction } from '../lib/async-action';
import { fileNameOf } from '../lib/format';

export interface KnowledgeLibrary {
  documents: KnowledgeDocumentSummary[];
  results: KnowledgeSearchResult[];
  query: string;
  setQuery: (query: string) => void;
  message: string;
  issues: string[];
  importing: boolean;
  /** 后台重新拉取资料清单；永不 reject。 */
  refresh: () => void;
  onImport: () => Promise<void>;
  onSearch: (event: FormEvent) => Promise<void>;
  onOpenSource: (sourcePath: string) => Promise<void>;
  onRefresh: (document: KnowledgeDocumentSummary) => Promise<void>;
  onRemove: (document: KnowledgeDocumentSummary) => Promise<void>;
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
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const refresh = useCallback((): void => {
    trackAction(window.betterwork.knowledge.list().then(setDocuments), '刷新资料库');
  }, []);

  const onImport = async (): Promise<void> => {
    setImporting(true);
    setMessage('');
    setIssues([]);
    try {
      const result = await window.betterwork.knowledge.importFromDialog();
      if (result.imported.length || result.skipped.length) {
        setMessage(
          `已整理 ${result.imported.length} 份资料${result.skipped.length ? `；${result.skipped.length} 份未导入` : ''}。`,
        );
        setIssues(result.skipped.map((item) => `${fileNameOf(item.sourcePath)}：${item.reason}`));
      } else {
        setMessage('已取消导入，未选择文件。');
      }
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入资料失败。');
    } finally {
      setImporting(false);
    }
  };

  const onOpenSource = async (sourcePath: string): Promise<void> => {
    const result = await window.betterwork.knowledge.openSource({ sourcePath });
    if (!result.opened) throw new Error(result.error ?? '无法打开原始资料。');
  };

  const onRemove = async (document: KnowledgeDocumentSummary): Promise<void> => {
    if (
      !window.confirm(
        `从算台资料库移除「${document.title}」？\n\n这不会删除原始文件，只会删除本地检索索引。`,
      )
    ) {
      return;
    }
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
    try {
      const result = await window.betterwork.knowledge.refresh({ id: document.id });
      if (!result.refreshed) {
        const errorMessage = result.error ?? '刷新索引失败。';
        setMessage(errorMessage);
        throw new Error(errorMessage);
      }
      setMessage('');
      setQuery('');
      refresh();
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? `刷新索引失败：${error.message}`
          : '刷新索引失败，请重试。',
      );
    } finally {
      setImporting(false);
    }
  };

  const onSearch = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const term = query.trim();
    if (!term) {
      setResults([]);
      return;
    }
    try {
      setResults(await window.betterwork.knowledge.search({ query: term }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '检索资料失败。');
    }
  };

  return {
    documents,
    results,
    query,
    setQuery,
    message,
    issues,
    importing,
    refresh,
    onImport,
    onSearch,
    onOpenSource,
    onRefresh,
    onRemove,
  };
}
