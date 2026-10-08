import {
  DEFAULT_ENABLE_BUILTIN_EXPERTS,
  DEFAULT_ENABLE_BUILTIN_SKILLS,
  DEFAULT_MAX_SKILL_TOOL_ROUNDS,
  MAX_SKILL_TOOL_ROUNDS,
  type RunSettings,
  type SaveRunSettingsRequest,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';

const INPUT_SAVE_DELAY_MS = 450;
const INITIAL_RUN_SETTINGS: SaveRunSettingsRequest = {
  maxSkillToolRounds: DEFAULT_MAX_SKILL_TOOL_ROUNDS,
  enableBuiltinSkills: DEFAULT_ENABLE_BUILTIN_SKILLS,
  enableBuiltinExperts: DEFAULT_ENABLE_BUILTIN_EXPERTS,
};

export interface RunSettingsState {
  settings: RunSettings | undefined;
  draft: string;
  enableBuiltinSkills: boolean;
  enableBuiltinExperts: boolean;
  loading: boolean;
  saving: boolean;
  error: string;
  setDraft: (value: string) => void;
  setEnableBuiltinSkills: (enabled: boolean) => void;
  setEnableBuiltinExperts: (enabled: boolean) => void;
  flushDraft: () => void;
  retrySave: () => void;
  refresh: () => void;
}

/** 运行设置自动保存；开关立即提交，轮数输入在有效值稳定后提交。 */
export function useRunSettings(): RunSettingsState {
  const [settings, setSettings] = useState<RunSettings>();
  const [draft, setDraftState] = useState(String(DEFAULT_MAX_SKILL_TOOL_ROUNDS));
  const [enableBuiltinSkills, setEnableBuiltinSkillsState] = useState(
    DEFAULT_ENABLE_BUILTIN_SKILLS,
  );
  const [enableBuiltinExperts, setEnableBuiltinExpertsState] = useState(
    DEFAULT_ENABLE_BUILTIN_EXPERTS,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const mountedRef = useRef(false);
  const loadRevisionRef = useRef(0);
  const saveRevisionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const timerRef = useRef<number | undefined>(undefined);
  const draftRef = useRef(String(DEFAULT_MAX_SKILL_TOOL_ROUNDS));
  const enableBuiltinSkillsRef = useRef(DEFAULT_ENABLE_BUILTIN_SKILLS);
  const enableBuiltinExpertsRef = useRef(DEFAULT_ENABLE_BUILTIN_EXPERTS);
  const savedValuesRef = useRef<SaveRunSettingsRequest>(INITIAL_RUN_SETTINGS);
  const desiredValuesRef = useRef<SaveRunSettingsRequest>(INITIAL_RUN_SETTINGS);

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  const refresh = useCallback((): void => {
    const revision = ++loadRevisionRef.current;
    setLoading(true);
    setError('');
    trackAction(
      window.betterwork.runSettings
        .get()
        .then((current) => {
          if (!mountedRef.current || revision !== loadRevisionRef.current) return;
          const values: SaveRunSettingsRequest = {
            maxSkillToolRounds: current.maxSkillToolRounds,
            enableBuiltinSkills: current.enableBuiltinSkills,
            enableBuiltinExperts: current.enableBuiltinExperts,
          };
          savedValuesRef.current = values;
          desiredValuesRef.current = values;
          draftRef.current = String(current.maxSkillToolRounds);
          enableBuiltinSkillsRef.current = current.enableBuiltinSkills;
          enableBuiltinExpertsRef.current = current.enableBuiltinExperts;
          setSettings(current);
          setDraftState(draftRef.current);
          setEnableBuiltinSkillsState(current.enableBuiltinSkills);
          setEnableBuiltinExpertsState(current.enableBuiltinExperts);
        })
        .catch((failure: unknown) => {
          if (mountedRef.current && revision === loadRevisionRef.current) {
            setError(describeActionError(failure, '读取运行设置失败。'));
          }
        })
        .finally(() => {
          if (mountedRef.current && revision === loadRevisionRef.current) setLoading(false);
        }),
      '读取运行设置',
    );
  }, []);

  const persist = useCallback((values: SaveRunSettingsRequest): void => {
    const revision = ++saveRevisionRef.current;
    desiredValuesRef.current = values;
    setSaving(true);
    setError('');

    saveQueueRef.current = saveQueueRef.current.then(async () => {
      try {
        const saved = await window.betterwork.runSettings.save(values);
        const savedValues: SaveRunSettingsRequest = {
          maxSkillToolRounds: saved.maxSkillToolRounds,
          enableBuiltinSkills: saved.enableBuiltinSkills,
          enableBuiltinExperts: saved.enableBuiltinExperts,
        };
        savedValuesRef.current = savedValues;
        if (mountedRef.current) setSettings(saved);
      } catch (failure: unknown) {
        if (mountedRef.current && revision === saveRevisionRef.current) {
          desiredValuesRef.current = savedValuesRef.current;
          setError(describeActionError(failure, '自动保存运行设置失败。'));
        }
      } finally {
        if (mountedRef.current && revision === saveRevisionRef.current) setSaving(false);
      }
    });
  }, []);

  const validDraftValue = useCallback((): number | undefined => {
    const value = Number(draftRef.current);
    return Number.isInteger(value) && value >= 1 && value <= MAX_SKILL_TOOL_ROUNDS
      ? value
      : undefined;
  }, []);

  const flushDraft = useCallback((): void => {
    clearTimer();
    const maxSkillToolRounds = validDraftValue();
    if (maxSkillToolRounds === undefined) return;
    const values: SaveRunSettingsRequest = {
      maxSkillToolRounds,
      enableBuiltinSkills: enableBuiltinSkillsRef.current,
      enableBuiltinExperts: enableBuiltinExpertsRef.current,
    };
    const desired = desiredValuesRef.current;
    if (
      values.maxSkillToolRounds !== desired.maxSkillToolRounds ||
      values.enableBuiltinSkills !== desired.enableBuiltinSkills ||
      values.enableBuiltinExperts !== desired.enableBuiltinExperts
    ) {
      persist(values);
    }
  }, [clearTimer, persist, validDraftValue]);

  const setDraft = useCallback(
    (value: string): void => {
      draftRef.current = value;
      setDraftState(value);
      setError('');
      clearTimer();
      if (validDraftValue() !== undefined) {
        timerRef.current = window.setTimeout(flushDraft, INPUT_SAVE_DELAY_MS);
      }
    },
    [clearTimer, flushDraft, validDraftValue],
  );

  const setEnableBuiltinSkills = useCallback(
    (enabled: boolean): void => {
      enableBuiltinSkillsRef.current = enabled;
      setEnableBuiltinSkillsState(enabled);
      const maxSkillToolRounds = validDraftValue() ?? savedValuesRef.current.maxSkillToolRounds;
      clearTimer();
      persist({
        maxSkillToolRounds,
        enableBuiltinSkills: enabled,
        enableBuiltinExperts: enableBuiltinExpertsRef.current,
      });
    },
    [clearTimer, persist, validDraftValue],
  );

  const setEnableBuiltinExperts = useCallback(
    (enabled: boolean): void => {
      enableBuiltinExpertsRef.current = enabled;
      setEnableBuiltinExpertsState(enabled);
      const maxSkillToolRounds = validDraftValue() ?? savedValuesRef.current.maxSkillToolRounds;
      clearTimer();
      persist({
        maxSkillToolRounds,
        enableBuiltinSkills: enableBuiltinSkillsRef.current,
        enableBuiltinExperts: enabled,
      });
    },
    [clearTimer, persist, validDraftValue],
  );

  const retrySave = useCallback((): void => {
    clearTimer();
    persist({
      maxSkillToolRounds: validDraftValue() ?? savedValuesRef.current.maxSkillToolRounds,
      enableBuiltinSkills: enableBuiltinSkillsRef.current,
      enableBuiltinExperts: enableBuiltinExpertsRef.current,
    });
  }, [clearTimer, persist, validDraftValue]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => {
      mountedRef.current = false;
      loadRevisionRef.current += 1;
      saveRevisionRef.current += 1;
      clearTimer();
    };
  }, [clearTimer, refresh]);

  return {
    settings,
    draft,
    enableBuiltinSkills,
    enableBuiltinExperts,
    loading,
    saving,
    error,
    setDraft,
    setEnableBuiltinSkills,
    setEnableBuiltinExperts,
    flushDraft,
    retrySave,
    refresh,
  };
}
