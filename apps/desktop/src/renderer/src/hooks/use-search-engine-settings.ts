import type { SearchEngineSummary } from '@betterwork/agent-protocol';
import { useCallback, useEffect, useState } from 'react';

import { trackAction } from '../lib/async-action';

/**
 * 当前只接入百度千帆一家（ADR-0007）。新增服务商时这里改为可选项，
 * 而不是在界面各处散写字符串字面量。
 */
const PROVIDER = 'baidu_qianfan';
const DEFAULT_WEB_TOP_K = 10;
const WEB_TOP_K_LIMIT = { min: 1, max: 20 } as const;

export interface SearchEngineSettings {
  configured: SearchEngineSummary | undefined;
  apiKey: string;
  setApiKey: (apiKey: string) => void;
  webTopK: number;
  setWebTopK: (webTopK: number) => void;
  message: string;
  save: () => Promise<void>;
  test: () => Promise<void>;
}

/**
 * 搜索引擎配置的状态与动作。
 *
 * API Key 输入框留空表示沿用已保存的凭据，保存成功后立刻清空输入，
 * 避免密钥停留在界面状态里。
 */
export function useSearchEngineSettings(): SearchEngineSettings {
  const [engines, setEngines] = useState<SearchEngineSummary[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [webTopK, setWebTopKValue] = useState(DEFAULT_WEB_TOP_K);
  const [message, setMessage] = useState('');

  const refresh = useCallback((): void => {
    trackAction(window.betterwork.searchEngines.list().then(setEngines), '刷新搜索引擎配置');
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setWebTopK = (next: number): void => {
    const fallback = Number.isFinite(next) ? next : DEFAULT_WEB_TOP_K;
    setWebTopKValue(Math.min(WEB_TOP_K_LIMIT.max, Math.max(WEB_TOP_K_LIMIT.min, fallback)));
  };

  const save = async (): Promise<void> => {
    try {
      await window.betterwork.searchEngines.save({
        provider: PROVIDER,
        apiKey,
        webTopK,
        enabled: true,
      });
      setApiKey('');
      setMessage('搜索配置已保存，智能体可以在任务中联网搜索并标注来源。');
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请检查配置。');
    }
  };

  const test = async (): Promise<void> => {
    setMessage('正在连接搜索服务…');
    try {
      const result = await window.betterwork.searchEngines.test({
        provider: PROVIDER,
        apiKey,
        webTopK,
      });
      setMessage(result.message);
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '连接测试失败。');
    }
  };

  return {
    configured: engines.find((engine) => engine.provider === PROVIDER),
    apiKey,
    setApiKey,
    webTopK,
    setWebTopK,
    message,
    save,
    test,
  };
}
