import type { ArtifactSummary } from '@betterwork/agent-protocol';
import { type ComponentProps, useCallback, useState } from 'react';

import { ArtifactIcon, ChevronRightIcon } from '../icons';
import { fileTypeLabel } from '../lib/labels';
import { handleTitlebarDoubleClick } from '../lib/titlebar';
import type { ContextTab } from '../lib/view-types';
import { MemoryContext, type MemoryContextProps } from './context/MemoryContext';
import { ProcessContext, type ProcessContextProps } from './context/ProcessContext';
import { SourcesContext, type SourcesContextProps } from './context/SourcesContext';
import { EmptyContext } from './EmptyState';
import { IconButton } from './IconButton';
import { ListRow } from './ListRow';
import { Tab, TabList, TabPanel, Tabs } from './Tabs';
import { type ToastTone, TransientToast } from './TransientToast';
import { WorkspaceBrief } from './WorkspaceBrief';

const CONTEXT_TABS: ReadonlyArray<readonly [ContextTab, string]> = [
  ['process', '过程'],
  ['sources', '资料'],
  ['memory', '记忆'],
  ['brief', '简报'],
  ['artifacts', '成果'],
];
const artifactTypeLabel = (artifact: ArtifactSummary): string =>
  artifact.type === 'presentation' && artifact.mimeType
    ? fileTypeLabel(artifact.mimeType)
    : 'Markdown';

export interface ContextPanelProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  tab: ContextTab;
  setTab: (tab: ContextTab) => void;
  process: Omit<ProcessContextProps, 'onError'>;
  sources: SourcesContextProps;
  memory: Omit<MemoryContextProps, 'onSelectMaterials' | 'onOpenArtifacts'>;
  brief: ComponentProps<typeof WorkspaceBrief>;
  artifacts: {
    items: ArtifactSummary[];
    onSelectArtifact?: (artifact: ArtifactSummary) => void;
  };
}

export function ContextPanel({
  open,
  setOpen,
  tab,
  setTab,
  process,
  sources,
  memory,
  brief,
  artifacts: { items: artifacts, onSelectArtifact },
}: ContextPanelProps): React.JSX.Element | null {
  const [sourceToast, setSourceToast] = useState<{ tone: ToastTone; message: string }>();
  const dismissSourceToast = useCallback(() => setSourceToast(undefined), []);
  if (!open) return null;
  return (
    <>
      <aside className="context-panel">
        <div className="context-topline" onDoubleClick={handleTitlebarDoubleClick}>
          <span>当前任务</span>
          <IconButton
            size="md"
            label="收起上下文面板"
            icon={ChevronRightIcon}
            onClick={() => setOpen(false)}
          />
        </div>
        <Tabs value={tab} onChange={setTab}>
          <TabList size="sm" fill label="任务上下文">
            {CONTEXT_TABS.map(([id, label]) => (
              <Tab key={id} value={id}>
                {label}
              </Tab>
            ))}
          </TabList>
          <TabPanel value="process" className="context-content">
            {tab === 'process' && (
              <ProcessContext
                {...process}
                onError={(tone, message) => setSourceToast({ tone, message })}
              />
            )}
          </TabPanel>
          <TabPanel value="sources" className="context-content">
            {tab === 'sources' && <SourcesContext {...sources} />}
          </TabPanel>
          <TabPanel value="memory" className="context-content">
            {tab === 'memory' && (
              <MemoryContext
                {...memory}
                onSelectMaterials={() => {
                  setTab('sources');
                  sources.onRequestMaterials('file');
                }}
                onOpenArtifacts={() => {
                  setTab('sources');
                  sources.onRequestMaterials('artifact');
                }}
              />
            )}
          </TabPanel>
          <TabPanel value="brief" className="context-content">
            {tab === 'brief' && <WorkspaceBrief {...brief} />}
          </TabPanel>
          <TabPanel value="artifacts" className="context-content">
            {tab === 'artifacts' &&
              (artifacts.length === 0 ? (
                <EmptyContext
                  placement="start"
                  title="尚无工作成果"
                  detail="将完成的回复保存为 Markdown 后，它会出现在这里。"
                />
              ) : (
                <section className="context-section">
                  <div className="evidence-list">
                    {artifacts.map((artifact) => (
                      <ListRow
                        key={artifact.id}
                        onClick={() => onSelectArtifact?.(artifact)}
                        label={`查看成果「${artifact.title}」`}
                        leading={
                          <span aria-hidden="true">
                            <ArtifactIcon size={12} />
                          </span>
                        }
                        title={artifact.title}
                        meta={
                          <>
                            {artifactTypeLabel(artifact)} · v{artifact.versionNumber}
                          </>
                        }
                        trailing={<ChevronRightIcon size={12} />}
                      />
                    ))}
                  </div>
                </section>
              ))}
          </TabPanel>
        </Tabs>
      </aside>
      {sourceToast && <TransientToast {...sourceToast} onDismiss={dismissSourceToast} />}
    </>
  );
}
