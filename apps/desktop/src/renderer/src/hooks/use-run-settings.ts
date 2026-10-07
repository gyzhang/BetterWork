import {
  DEFAULT_ENABLE_BUILTIN_EXPERTS,
  DEFAULT_ENABLE_BUILTIN_SKILLS,
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
  enableBuiltinSkills: boolean;
  enableBuiltinExperts: boolean;
  loading: boolean;
  saving: boolean;
  error: string;
  toast: ReturnType<typeof useTransientToast>['toast'];
  setDraft: (value: string) => void;
  setEnableBuiltinSkills: (enabled: boolean) => void;
  setEnableBuiltinExperts: (enabled: boolean) => void;
  refresh: () => void;
  save: () => void;
  dismissToast: () => void;
}

/** 持久化运行与内置资源设置；内置资源立即影响可用性，运行轮数作用于新 Run。 */
export function useRunSettings(): RunSettingsState {
  const [settings, setSettings] = useState<RunSettings>();
  const [draft, setDraft] = useState(String(DEFAULT_MAX_SKILL_TOOL_ROUNDS));
  const [enableBuiltinSkills, setEnableBuiltinSkills] = useState<boolean>(
    DEFAULT_ENABLE_BUILTIN_SKILLS,
  );
  const [enableBuiltinExperts, setEnableBuiltinExperts] = useState<boolean>(
    DEFAULT_ENABLE_BUILTIN_EXPERTS,
  );
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
          setEnableBuiltinSkills(current.enableBuiltinSkills);
          setEnableBuiltinExperts(current.enableBuiltinExperts);
        })
        .catch((failure: unknown) => {
          setError(describeActionError(failure, '读取运行设置失败。'));
        })
        .finally(() => setLoading(false)),
      '读取运行设置',
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
        .save({ maxSkillToolRounds, enableBuiltinSkills, enableBuiltinExperts })
        .then((saved) => {
          setSettings(saved);
          setDraft(String(saved.maxSkillToolRounds));
          setEnableBuiltinSkills(saved.enableBuiltinSkills);
          setEnableBuiltinExperts(saved.enableBuiltinExperts);
          showToast('success', '运行设置已保存');
        })
        .catch((failure: unknown) => {
          setError(describeActionError(failure, '保存运行设置失败。'));
        })
        .finally(() => setSaving(false)),
      '保存运行设置',
    );
  }, [draft, enableBuiltinExperts, enableBuiltinSkills, showToast]);

  useEffect(() => refresh(), [refresh]);

  return {
    settings,
    draft,
    enableBuiltinSkills,
    enableBuiltinExperts,
    loading,
    saving,
    error,
    toast,
    setDraft,
    setEnableBuiltinSkills,
    setEnableBuiltinExperts,
    refresh,
    save,
    dismissToast,
  };
}
