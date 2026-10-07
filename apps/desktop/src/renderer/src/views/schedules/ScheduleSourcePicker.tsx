import {
  type KnowledgeCollection,
  type KnowledgeDocumentSummary,
  type MaterialPurpose,
  SCHEDULE_KNOWLEDGE_SOURCE_MAX,
  SCHEDULE_SOURCE_ITEM_MAX,
  SCHEDULE_WORKSPACE_TOTAL_FILE_BYTES_MAX,
  type ScheduleKnowledgeSource,
} from '@betterwork/agent-protocol';
import { useMemo, useState } from 'react';

import { ActionBar } from '../../components/ActionBar';
import { BindingChip, BindingChipBar } from '../../components/BindingChip';
import { Button } from '../../components/Button';
import { CheckList } from '../../components/CheckList';
import { FieldSelect } from '../../components/FieldSelect';
import { InlineError } from '../../components/InlineError';
import { Modal } from '../../components/Modal';
import { SectionHeader } from '../../components/SectionHeader';
import { StatusNote } from '../../components/StatusNote';
import { Tab, TabList, TabPanel, Tabs } from '../../components/Tabs';
import { TextField } from '../../components/TextField';
import { materialPurposeName } from '../../lib/labels';
import {
  dedupeScheduleKnowledgeSources,
  filterScheduleKnowledgeDocuments,
  formatScheduleSourceBytes,
  scheduleKnowledgeSourceKey,
  scheduleKnowledgeSourceLabel,
  scheduleKnowledgeSourceMissing,
  scheduleVaultBudgetEstimate,
  toggleScheduleKnowledgeSource,
} from '../../lib/schedule-sources';

type SourceKindTab = 'document' | 'collection' | 'vault';

const purposeOptions = (Object.entries(materialPurposeName) as [MaterialPurpose, string][]).map(
  ([id, label]) => ({ id, label }),
);

export function ScheduleSourcePicker({
  sources,
  documents,
  collections,
  loading,
  error,
  disabled,
  onRefresh,
  onChange,
}: {
  sources: readonly ScheduleKnowledgeSource[];
  documents: readonly KnowledgeDocumentSummary[];
  collections: readonly KnowledgeCollection[];
  loading: boolean;
  error: string;
  disabled?: boolean;
  onRefresh: () => void;
  onChange: (sources: ScheduleKnowledgeSource[]) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ScheduleKnowledgeSource[]>([]);
  const [activeTab, setActiveTab] = useState<SourceKindTab>('document');
  const [search, setSearch] = useState('');
  const configuredSources = dedupeScheduleKnowledgeSources(sources);
  const draftSources = dedupeScheduleKnowledgeSources(draft);
  const selectedKeys = useMemo(
    () => new Set(draftSources.map(scheduleKnowledgeSourceKey)),
    [draftSources],
  );
  const hasVault = draftSources.some((source) => source.kind === 'vault');
  const filteredDocuments = useMemo(
    () => filterScheduleKnowledgeDocuments(documents, search),
    [documents, search],
  );
  const budget = useMemo(() => scheduleVaultBudgetEstimate(documents), [documents]);
  const sourceTabs = [
    { id: 'document' as const, label: `文档（${documents.length}）` },
    { id: 'collection' as const, label: `集合（${collections.length}）` },
    { id: 'vault' as const, label: '整个资料库' },
  ];
  const selectedUnavailable =
    !loading &&
    !error &&
    draftSources.some((source) => scheduleKnowledgeSourceMissing(source, documents, collections));

  const openPicker = (): void => {
    setDraft(configuredSources.map((source) => ({ ...source })));
    setActiveTab('document');
    setSearch('');
    setOpen(true);
  };

  const toggleSource = (source: ScheduleKnowledgeSource, checked: boolean): void => {
    setDraft((current) => toggleScheduleKnowledgeSource(current, source, checked));
  };

  const updatePurpose = (sourceKey: string, purpose: MaterialPurpose): void => {
    setDraft((current) =>
      dedupeScheduleKnowledgeSources(current).map((source) =>
        scheduleKnowledgeSourceKey(source) === sourceKey ? { ...source, purpose } : source,
      ),
    );
  };

  const selectedLabel = (source: ScheduleKnowledgeSource): string => {
    const label = scheduleKnowledgeSourceLabel(source, documents, collections);
    return scheduleKnowledgeSourceMissing(source, documents, collections) && !loading && !error
      ? `${label}（不可用）`
      : label;
  };

  const selectedSummary =
    configuredSources.length === 0
      ? '没有附加知识范围；每期仍会读取当时的工作空间文件和专家固定参考。'
      : `已选 ${configuredSources.length} 项：${configuredSources.map(selectedLabel).join('、')}`;

  return (
    <div className="schedule-source-control">
      <StatusNote message={selectedSummary} />
      {!open &&
        configuredSources.some((source) =>
          scheduleKnowledgeSourceMissing(source, documents, collections),
        ) &&
        !loading &&
        !error && (
          <InlineError
            tone="warning"
            message="有已选知识来源已删除或没有可用修订；请调整范围，否则本期准备会阻塞。"
            actions={
              <Button
                variant="link"
                size="sm"
                type="button"
                onClick={openPicker}
                disabled={disabled}
              >
                调整范围
              </Button>
            }
          />
        )}
      {error && !open && <InlineError tone="warning" message={error} onRetry={onRefresh} />}
      <Button variant="secondary" size="md" type="button" onClick={openPicker} disabled={disabled}>
        选择知识范围
      </Button>

      {open && (
        <Modal
          variant="sheet"
          label="选择定时任务知识范围"
          onClose={() => setOpen(false)}
          className="schedule-source-sheet"
        >
          <SectionHeader
            variant="block"
            title="附加知识范围"
            hint="这里保存范围描述；每期执行前读取当时的修订或集合成员并固定成该期快照，之后的变化用于下一期。"
          />
          <Tabs value={activeTab} onChange={setActiveTab}>
            <TabList size="md" fill label="知识范围类型">
              {sourceTabs.map((sourceTab) => (
                <Tab key={sourceTab.id} value={sourceTab.id}>
                  {sourceTab.label}
                </Tab>
              ))}
            </TabList>
            {sourceTabs.map((sourceTab) => (
              <TabPanel
                key={sourceTab.id}
                value={sourceTab.id}
                className="schedule-source-candidates"
              >
                {sourceTab.id === activeTab &&
                  (loading ? (
                    <StatusNote message="正在读取文档与集合候选…" />
                  ) : error ? (
                    <InlineError tone="warning" message={error} onRetry={onRefresh} />
                  ) : (
                    <>
                      {activeTab === 'document' && (
                        <>
                          <TextField
                            size="md"
                            aria-label="搜索文档"
                            placeholder="按文档名或路径搜索"
                            value={search}
                            onChange={(event) => setSearch(event.currentTarget.value)}
                          />
                          <CheckList
                            className="schedule-source-check-list"
                            label="可选知识文档"
                            options={filteredDocuments.map((document) => {
                              const source: ScheduleKnowledgeSource = {
                                kind: 'document',
                                documentId: document.id,
                                purpose: 'background',
                              };
                              const key = scheduleKnowledgeSourceKey(source);
                              const checked = selectedKeys.has(key);
                              const unavailable = !document.currentRevisionId;
                              const blockedByVault = hasVault && !checked;
                              const blockedByLimit =
                                draftSources.length >= SCHEDULE_KNOWLEDGE_SOURCE_MAX && !checked;
                              return {
                                id: document.id,
                                label: (
                                  <span className="schedule-source-document-option">
                                    <strong>{document.title || document.sourcePath}</strong>
                                    <span className="schedule-source-document-path">
                                      {document.sourcePath}
                                    </span>
                                  </span>
                                ),
                                checked,
                                disabled:
                                  (unavailable || blockedByVault || blockedByLimit) && !checked,
                                hint: unavailable
                                  ? `${document.sourcePath}（没有当前知识修订）`
                                  : document.sourcePath,
                              };
                            })}
                            onToggle={(documentId, checked) =>
                              toggleSource(
                                { kind: 'document', documentId, purpose: 'background' },
                                checked,
                              )
                            }
                            empty="没有匹配的文档；可修改关键词，或到知识页导入资料。"
                          />
                          {filteredDocuments.length === 0 && documents.length > 0 && (
                            <StatusNote message="搜索只过滤候选，不会缩小已确认的范围。" />
                          )}
                        </>
                      )}

                      {activeTab === 'collection' && (
                        <CheckList
                          className="schedule-source-check-list"
                          label="可选知识集合"
                          options={collections.map((collection) => {
                            const source: ScheduleKnowledgeSource = {
                              kind: 'collection',
                              collectionId: collection.id,
                              purpose: 'background',
                            };
                            const key = scheduleKnowledgeSourceKey(source);
                            const checked = selectedKeys.has(key);
                            const memberCount = documents.filter((document) =>
                              document.collectionIds.includes(collection.id),
                            ).length;
                            return {
                              id: collection.id,
                              label: `${collection.name} · ${memberCount} 项当前成员`,
                              checked,
                              disabled:
                                (hasVault ||
                                  draftSources.length >= SCHEDULE_KNOWLEDGE_SOURCE_MAX) &&
                                !checked,
                            };
                          })}
                          onToggle={(collectionId, checked) =>
                            toggleSource(
                              { kind: 'collection', collectionId, purpose: 'background' },
                              checked,
                            )
                          }
                          empty="还没有知识集合。可先在知识页整理集合，空集合也可以保留为有效范围。"
                        />
                      )}

                      {activeTab === 'vault' && (
                        <>
                          <CheckList
                            className="schedule-source-check-list"
                            label="整个资料库候选"
                            options={[
                              {
                                id: 'default',
                                label: `默认资料库 · 当前登记 ${budget.itemCount} 项，约 ${formatScheduleSourceBytes(budget.byteSize)}`,
                                checked: hasVault,
                                disabled:
                                  (!hasVault && draftSources.length > 0) ||
                                  (!hasVault &&
                                    draftSources.length >= SCHEDULE_KNOWLEDGE_SOURCE_MAX),
                                hint: '此范围会包含每期执行时默认资料库中的全部有效文档和修订。',
                              },
                            ]}
                            onToggle={(vaultId, checked) =>
                              toggleSource(
                                { kind: 'vault', vaultId: 'default', purpose: 'background' },
                                checked,
                              )
                            }
                          />
                          <StatusNote message="整库范围会跟随下一期执行时的资料库内容；本期快照固定后不受后续变化影响。" />
                          {(budget.overItemBudget || budget.overByteBudget) && (
                            <InlineError
                              tone="warning"
                              message="当前整库范围估算已超过单期来源预算；请改选具体文档或集合以缩小范围。"
                              problems={[
                                `${budget.itemCount.toLocaleString('zh-CN')} 项登记资料，单期材料清单上限为 ${SCHEDULE_SOURCE_ITEM_MAX.toLocaleString('zh-CN')} 项。`,
                                `${formatScheduleSourceBytes(budget.byteSize)} 登记大小；单期总材料预算为 ${formatScheduleSourceBytes(SCHEDULE_WORKSPACE_TOTAL_FILE_BYTES_MAX)}，还需计入工作空间与专家参考。`,
                                '此处为界面估算，Main 会在每期读取并重新校验实际清单。',
                              ]}
                            />
                          )}
                        </>
                      )}
                    </>
                  ))}
              </TabPanel>
            ))}
          </Tabs>

          {loading && (
            <Button variant="link" size="sm" type="button" onClick={onRefresh}>
              重新读取
            </Button>
          )}
          <BindingChipBar label="本次暂存的知识范围" className="schedule-source-staged">
            {draftSources.map((source) => {
              const key = scheduleKnowledgeSourceKey(source);
              const label = selectedLabel(source);
              const missing =
                !loading &&
                !error &&
                scheduleKnowledgeSourceMissing(source, documents, collections);
              return (
                <BindingChip
                  key={key}
                  name={label}
                  tone={missing ? 'danger' : 'default'}
                  disabled={disabled}
                  onRemove={() =>
                    setDraft((current) =>
                      current.filter((candidate) => scheduleKnowledgeSourceKey(candidate) !== key),
                    )
                  }
                  removeLabel={`移除范围 ${label}`}
                >
                  <FieldSelect
                    options={purposeOptions}
                    value={source.purpose}
                    onChange={(purpose) => updatePurpose(key, purpose as MaterialPurpose)}
                    ariaLabel={`资料用途：${label}`}
                    size="sm"
                    disabled={(disabled ?? false) || missing}
                  />
                </BindingChip>
              );
            })}
          </BindingChipBar>
          {selectedUnavailable && (
            <InlineError
              tone="warning"
              message="至少一个已暂存范围已删除或缺少当前修订，请移除后再确认。"
            />
          )}
          <ActionBar
            label="确认知识范围"
            hint={`${draftSources.length}/${SCHEDULE_KNOWLEDGE_SOURCE_MAX} 项；取消或按 Esc 不会修改规则草稿。`}
          >
            <Button variant="secondary" size="md" type="button" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="md"
              type="button"
              disabled={(disabled ?? false) || loading || Boolean(error) || selectedUnavailable}
              onClick={() => {
                onChange(draftSources);
                setOpen(false);
              }}
            >
              确认选择
            </Button>
          </ActionBar>
        </Modal>
      )}
    </div>
  );
}
