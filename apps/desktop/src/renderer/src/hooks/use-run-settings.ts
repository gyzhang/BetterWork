import {
  DEFAULT_MAX_SKILL_TOOL_ROUNDS,
  MAX_SKILL_TOOL_ROUNDS,
  type RunSettings,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';
import { useTransientToast } from './use-transient-toast';

export interface RunSettingsState {
  settings: RunSettings | undefined;
  draft: string;
  loading: boolean;
  saving: boolean;
  error: string;
  toast: ReturnType<typeof useTransientToast>['toast'];
  setDraft: (value: string) => void;
  refresh: () => void;
  save: () => void;
  dismissToast: () => void;
}

/** 持久化 Skill Run 执行轮数；设置变更只作用于后续启动的 Run。 */
export function useRunSettings(): RunSettingsState {
  const [settings, setSettings] = useState<RunSettings>();
  const [draft, setDraft] = useState(String(DEFAULT_MAX_SKILL_TOOL_ROUNDS));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { toast, showToast, dismissToast } = useTransientToast();

  const refresh = useCallback((): void => {
    setLoading(true);
    setError('');
    trackAction(
      window.betterwork.runSettings
        .get()
        .then((current) => {
          setSettings(current);
          setDraft(String(current.maxSkillToolRounds));
        })
        .catch((failure: unknown) => {
          setError(describeActionError(failure, '读取 Skill 执行设置失败。'));
        })
        .finally(() => setLoading(false)),
      '读取 Skill 执行设置',
    );
  }, []);

  const save = useCallback((): void => {
    const maxSkillToolRounds = Number(draft);
    if (
      !Number.isInteger(maxSkillToolRounds) ||
      maxSkillToolRounds < 1 ||
      maxSkillToolRounds > MAX_SKILL_TOOL_ROUNDS
    ) {
      setError(`请输入 1–${MAX_SKILL_TOOL_ROUNDS} 之间的整数。`);
      return;
    }
    setSaving(true);
    setError('');
    trackAction(
      window.betterwork.runSettings
        .save({ maxSkillToolRounds })
        .then((saved) => {
          setSettings(saved);
          setDraft(String(saved.maxSkillToolRounds));
          showToast('success', 'Skill 执行设置已保存');
        })
        .catch((failure: unknown) => {
          setError(describeActionError(failure, '保存 Skill 执行设置失败。'));
        })
        .finally(() => setSaving(false)),
      '保存 Skill 执行设置',
    );
  }, [draft, showToast]);

  useEffect(() => refresh(), [refresh]);

  return { settings, draft, loading, saving, error, toast, setDraft, refresh, save, dismissToast };
}
