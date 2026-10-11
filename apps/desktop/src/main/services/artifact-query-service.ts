import type {
  ArtifactDetail,
  ArtifactVersionDetail,
  FileArtifactDetail,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';

export class ArtifactQueryService {
  constructor(private readonly store: AppStore) {}

  getArtifact(artifactId: string): ArtifactDetail | null {
    const detail = this.store.artifacts.getDetail(artifactId);
    if (!detail) return null;
    const inputRelations = this.store.artifactInputRelations.listByVersion(detail.currentVersionId);
    return inputRelations.length > 0 ? { ...detail, inputRelations } : detail;
  }

  getArtifactVersion(versionId: string): ArtifactVersionDetail | null {
    const detail = this.store.artifacts.getVersionDetail(versionId);
    if (!detail) return null;
    const inputRelations = this.store.artifactInputRelations.listByVersion(detail.id);
    return inputRelations.length > 0 ? { ...detail, inputRelations } : detail;
  }

  getFileArtifact(artifactId: string, versionId?: string): FileArtifactDetail | null {
    const detail = this.store.artifacts.getDetail(artifactId);
    if (!detail || detail.type !== 'presentation') return null;
    if (!versionId) return detail;
    if (!this.store.artifacts.versionBelongsToArtifact(versionId, artifactId)) return null;

    const version = this.store.artifacts.getVersionDetail(versionId);
    if (!version || version.type !== 'presentation') return null;
    const inputRelations = this.store.artifactInputRelations.listByVersion(version.id);
    return {
      ...detail,
      fileHash: version.fileHash,
      fileKey: version.fileKey,
      validation: version.validation,
      ...(version.description ? { description: version.description } : {}),
      evidence: version.evidence,
      ...(inputRelations.length > 0 ? { inputRelations } : {}),
    };
  }
}
