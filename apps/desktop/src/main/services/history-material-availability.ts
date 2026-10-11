import type { MaterialReference } from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';

/** 完整实体解码仅按精确 ID 去重；可用性仍逐引用判定，不授予读取权限。 */
export const historyMaterialAvailability = (
  store: AppStore,
  references: readonly MaterialReference[],
): boolean[] => {
  const versionIds = new Set<string>();
  const snapshotIds = new Set<string>();
  for (const reference of references) {
    if (reference.kind === 'artifact-version') versionIds.add(reference.artifactVersionId);
    if (reference.kind === 'workspace-input-snapshot') snapshotIds.add(reference.snapshotId);
  }
  const availableVersions = new Set(
    store.artifacts.listVersionDetails([...versionIds]).map((version) => version.id),
  );
  const availableSnapshots = new Set(
    store.inputSnapshots.listByIds([...snapshotIds]).map((snapshot) => snapshot.id),
  );
  return references.map((reference) => {
    switch (reference.kind) {
      case 'knowledge-revision':
        return reference.sourcePath.trim().length > 0;
      case 'artifact-version':
        return availableVersions.has(reference.artifactVersionId);
      case 'workspace-input-snapshot':
        return availableSnapshots.has(reference.snapshotId);
    }
  });
};
