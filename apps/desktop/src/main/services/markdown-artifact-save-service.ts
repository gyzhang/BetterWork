import type { ArtifactSummary, SaveMarkdownArtifactRequest } from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import { ArtifactDeclarationService } from './artifact-declaration-service';

export class MarkdownArtifactSaveService {
  private readonly declarations: ArtifactDeclarationService;

  constructor(private readonly store: AppStore) {
    this.declarations = new ArtifactDeclarationService(store);
  }

  save(input: SaveMarkdownArtifactRequest): ArtifactSummary {
    const previousVersionId = input.artifactId
      ? this.store.artifacts.getDetail(input.artifactId)?.currentVersionId
      : undefined;
    const plan = this.declarations.planForWrite(
      input.origin,
      input.runId,
      previousVersionId,
      input.inputRelations ?? null,
    );

    return this.store.transaction(() => {
      const saved = this.store.artifacts.saveMarkdown(input, plan.kind);
      if (plan.copyRelationsFromVersionId) {
        this.store.artifactInputRelations.inheritFromVersion(
          saved.currentVersionId,
          plan.copyRelationsFromVersionId,
          plan.kind,
        );
        return saved;
      }
      if (!plan.inputs || plan.inputs.length === 0) return saved;
      this.store.artifactInputRelations.saveForRun(
        saved.currentVersionId,
        plan.runId,
        plan.inputs,
        this.declarations.wasReadDuring,
        plan.kind === 'user' ? 'user' : 'model',
      );
      return saved;
    });
  }
}
