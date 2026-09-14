import type {
  MaterialCandidate,
  MaterialPurpose,
  SkillSummary,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CapabilityIcon, CloseIcon, PlusIcon } from '../icons';
import { PopoverMenu } from './PopoverMenu';

/**
 * Composer 能力选择器（ADR-0012 §UI / B00-4）。
 *
 * 一级菜单：技能 / 专家 / 添加文件 / 引用知识 / 引用成果。
 * 二级：技能列表，带搜索、多选、blockedReasons 置灰与定位入口。
 * 已选能力以 chip 条形式显示于输入框上方。
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
}

const PURPOSE_LABELS: Record<MaterialPurpose, string> = {
  rule: '规则口径',
  'current-input': '本期输入',
  'historical-comparison': '历史对比',
  'structure-reference': '结构参考',
  template: '模板',
  background: '背景参考',
};

const materialKey = (selection: TaskMaterialSelection): string => {
  const reference = selection.reference;
  if (reference.kind === 'knowledge-revision') return `knowledge:${reference.knowledgeRevisionId}`;
  if (reference.kind === 'artifact-version') return `artifact:${reference.artifactVersionId}`;
  return `snapshot:${reference.snapshotId}`;
};

const candidateKey = (candidate: MaterialCandidate): string => {
  const reference = candidate.reference;
  if (reference.kind === 'knowledge-revision') return `knowledge:${reference.knowledgeRevisionId}`;
  if (reference.kind === 'artifact-version') return `artifact:${reference.artifactVersionId}`;
  return `snapshot:${reference.snapshotId}`;
};

const defaultPurpose = (candidate: MaterialCandidate): MaterialPurpose => {
  if (candidate.reference.kind === 'knowledge-revision') return 'rule';
  if (candidate.reference.kind === 'artifact-version') return 'historical-comparison';
  return 'current-input';
};

const materialTitle = (
  selection: TaskMaterialSelection,
  candidates: MaterialCandidate[],
): string => {
  const candidate = candidates.find((item) => candidateKey(item) === materialKey(selection));
  if (candidate) return candidate.title;
  if (selection.reference.kind === 'knowledge-revision') return '知识修订';
  if (selection.reference.kind === 'artifact-version') return '成果版本';
  return '工作区文件';
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
}: ComposerCapabilityPickerProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const skillButtonRef = useRef<HTMLButtonElement>(null);
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
      const skill = skills.find((s) => s.id === skillId);
      if (!skill || selectedIds.has(skillId)) return;
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
    [skills, selectedIds, onAdd],
  );

  const topLevelItems = [
    { id: 'skills', label: '技能' },
    { id: 'experts', label: '专家', hint: '打开专家列表' },
    { id: 'files', label: '添加文件', hint: '从当前工作空间选择' },
    { id: 'knowledge', label: '引用知识', hint: '选择具体修订' },
    { id: 'artifact', label: '引用成果', hint: '选择具体版本' },
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
        const key = candidateKey(candidate);
        const isSelected = materialDraft.some((selection) => materialKey(selection) === key);
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
      {materials.length > 0 && (
        <div className="material-chip-bar" role="list" aria-label="本次材料">
          {materials.map((selection) => {
            const title = materialTitle(selection, materialCandidates);
            const candidate = materialCandidates.find(
              (item) => candidateKey(item) === materialKey(selection),
            );
            return (
              <div
                key={materialKey(selection)}
                className={`material-chip${candidate?.status === 'unavailable' ? ' unavailable' : ''}`}
                role="listitem"
              >
                <span className="material-chip-title" title={title}>
                  {title}
                </span>
                <select
                  aria-label={`${title}用途`}
                  value={selection.purpose}
                  disabled={disabled}
                  onChange={(event) => {
                    const purpose = event.target.value as MaterialPurpose;
                    onCommitMaterials(
                      materials.map((item) =>
                        materialKey(item) === materialKey(selection) ? { ...item, purpose } : item,
                      ),
                    );
                  }}
                >
                  {Object.entries(PURPOSE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="capability-chip-remove"
                  aria-label={`移除材料 ${title}`}
                  onClick={() =>
                    onCommitMaterials(
                      materials.filter((item) => materialKey(item) !== materialKey(selection)),
                    )
                  }
                  disabled={disabled}
                >
                  <CloseIcon size={10} />
                </button>
              </div>
            );
          })}
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
      <PopoverMenu
        open={Boolean(materialPickerKind)}
        anchorRef={buttonRef}
        items={materialItems}
        label={materialPickerKind === 'knowledge' ? '引用知识' : '引用成果'}
        onDismiss={onDismissMaterialPicker}
        onSelect={(id) => {
          const candidate = visibleMaterialCandidates.find((item) => candidateKey(item) === id);
          if (!candidate || candidate.status !== 'ready') return;
          setMaterialDraft((current) => {
            const existing = current.findIndex((selection) => materialKey(selection) === id);
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
              {materialsLoading ? '正在加载候选材料…' : materialPickerError}
              {materialPickerKind === 'artifact' && hasGlobalArtifacts && !materialsLoading && (
                <button
                  type="button"
                  className="material-global-toggle"
                  onClick={() => setShowGlobalArtifacts((current) => !current)}
                >
                  {showGlobalArtifacts ? '仅显示当前工作空间' : '显示其他工作空间成果'}
                </button>
              )}
            </div>
          ) : undefined
        }
        footer={
          <div className="material-picker-actions">
            <button type="button" className="text-button" onClick={onDismissMaterialPicker}>
              取消
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                onCommitMaterials(materialDraft);
                onDismissMaterialPicker();
              }}
            >
              添加已选材料
            </button>
          </div>
        }
      />
      {disabled && disabledReason ? (
        <span className="capability-picker-reason">{disabledReason}</span>
      ) : undefined}
    </>
  );
}
