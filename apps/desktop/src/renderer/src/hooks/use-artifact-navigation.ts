import type { ArtifactDetail, ArtifactVersionDetail } from '@betterwork/agent-protocol';
import { useCallback, useRef, useState } from 'react';

export interface ArtifactNavigationMessages {
  missingArtifact?: string;
  missingVersion?: string;
  missingVersionArtifact?: string;
}

export interface ArtifactNavigation {
  selectedArtifact: ArtifactDetail | undefined;
  initialVersion: ArtifactVersionDetail | undefined;
  openArtifact: (
    artifactId: string,
    messages?: Pick<ArtifactNavigationMessages, 'missingArtifact'>,
  ) => Promise<boolean>;
  openVersion: (versionId: string, messages?: ArtifactNavigationMessages) => Promise<boolean>;
  selectLoaded: (artifact: ArtifactDetail, version?: ArtifactVersionDetail) => void;
  clear: () => void;
  invalidate: () => void;
}

export function useArtifactNavigation(): ArtifactNavigation {
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactDetail>();
  const [initialVersion, setInitialVersion] = useState<ArtifactVersionDetail>();
  const requestGeneration = useRef(0);

  const invalidate = useCallback((): void => {
    requestGeneration.current += 1;
  }, []);

  const selectLoaded = useCallback(
    (artifact: ArtifactDetail, version?: ArtifactVersionDetail): void => {
      invalidate();
      setSelectedArtifact(artifact);
      setInitialVersion(version);
    },
    [invalidate],
  );

  const clear = useCallback((): void => {
    invalidate();
    setSelectedArtifact(undefined);
    setInitialVersion(undefined);
  }, [invalidate]);

  const openArtifact = useCallback(
    async (
      artifactId: string,
      messages: Pick<ArtifactNavigationMessages, 'missingArtifact'> = {},
    ): Promise<boolean> => {
      const requestId = requestGeneration.current + 1;
      requestGeneration.current = requestId;
      try {
        const detail = await window.betterwork.artifacts.get({ id: artifactId });
        if (requestGeneration.current !== requestId) return false;
        if (!detail) throw new Error(messages.missingArtifact ?? '成果已不存在，可能已被移除。');
        setSelectedArtifact(detail);
        setInitialVersion(undefined);
        return true;
      } catch (error) {
        if (requestGeneration.current !== requestId) return false;
        throw error;
      }
    },
    [],
  );

  const openVersion = useCallback(
    async (versionId: string, messages: ArtifactNavigationMessages = {}): Promise<boolean> => {
      const requestId = requestGeneration.current + 1;
      requestGeneration.current = requestId;
      try {
        const version = await window.betterwork.artifacts.getVersion({ id: versionId });
        if (requestGeneration.current !== requestId) return false;
        if (!version) throw new Error(messages.missingVersion ?? '该成果版本已不存在，无法打开。');
        const detail = await window.betterwork.artifacts.get({ id: version.artifactId });
        if (requestGeneration.current !== requestId) return false;
        if (!detail)
          throw new Error(messages.missingVersionArtifact ?? '该版本所属成果已不存在，无法打开。');
        setSelectedArtifact(detail);
        setInitialVersion(version);
        return true;
      } catch (error) {
        if (requestGeneration.current !== requestId) return false;
        throw error;
      }
    },
    [],
  );

  return {
    selectedArtifact,
    initialVersion,
    openArtifact,
    openVersion,
    selectLoaded,
    clear,
    invalidate,
  };
}
