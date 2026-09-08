import type { RuntimeProfileDraft, SkillDetail, SkillSummary } from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { reportAction, trackAction } from '../lib/async-action';

export interface SkillsState {
  skills: SkillSummary[];
  selected: SkillDetail | undefined;
  selectedId: string | undefined;
  loading: boolean;
  detailLoading: boolean;
  importing: boolean;
  toast: string;
  error: string;
  select: (skill: SkillSummary) => void;
  refresh: () => void;
  importSkill: () => Promise<void>;
  setTrust: (skill: SkillSummary, trusted: boolean) => void;
  revokeTrust: (skill: SkillSummary) => void;
  setEnabled: (skill: SkillSummary, enabled: boolean) => void;
  copy: (skill: SkillSummary) => void;
  exportSkill: (skill: SkillSummary) => void;
  deleteSkill: (skill: SkillSummary) => Promise<void>;
  saveProfile: (skillId: string, profile: RuntimeProfileDraft) => Promise<void>;
  dismissToast: () => void;
  clearError: () => void;
}

export function useSkills(): SkillsState {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selected, setSelected] = useState<SkillDetail>();
  const [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const dismissToast = useCallback((): void => setToast(''), []);

  const refresh = useCallback((): void => {
    setLoading(true);
    trackAction(
      window.betterwork.skills.list().then((items) => {
        setSkills(items);
        setLoading(false);
      }),
      '刷新 Skill 列表',
    );
  }, []);

  useEffect(() => refresh(), [refresh]);

  const select = useCallback((skill: SkillSummary): void => {
    const nextRequestId = requestId.current + 1;
    requestId.current = nextRequestId;
    setSelectedId(skill.id);
    setDetailLoading(true);
    setError('');
    trackAction(
      window.betterwork.skills.get({ id: skill.id }).then((detail) => {
        if (requestId.current !== nextRequestId) return;
        setSelected(detail ?? undefined);
        setDetailLoading(false);
      }),
      '加载 Skill 详情',
    );
  }, []);

  const applyMutation = useCallback(
    (action: Promise<{ skill: SkillSummary }>, successMessage: string): void => {
      reportAction(
        action.then(({ skill }) => {
          setSkills((current) => current.map((item) => (item.id === skill.id ? skill : item)));
          setToast(successMessage);
          select(skill);
        }),
        setError,
        'Skill 操作失败，请重试。',
      );
    },
    [select],
  );

  const importSkill = useCallback(async (): Promise<void> => {
    setImporting(true);
    setError('');
    try {
      const result = await window.betterwork.skills.importFromDialog();
      if (result.cancelled) return;
      refresh();
      if (result.skill) select(result.skill);
      setToast('Skill 已导入，默认未信任。');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '导入 Skill 失败。');
    } finally {
      setImporting(false);
    }
  }, [refresh, select]);

  const setTrust = useCallback(
    (skill: SkillSummary, trusted: boolean): void => {
      applyMutation(
        window.betterwork.skills.setTrust({ skillId: skill.id, trusted }),
        trusted
          ? '已记录 Skill 信任意愿；运行配置和环境准备完成后才可执行。'
          : '已取消 Skill 信任。',
      );
    },
    [applyMutation],
  );
  const revokeTrust = useCallback(
    (skill: SkillSummary): void => {
      applyMutation(window.betterwork.skills.revokeTrust({ skillId: skill.id }), '已撤销信任。');
    },
    [applyMutation],
  );
  const setEnabled = useCallback(
    (skill: SkillSummary, enabled: boolean): void => {
      applyMutation(
        window.betterwork.skills.setEnabled({ skillId: skill.id, enabled }),
        enabled ? 'Skill 已启用。' : 'Skill 已停用。',
      );
    },
    [applyMutation],
  );
  const copy = useCallback(
    (skill: SkillSummary): void => {
      applyMutation(
        window.betterwork.skills.copy({ skillId: skill.id }),
        '已创建用户副本，可继续编辑。',
      );
    },
    [applyMutation],
  );
  const exportSkill = useCallback((skill: SkillSummary): void => {
    reportAction(
      window.betterwork.skills.export({ skillId: skill.id }).then((result) => {
        if (!result.cancelled) setToast(`Skill 已导出到 ${result.filePath ?? '所选位置'}。`);
      }),
      setError,
      '导出 Skill 失败，请重试。',
    );
  }, []);
  const deleteSkill = useCallback(async (skill: SkillSummary): Promise<void> => {
    await window.betterwork.skills.delete({ skillId: skill.id });
    setSkills((current) => current.filter((item) => item.id !== skill.id));
    setSelected(undefined);
    setSelectedId(undefined);
    setToast('Skill 已删除。');
  }, []);
  const saveProfile = useCallback(
    async (skillId: string, profile: RuntimeProfileDraft): Promise<void> => {
      const result = await window.betterwork.skills.saveRuntimeProfile({ skillId, profile });
      setSkills((current) => current.map((item) => (item.id === skillId ? result.skill : item)));
      setSelected((current) => (current?.id === skillId ? undefined : current));
      select(result.skill);
      setToast('运行配置草稿已保存。尚未准备环境。');
    },
    [select],
  );

  return {
    skills,
    selected,
    selectedId,
    loading,
    detailLoading,
    importing,
    toast,
    error,
    select,
    refresh,
    importSkill,
    setTrust,
    revokeTrust,
    setEnabled,
    copy,
    exportSkill,
    deleteSkill,
    saveProfile,
    dismissToast,
    clearError: () => setError(''),
  };
}
