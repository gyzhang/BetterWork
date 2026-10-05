import type {
  MaterialCandidate,
  MaterialPurpose,
  SkillSummary,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CapabilityIcon, PlusIcon } from '../icons';
import { materialCandidateKey, taskMaterialKey } from '../lib/materials';
import { ActionBar } from './ActionBar';
import { InlineLoading } from './AsyncButton';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { PopoverMenu } from './PopoverMenu';
import { TextField } from './TextField';

/**
 * Composer 能力选择器（ADR-0012 §UI / B00-4）。
 *
 * 一级菜单：专家 / 技能 / 添加文件 / 引用知识 / 引用成果。
 * 二级：技能列表，带搜索、多选、blockedReasons 置灰与定位入口。
 * 执行能力显示为紧凑摘要；材料只在 Composer 中显示数量，明细由任务资料面板管理。
 */

export interface CapabilityChip {
  kind: 'skill';
  id: string;
  name: string;
  revisionId?: string;
  status: 'ready' | 'disabled' | 'untrusted' | 'dependency-missing';
  source?: 'expert-preset' | 'task-selection';
}

export interface ComposerCapabilityPickerProps {
  skills: SkillSummary[];
  selected: CapabilityChip[];
  disabled?: boolean;
  disabledReason?: string;
  onAdd: (chip: CapabilityChip) => void;
  onRemove: (id: string) => void;
  onRequestSkillDetail: (skillId: string) => void;
  onRequestExpert: () => void;
  materials: TaskMaterialSelection[];
  materialCandidates: MaterialCandidate[];
  workspaceId?: string;
  materialPickerKind?: 'knowledge' | 'artifact';
  materialsLoading?: boolean;
  materialPickerError?: string;
  onRequestMaterials: (kind: 'file' | 'knowledge' | 'artifact') => void;
  onDismissMaterialPicker: () => void;
  onCommitMaterials: (materials: TaskMaterialSelection[]) => void;
  /** 紧随「＋」后的绑定摘要（如已选专家）。 */
  afterAddButton?: React.ReactNode | undefined;
  onManageMaterials?: (() => void) | undefined;
}

const defaultPurpose = (candidate: MaterialCandidate): MaterialPurpose => {
  if (candidate.reference.kind === 'knowledge-revision') return 'rule';
  if (candidate.reference.kind === 'artifact-version') return 'historical-comparison';
  return 'current-input';
};

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
  onRequestExpert,
  materials,
  materialCandidates,
  workspaceId,
  materialPickerKind,
  materialsLoading = false,
  materialPickerError,
  onRequestMaterials,
  onDismissMaterialPicker,
  onCommitMaterials,
  afterAddButton,
  onManageMaterials,
}: ComposerCapabilityPickerProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const skillPickerAnchorRef = useRef<HTMLElement | null>(null);
  const skillSearchInputRef = useRef<HTMLInputElement>(null);
  const [materialDraft, setMaterialDraft] = useState<TaskMaterialSelection[]>(materials);
  const [showGlobalArtifacts, setShowGlobalArtifacts] = useState(false);

  const selectedIds = useMemo(() => new Set(selected.map((chip) => chip.id)), [selected]);

  useEffect(() => {
    if (materialPickerKind) {
      setMaterialDraft(materials);
      setShowGlobalArtifacts(false);
    }
  }, [materialPickerKind, materials]);

  const filteredSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return skills;
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query),
    );
  }, [skills, searchQuery]);

  const handleTopLevelSelect = useCallback(
    (id: string) => {
      if (id === 'skills') {
        skillPickerAnchorRef.current = buttonRef.current;
        setMenuOpen(false);
        setSkillPickerOpen(true);
        setSearchQuery('');
      } else if (id === 'experts') {
        setMenuOpen(false);
        onRequestExpert();
      } else if (id === 'files' || id === 'knowledge' || id === 'artifact') {
        setMenuOpen(false);
        onRequestMaterials(id === 'files' ? 'file' : id);
      }
    },
    [onRequestExpert, onRequestMaterials],
  );

  const handleSkillSelect = useCallback(
    (skillId: string) => {
      if (selectedIds.has(skillId)) {
        onRemove(skillId);
        setSkillPickerOpen(false);
        setSearchQuery('');
        return;
      }
      const skill = skills.find((s) => s.id === skillId);
      if (!skill) return;
      const status = computeSkillStatus(skill);
      if (status !== 'ready') return;
      onAdd({
        kind: 'skill',
        id: skill.id,
        name: skill.name,
        revisionId: skill.currentRevisionId,
        status,
        source: 'task-selection',
      });
      setSkillPickerOpen(false);
      setSearchQuery('');
    },
    [skills, selectedIds, onAdd, onRemove],
  );

  const topLevelItems = [
    { id: 'experts', label: '专家', hint: '打开专家列表' },
    { id: 'skills', label: '技能', hint: '选择可用技能' },
    { id: 'files', label: '添加文件', hint: '从当前工作空间选择' },
    { id: 'knowledge', label: '引用知识', hint: '选择具体修订' },
    { id: 'artifact', label: '引用成果', hint: '选择具体版本' },
  ];

  const skillItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const skillIds = new Set(skills.map((skill) => skill.id));
    const unavailableSelections = selected
      .filter((chip) => !skillIds.has(chip.id))
      .filter((chip) => !query || chip.name.toLowerCase().includes(query))
      .map((chip) => ({
        id: chip.id,
        label: chip.name,
        hint: '已绑定技能不可用，点击移除',
      }));
    return [
      ...unavailableSelections,
      ...filteredSkills.map((skill) => {
        const status = computeSkillStatus(skill);
        const isSelected = selectedIds.has(skill.id);
        const isDisabled = status !== 'ready' && !isSelected;
        const hintText = isSelected
          ? [statusHint(skill), '已添加，点击移除'].filter(Boolean).join(' · ')
          : isDisabled
            ? statusHint(skill)
            : undefined;
        return {
          id: skill.id,
          label: skill.name,
          disabled: isDisabled,
          ...(hintText ? { hint: hintText } : {}),
        };
      }),
    ];
  }, [filteredSkills, searchQuery, selected, selectedIds, skills]);

  const visibleMaterialCandidates = useMemo(
    () =>
      materialCandidates.filter((candidate) =>
        materialPickerKind === 'knowledge'
          ? candidate.reference.kind === 'knowledge-revision'
          : candidate.reference.kind === 'artifact-version' &&
            (showGlobalArtifacts || candidate.reference.originWorkspaceId === workspaceId),
      ),
    [materialCandidates, materialPickerKind, showGlobalArtifacts, workspaceId],
  );
  const hasGlobalArtifacts = materialCandidates.some(
    (candidate) =>
      candidate.reference.kind === 'artifact-version' &&
      candidate.reference.originWorkspaceId !== workspaceId,
  );
  const materialItems = useMemo(
    () =>
      visibleMaterialCandidates.map((candidate) => {
        const key = materialCandidateKey(candidate);
        const isSelected = materialDraft.some((selection) => taskMaterialKey(selection) === key);
        const hint = [candidate.sourceLabel, candidate.detail, isSelected ? '已选择' : '']
          .filter(Boolean)
          .join(' · ');
        return {
          id: key,
          label: candidate.title,
          disabled: candidate.status !== 'ready',
          ...(hint ? { hint } : {}),
        };
      }),
    [materialDraft, visibleMaterialCandidates],
  );
  const materialSummary = useMemo(() => {
    const counts = { files: 0, knowledge: 0, artifacts: 0 };
    for (const selection of materials) {
      if (selection.reference.kind === 'workspace-input-snapshot') counts.files += 1;
      if (selection.reference.kind === 'knowledge-revision') counts.knowledge += 1;
      if (selection.reference.kind === 'artifact-version') counts.artifacts += 1;
    }
    const categories = [
      counts.files > 0 ? `文件 ${counts.files}` : undefined,
      counts.knowledge > 0 ? `知识 ${counts.knowledge}` : undefined,
      counts.artifacts > 0 ? `成果 ${counts.artifacts}` : undefined,
    ].filter((category): category is string => category !== undefined);
    return [`本次材料 ${materials.length} 项`, ...categories].join(' · ');
  }, [materials]);
  const materialSummaryText =
    disabled && disabledReason ? `${materialSummary}（${disabledReason}）` : materialSummary;

  return (
    <>
      <IconButton
        size="md"
        buttonRef={buttonRef}
        className="capability-picker-trigger"
        label="添加能力"
        icon={PlusIcon}
        hasPopup="menu"
        expanded={menuOpen}
        onClick={() => setMenuOpen((prev) => !prev)}
        disabled={disabled}
      />
      {afterAddButton}
      {selected.length > 0 && (
        <Button
          variant="chip"
          size="sm"
          type="button"
          aria-haspopup="menu"
          aria-expanded={skillPickerOpen}
          disabled={disabled}
          onClick={(event) => {
            skillPickerAnchorRef.current = event.currentTarget;
            setSkillPickerOpen(true);
            setSearchQuery('');
          }}
        >
          <CapabilityIcon size={12} />
          技能 {selected.length} 项
        </Button>
      )}
      <div className="composer-material-summary">
        <span className="composer-material-summary-text">{materialSummaryText}</span>
        {onManageMaterials && materials.length > 0 ? (
          <Button variant="link" size="sm" type="button" onClick={onManageMaterials}>
            查看 / 管理
          </Button>
        ) : undefined}
      </div>
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
        anchorRef={skillPickerAnchorRef}
        items={skillItems}
        label="选择技能"
        onDismiss={() => {
          setSkillPickerOpen(false);
          setSearchQuery('');
        }}
        onSelect={handleSkillSelect}
        header={
          <TextField
            size="sm"
            className="capability-search"
            ref={skillSearchInputRef}
            placeholder="搜索技能…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label="搜索技能"
          />
        }
        footer={
          filteredSkills.some((skill) => {
            const status = computeSkillStatus(skill);
            return status !== 'ready' && skill.blockedReasons.length > 0;
          }) ? (
            <Button
              variant="link"
              size="md"
              type="button"
              onClick={() => {
                const firstBlocked = filteredSkills.find((skill) => {
                  const status = computeSkillStatus(skill);
                  return status !== 'ready' && skill.blockedReasons.length > 0;
                });
                if (firstBlocked) onRequestSkillDetail(firstBlocked.id);
              }}
            >
              查看不可用原因
            </Button>
          ) : undefined
        }
      />
      <PopoverMenu
        open={Boolean(materialPickerKind)}
        anchorRef={buttonRef}
        items={materialItems}
        label={materialPickerKind === 'knowledge' ? '引用知识' : '引用成果'}
        onDismiss={onDismissMaterialPicker}
        onSelect={(id) => {
          const candidate = visibleMaterialCandidates.find(
            (item) => materialCandidateKey(item) === id,
          );
          if (!candidate || candidate.status !== 'ready') return;
          setMaterialDraft((current) => {
            const existing = current.findIndex((selection) => taskMaterialKey(selection) === id);
            if (existing >= 0) return current.filter((_, index) => index !== existing);
            const addedFrom =
              candidate.reference.kind === 'artifact-version' &&
              candidate.reference.originWorkspaceId !== workspaceId
                ? 'global-search'
                : 'workspace-candidate';
            return [
              ...current,
              { reference: candidate.reference, purpose: defaultPurpose(candidate), addedFrom },
            ];
          });
        }}
        header={
          materialsLoading ||
          materialPickerError ||
          (materialPickerKind === 'artifact' && hasGlobalArtifacts) ? (
            <div className="material-picker-status">
              {materialsLoading ? <InlineLoading label="正在加载候选材料…" /> : materialPickerError}
              {materialPickerKind === 'artifact' && hasGlobalArtifacts && !materialsLoading && (
                <Button
                  variant="link"
                  size="md"
                  type="button"
                  onClick={() => setShowGlobalArtifacts((current) => !current)}
                >
                  {showGlobalArtifacts ? '仅显示当前工作空间' : '显示其他工作空间成果'}
                </Button>
              )}
            </div>
          ) : undefined
        }
        footer={
          <ActionBar as="div" label="添加材料">
            <Button variant="text" size="md" type="button" onClick={onDismissMaterialPicker}>
              取消
            </Button>
            <Button
              variant="primary"
              size="md"
              type="button"
              onClick={() => {
                onCommitMaterials(materialDraft);
                onDismissMaterialPicker();
              }}
            >
              添加已选材料
            </Button>
          </ActionBar>
        }
      />
    </>
  );
}
