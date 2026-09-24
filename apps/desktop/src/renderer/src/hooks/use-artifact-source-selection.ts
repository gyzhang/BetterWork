import type {
  ArtifactInputRelationInput,
  ArtifactInputRelationKind,
  ArtifactVersionDetail,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * 候选采用来源（知识契约 §6.2）：只有带精确知识定位的运行访问记录可以作为采用依据。
 * 整份材料不在这里出现——Renderer 没有材料读取足迹，材料级采用只能由模型在同 Run 上下文里声明。
 */
export interface SourceCandidate {
  evidenceId: string;
  title: string;
  operationLabel: string;
}

export interface ArtifactSourceSelection {
  candidates: SourceCandidate[];
  hasCandidates: boolean;
  isSelected: (evidenceId: string) => boolean;
  relationFor: (evidenceId: string) => ArtifactInputRelationKind;
  toggle: (evidenceId: string) => void;
  setRelation: (evidenceId: string, relation: ArtifactInputRelationKind) => void;
  inheritPrevious: () => void;
  touched: boolean;
  /** undefined = 未主动重选，保存时沿用前版声明；数组（含空）= 用户本次的明确声明。 */
  buildInputRelations: () => ArtifactInputRelationInput[] | undefined;
}

const OPERATION_LABEL: Record<'search' | 'read', string> = {
  search: '摘要依据',
  read: '正文依据',
};

const inheritedRelations = (
  version: ArtifactVersionDetail | undefined,
): Record<string, ArtifactInputRelationKind> => {
  const initial: Record<string, ArtifactInputRelationKind> = {};
  for (const relation of version?.inputRelations ?? []) {
    if (relation.input.kind === 'evidence') {
      initial[relation.input.evidenceId] = relation.relation;
    }
  }
  return initial;
};

/**
 * 人工修订保存时的来源选择状态。
 *
 * 声明种类由宿主判定，这里只表达「用户这次到底选了哪些已核验的精确来源」：
 * 勾选集合与「是否改动过」分开记录，未改动就整字段省略，交给主版本继承矩阵。
 */
export function useArtifactSourceSelection(
  version: ArtifactVersionDetail | undefined,
): ArtifactSourceSelection {
  const [relations, setRelations] = useState<Record<string, ArtifactInputRelationKind>>({});
  const [touched, setTouched] = useState(false);

  const candidates = useMemo(
    () =>
      (version?.evidence ?? [])
        .filter((item) => item.knowledgeSource)
        .map((item) => ({
          evidenceId: item.id,
          title: item.title || item.locator,
          operationLabel: OPERATION_LABEL[item.knowledgeSource?.operation ?? 'read'],
        })),
    [version],
  );

  useEffect(() => {
    setRelations(inheritedRelations(version));
    setTouched(false);
  }, [version]);

  const isSelected = useCallback(
    (evidenceId: string) => relations[evidenceId] !== undefined,
    [relations],
  );

  const relationFor = useCallback(
    (evidenceId: string): ArtifactInputRelationKind => relations[evidenceId] ?? 'data',
    [relations],
  );

  const toggle = useCallback((evidenceId: string) => {
    setTouched(true);
    setRelations((current) => {
      const next: Record<string, ArtifactInputRelationKind> = { ...current };
      if (next[evidenceId]) delete next[evidenceId];
      else next[evidenceId] = 'data';
      return next;
    });
  }, []);

  const setRelation = useCallback((evidenceId: string, relation: ArtifactInputRelationKind) => {
    setTouched(true);
    setRelations((current) => ({ ...current, [evidenceId]: relation }));
  }, []);

  const inheritPrevious = useCallback(() => {
    setTouched(false);
    setRelations(inheritedRelations(version));
  }, [version]);

  const buildInputRelations = useCallback((): ArtifactInputRelationInput[] | undefined => {
    if (!touched) return undefined;
    return candidates
      .filter((candidate) => relations[candidate.evidenceId])
      .map((candidate) => ({
        input: { kind: 'evidence' as const, evidenceId: candidate.evidenceId },
        relation: relations[candidate.evidenceId] ?? 'data',
      }));
  }, [candidates, relations, touched]);

  return {
    candidates,
    hasCandidates: candidates.length > 0,
    isSelected,
    relationFor,
    toggle,
    setRelation,
    inheritPrevious,
    touched,
    buildInputRelations,
  };
}
