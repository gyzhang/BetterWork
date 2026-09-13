import type { SkillSummary } from '@betterwork/agent-protocol';
import { useCallback, useMemo, useRef, useState } from 'react';

import { CapabilityIcon, CloseIcon, PlusIcon } from '../icons';
import { PopoverMenu } from './PopoverMenu';

/**
 * Composer 能力选择器（ADR-0012 §UI / B00-4）。
 *
 * 一级菜单：技能 / 专家（禁用）/ 添加文件（禁用）。
 * 二级：技能列表，带搜索、多选、blockedReasons 置灰与定位入口。
 * 已选能力以 chip 条形式显示于输入框上方。
 */

export interface CapabilityChip {
  kind: 'skill';
  id: string;
  name: string;
  status: 'ready' | 'disabled' | 'untrusted' | 'dependency-missing';
}

export interface ComposerCapabilityPickerProps {
  skills: SkillSummary[];
  selected: CapabilityChip[];
  disabled?: boolean;
  disabledReason?: string;
  onAdd: (chip: CapabilityChip) => void;
  onRemove: (id: string) => void;
  onRequestSkillDetail: (skillId: string) => void;
}

const computeSkillStatus = (skill: SkillSummary): CapabilityChip['status'] => {
  if (!skill.enabled) return 'disabled';
  if (skill.trustStatus !== 'trusted') return 'untrusted';
  if (skill.environmentStatus !== 'ready') return 'dependency-missing';
  return 'ready';
};

const statusHint = (skill: SkillSummary): string | undefined => {
  if (skill.blockedReasons.length > 0) return skill.blockedReasons.join('；');
  return undefined;
};

export function ComposerCapabilityPicker({
  skills,
  selected,
  disabled = false,
  disabledReason,
  onAdd,
  onRemove,
  onRequestSkillDetail,
}: ComposerCapabilityPickerProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const skillButtonRef = useRef<HTMLButtonElement>(null);

  const selectedIds = useMemo(() => new Set(selected.map((chip) => chip.id)), [selected]);

  const filteredSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return skills;
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query),
    );
  }, [skills, searchQuery]);

  const handleTopLevelSelect = useCallback((id: string) => {
    if (id === 'skills') {
      setMenuOpen(false);
      setSkillPickerOpen(true);
      setSearchQuery('');
    }
    // 'experts' and 'files' are disabled, no action.
  }, []);

  const handleSkillSelect = useCallback(
    (skillId: string) => {
      const skill = skills.find((s) => s.id === skillId);
      if (!skill || selectedIds.has(skillId)) return;
      const status = computeSkillStatus(skill);
      if (status !== 'ready') return;
      onAdd({ kind: 'skill', id: skill.id, name: skill.name, status });
      setSkillPickerOpen(false);
      setSearchQuery('');
    },
    [skills, selectedIds, onAdd],
  );

  const topLevelItems = [
    { id: 'skills', label: '技能' },
    { id: 'experts', label: '专家', disabled: true, hint: '阶段 B 提供' },
    { id: 'files', label: '添加文件', disabled: true, hint: '尚未开放' },
  ];

  const skillItems = useMemo(
    () =>
      filteredSkills.map((skill) => {
        const status = computeSkillStatus(skill);
        const isDisabled = status !== 'ready' || selectedIds.has(skill.id);
        const hintText = isDisabled
          ? (statusHint(skill) ?? (selectedIds.has(skill.id) ? '已选择' : undefined))
          : undefined;
        return {
          id: skill.id,
          label: skill.name,
          disabled: isDisabled,
          ...(hintText ? { hint: hintText } : {}),
        };
      }),
    [filteredSkills, selectedIds],
  );

  return (
    <>
      {selected.length > 0 && (
        <div className="capability-chip-bar" role="list" aria-label="已选能力">
          {selected.map((chip) => (
            <div key={chip.id} className="capability-chip" role="listitem">
              <CapabilityIcon size={12} />
              <span className="capability-chip-label">{chip.name}</span>
              <button
                type="button"
                className="capability-chip-remove"
                aria-label={`移除 ${chip.name}`}
                onClick={() => onRemove(chip.id)}
                disabled={disabled}
              >
                <CloseIcon size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        ref={buttonRef}
        type="button"
        className="capability-picker-trigger"
        aria-label="添加能力"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((prev) => !prev)}
        disabled={disabled}
      >
        <PlusIcon size={14} />
      </button>
      <PopoverMenu
        open={menuOpen}
        anchorRef={buttonRef}
        items={topLevelItems}
        label="能力类型"
        onDismiss={() => setMenuOpen(false)}
        onSelect={handleTopLevelSelect}
      />
      <PopoverMenu
        open={skillPickerOpen}
        anchorRef={buttonRef}
        items={skillItems}
        label="选择技能"
        onDismiss={() => {
          setSkillPickerOpen(false);
          setSearchQuery('');
        }}
        onSelect={handleSkillSelect}
        header={
          <div className="capability-search">
            <input
              ref={skillButtonRef as unknown as React.RefObject<HTMLInputElement>}
              type="text"
              placeholder="搜索技能…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              aria-label="搜索技能"
            />
          </div>
        }
        footer={
          filteredSkills.some((skill) => {
            const status = computeSkillStatus(skill);
            return status !== 'ready' && skill.blockedReasons.length > 0;
          }) ? (
            <button
              type="button"
              className="capability-locate-link"
              onClick={() => {
                const firstBlocked = filteredSkills.find((skill) => {
                  const status = computeSkillStatus(skill);
                  return status !== 'ready' && skill.blockedReasons.length > 0;
                });
                if (firstBlocked) onRequestSkillDetail(firstBlocked.id);
              }}
            >
              查看不可用原因
            </button>
          ) : undefined
        }
      />
      {disabled && disabledReason ? (
        <span className="capability-picker-reason">{disabledReason}</span>
      ) : undefined}
    </>
  );
}
