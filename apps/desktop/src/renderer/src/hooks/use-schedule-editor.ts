import {
  type ExpertDetail,
  type ExpertSummary,
  type ScheduleConfigDraft,
  type ScheduleDetail,
  type ScheduleLifecycle,
  type SchedulePreflightView,
  type SchedulePreviewResult,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';
import {
  defaultScheduleEditorValue,
  parseScheduleTime,
  reusableEnabledFingerprint,
  scheduleEditorConfig,
  type ScheduleEditorValue,
  scheduleEditorValueFromDetail,
} from '../lib/schedule-editor';

export interface ScheduleEditorState {
  value: ScheduleEditorValue;
  expertLabel: string;
  expertLoading: boolean;
  expertError: string;
  preview?: SchedulePreviewResult;
  previewLoading: boolean;
  previewError: string;
  preflight?: SchedulePreflightView;
  validationErrors: string[];
  saveError: string;
  saving: boolean;
  savingTarget?: 'enabled' | 'paused';
  dirty: boolean;
  updateConfig: (update: (config: ScheduleConfigDraft) => ScheduleConfigDraft) => void;
  setWorkspaceId: (workspaceId: string) => void;
  setTimeInput: (timeInput: string) => void;
  selectExpert: (expertId: string) => void;
  retryPreview: () => void;
  save: (targetLifecycle: Extract<ScheduleLifecycle, 'enabled' | 'paused'>) => void;
}

export function useScheduleEditor({
  detail,
  experts,
  getExpert,
  onSaved,
}: {
  detail?: ScheduleDetail;
  experts: readonly ExpertSummary[];
  getExpert: (id: string) => Promise<ExpertDetail | null>;
  onSaved: (lifecycle: 'enabled' | 'paused') => void;
}): ScheduleEditorState {
  const [value, setValue] = useState<ScheduleEditorValue>(() =>
    detail ? scheduleEditorValueFromDetail(detail) : defaultScheduleEditorValue(),
  );
  const [initialFingerprint] = useState(() => JSON.stringify(value));
  const [expertLabel, setExpertLabel] = useState(() =>
    detail
      ? `${detail.expertUpdate.boundRevision.name} · 修订 ${detail.expertUpdate.boundRevision.revision}`
      : '',
  );
  const [expertLoading, setExpertLoading] = useState(false);
  const [expertError, setExpertError] = useState('');
  const [preview, setPreview] = useState<SchedulePreviewResult>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [preflight, setPreflight] = useState<SchedulePreflightView>();
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingTarget, setSavingTarget] = useState<'enabled' | 'paused'>();
  const [previewRetry, setPreviewRetry] = useState(0);
  const expertRequestId = useRef(0);
  const savingRef = useRef(false);

  const updateConfig = useCallback(
    (update: (config: ScheduleConfigDraft) => ScheduleConfigDraft): void => {
      setValue((current) => ({ ...current, config: update(current.config) }));
      setValidationErrors([]);
      setSaveError('');
    },
    [],
  );
  const setWorkspaceId = useCallback((workspaceId: string): void => {
    setValue((current) => ({ ...current, workspaceId }));
    setValidationErrors([]);
    setSaveError('');
  }, []);
  const setTimeInput = useCallback((timeInput: string): void => {
    const parsedTime = parseScheduleTime(timeInput);
    setValue((current) => ({
      ...current,
      timeInput,
      ...(parsedTime
        ? {
            config: {
              ...current.config,
              timing: { ...current.config.timing, ...parsedTime },
            },
          }
        : {}),
    }));
    setValidationErrors([]);
    setSaveError('');
  }, []);

  const selectExpert = useCallback(
    (expertId: string): void => {
      const currentRequest = expertRequestId.current + 1;
      expertRequestId.current = currentRequest;
      setExpertError('');
      setValidationErrors([]);
      if (!expertId) {
        setExpertLabel('');
        setExpertLoading(false);
        updateConfig((config) => ({ ...config, expertId: '', expertRevisionId: '' }));
        return;
      }
      const summary = experts.find((candidate) => candidate.id === expertId);
      if (!summary || summary.lifecycle !== 'active') {
        setExpertLoading(false);
        setExpertError('只能选择当前可用的已有专家。');
        return;
      }

      const load = async (): Promise<void> => {
        setExpertLoading(true);
        try {
          const expert = await getExpert(expertId);
          if (expertRequestId.current !== currentRequest) return;
          if (!expert || expert.lifecycle !== 'active' || expert.revision.expertId !== expert.id) {
            setExpertError('这个专家当前不可用，请重新选择。');
            return;
          }
          updateConfig((config) => ({
            ...config,
            expertId: expert.id,
            expertRevisionId: expert.revision.id,
          }));
          setExpertLabel(`${expert.revision.name} · 修订 ${expert.revision.revision}`);
        } catch (error) {
          if (expertRequestId.current === currentRequest) {
            setExpertError(describeActionError(error, '读取专家修订失败，请重试选择。'));
          }
        } finally {
          if (expertRequestId.current === currentRequest) setExpertLoading(false);
        }
      };
      trackAction(load(), '读取定时任务专家修订');
    },
    [experts, getExpert, updateConfig],
  );

  useEffect(() => {
    let current = true;
    const parsedTime = parseScheduleTime(value.timeInput);
    if (!parsedTime) {
      setPreview(undefined);
      setPreviewLoading(false);
      setPreviewError('');
      return () => {
        current = false;
      };
    }

    setPreview(undefined);
    setPreviewError('');
    const timer = window.setTimeout(() => {
      setPreviewLoading(true);
      const request = window.betterwork.schedules.preview({
        timing: { ...value.config.timing, ...parsedTime },
        periodRule: value.config.periodRule,
      });
      request
        .then((result) => {
          if (!current) return;
          if (result.status === 'rejected') {
            setPreviewError(result.error.message);
            return;
          }
          setPreview(result.data);
        })
        .catch((error: unknown) => {
          if (current) setPreviewError(describeActionError(error, '读取计划预览失败，请重试。'));
        })
        .finally(() => {
          if (current) setPreviewLoading(false);
        });
    }, 250);

    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [value.config.periodRule, value.config.timing, value.timeInput, previewRetry]);

  const retryPreview = useCallback((): void => {
    setPreviewRetry((current) => current + 1);
  }, []);

  const save = useCallback(
    (targetLifecycle: 'enabled' | 'paused'): void => {
      const persist = async (): Promise<void> => {
        if (savingRef.current) return;
        const validation = scheduleEditorConfig(value);
        const errors = [...validation.errors];
        if (!value.workspaceId) errors.unshift('请选择持续使用的工作空间。');
        if (!value.config.expertId || !value.config.expertRevisionId)
          errors.unshift('请选择一个当前可用的已有专家。');
        if (expertLoading) errors.unshift('请等待专家修订读取完成。');
        if (errors.length > 0 || !validation.config) {
          setValidationErrors(errors);
          setSaveError('请先修正配置中的必填项。');
          return;
        }

        savingRef.current = true;
        setSaving(true);
        setSavingTarget(targetLifecycle);
        setValidationErrors([]);
        setSaveError('');
        try {
          let fingerprint: string | undefined;
          if (targetLifecycle === 'enabled') {
            fingerprint = reusableEnabledFingerprint(detail, validation.config);
            if (fingerprint === undefined) {
              const checked = await window.betterwork.schedules.preflight({
                target: 'draft',
                workspaceId: value.workspaceId,
                config: validation.config,
              });
              if (checked.status === 'rejected') {
                setSaveError(checked.error.message);
                return;
              }
              setPreflight(checked.data);
              if (checked.data.status === 'blocked') {
                setSaveError('启用前检查未通过；配置和草稿均已保留。');
                return;
              }
              fingerprint = checked.data.fingerprint;
            }
          }

          const saveInput = {
            config: validation.config,
            targetLifecycle,
            ...(fingerprint === undefined ? {} : { preflightFingerprint: fingerprint }),
          };
          const result = detail
            ? await window.betterwork.schedules.save({
                operation: 'update',
                scheduleId: detail.aggregate.schedule.id,
                expectedRevision: detail.aggregate.schedule.revision,
                ...saveInput,
              })
            : await window.betterwork.schedules.save({
                operation: 'create',
                workspaceId: value.workspaceId,
                ...saveInput,
              });
          if (result.status === 'rejected') {
            setSaveError(
              result.error.code === 'schedule_conflict'
                ? `${result.error.message} 当前输入已保留；请重新读取最新配置后再决定如何处理。`
                : result.error.message,
            );
            return;
          }
          onSaved(targetLifecycle);
        } catch (error) {
          setSaveError(describeActionError(error, '保存定时任务失败；当前输入已保留。'));
        } finally {
          savingRef.current = false;
          setSaving(false);
          setSavingTarget(undefined);
        }
      };
      trackAction(persist(), '保存定时任务');
    },
    [detail, expertLoading, onSaved, value],
  );

  return {
    value,
    expertLabel,
    expertLoading,
    expertError,
    ...(preview === undefined ? {} : { preview }),
    previewLoading,
    previewError,
    ...(preflight === undefined ? {} : { preflight }),
    validationErrors,
    saveError,
    saving,
    ...(savingTarget === undefined ? {} : { savingTarget }),
    dirty: JSON.stringify(value) !== initialFingerprint,
    updateConfig,
    setWorkspaceId,
    setTimeInput,
    selectExpert,
    retryPreview,
    save,
  };
}
