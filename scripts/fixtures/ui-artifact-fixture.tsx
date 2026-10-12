import type {
  ArtifactDetail,
  ArtifactVersionDetail,
  ArtifactVersionSummary,
} from '@betterwork/agent-protocol';
import { useState } from 'react';

import { ArtifactPage } from '../../apps/desktop/src/renderer/src/views/ArtifactView';
import { governanceApi } from './ui-governance-fixture';
import { longPath, longTitle } from './ui-page-fixture-data';

const current: Extract<ArtifactDetail, { type: 'markdown' }> = {
  id: 'artifact-fixture',
  workspaceId: 'workspace-fixture',
  taskId: 'task-fixture',
  type: 'markdown',
  title: longTitle,
  currentVersionId: 'version-2',
  versionNumber: 2,
  origin: 'assistant-run',
  sourceRunId: 'run-fixture',
  createdAt: 1,
  updatedAt: 2,
  content: '# 当前版本\n\n这份成果保留来源、版本与可继续编辑的正文。\n\n' + longPath,
  contentHash: 'b'.repeat(64),
  evidence: [],
};

const history: ArtifactVersionDetail = {
  id: 'version-1',
  artifactId: current.id,
  versionNumber: 1,
  origin: 'assistant-run',
  createdAt: 1,
  type: 'markdown',
  content: '# 历史版本\n\n旧版结论仍可回溯。',
  contentHash: 'a'.repeat(64),
  evidence: [],
};

const currentVersion: ArtifactVersionDetail = {
  id: current.currentVersionId,
  artifactId: current.id,
  versionNumber: current.versionNumber,
  origin: current.origin,
  ...(current.sourceRunId ? { sourceRunId: current.sourceRunId } : {}),
  createdAt: current.updatedAt,
  type: 'markdown',
  content: current.content,
  contentHash: current.contentHash,
  evidence: current.evidence,
};

const versions: ArtifactVersionSummary[] = [
  {
    id: 'version-2',
    artifactId: current.id,
    versionNumber: 2,
    origin: 'assistant-run',
    type: 'markdown',
    createdAt: 2,
  },
  {
    id: 'version-1',
    artifactId: current.id,
    versionNumber: 1,
    origin: 'assistant-run',
    type: 'markdown',
    createdAt: 1,
  },
];

let failVersion = true;

let failSave = true;

const artifactApi: Pick<Window['betterwork']['artifacts'], 'listVersions' | 'getVersion'> = {
  listVersions: async () => versions,
  getVersion: async ({ id }) => {
    if (id === currentVersion.id) return currentVersion;
    if (id !== history.id) throw new Error('本场景未覆盖该历史版本');
    if (failVersion) {
      failVersion = false;
      throw new Error('合成故障：历史版本暂不可读');
    }
    return history;
  },
};

Object.defineProperty(window, 'betterwork', {
  configurable: true,
  value: { artifacts: artifactApi, ...governanceApi },
});

export function ArtifactScenario(): React.JSX.Element {
  const [artifact, setArtifact] = useState(current);
  const [selected, setSelected] = useState<ArtifactDetail>();
  return (
    <ArtifactPage
      artifacts={[artifact]}
      selected={selected}
      onSelect={() => setSelected(artifact)}
      onBack={() => setSelected(undefined)}
      onSave={async (_artifact, title, content) => {
        if (failSave) {
          failSave = false;
          throw new Error('合成故障：保存失败，草稿保留');
        }
        const saved: Extract<ArtifactDetail, { type: 'markdown' }> = {
          ...artifact,
          title,
          content,
          currentVersionId: 'version-3',
          versionNumber: 3,
          origin: 'user-edit',
          contentHash: 'c'.repeat(64),
          updatedAt: 3,
        };
        versions.unshift({
          id: 'version-3',
          artifactId: artifact.id,
          type: 'markdown',
          versionNumber: 3,
          origin: 'user-edit',
          createdAt: 3,
        });
        setArtifact(saved);
        setSelected(saved);
      }}
      onExport={async () => {
        throw new Error('本场景不执行导出');
      }}
      onOpenFile={async () => {
        throw new Error('本场景不打开系统文件');
      }}
      onOpenSource={async () => {
        throw new Error('本场景不打开原始资料');
      }}
      onStartFromVersion={async () => {
        throw new Error('本场景不执行模型任务');
      }}
    />
  );
}

export const artifactSteps = [
  'list',
  'open',
  'version-failed',
  'version-recovered',
  'artifact-keyboard',
  'edit-failed',
  'save-recovered',
  'back',
];
