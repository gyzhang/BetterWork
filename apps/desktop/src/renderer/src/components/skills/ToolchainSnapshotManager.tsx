import type {
  DeleteToolchainSnapshotResult,
  ManagedDependencySnapshot,
} from '@betterwork/agent-protocol';
import { useState } from 'react';

import { trackAction } from '../../lib/async-action';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { ConfirmationDialog } from '../ConfirmationDialog';
import { EmptyNotice } from '../EmptyState';
import { InlineError } from '../InlineError';
import { ListRow } from '../ListRow';
import { Modal } from '../Modal';
import { SectionHeader } from '../SectionHeader';
import { StatusNote } from '../StatusNote';

type DeleteActionResult = DeleteToolchainSnapshotResult | { status: 'error'; message: string };

export interface ToolchainSnapshotManagerProps {
  snapshots: ManagedDependencySnapshot[];
  onDelete: (snapshotId: string) => Promise<DeleteActionResult>;
  onOpenSkill?: ((skillId: string) => void) | undefined;
  onClose: () => void;
}

const stateName: Record<ManagedDependencySnapshot['originState'], string> = {
  clean: '来源干净',
  dirty: '包含本地修改',
  unknown: '来源状态未知',
};

const formatBytes = (bytes: number): string => {
  const unit = bytes >= 1_073_741_824 ? 'GB' : 'MB';
  const divisor = unit === 'GB' ? 1_073_741_824 : 1_048_576;
  const value = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(
    bytes / divisor,
  );
  return `${value} ${unit}`;
};

const formatDate = (timestamp: number): string =>
  new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(timestamp),
  );

const usageTotals = (snapshot: ManagedDependencySnapshot) =>
  snapshot.usage.reduce(
    (totals, usage) => ({
      activeAuthorizations: totals.activeAuthorizations + usage.activeAuthorizationCount,
      revokedAuthorizations: totals.revokedAuthorizations + usage.revokedAuthorizationCount,
      runs: totals.runs + usage.runCount,
    }),
    { activeAuthorizations: 0, revokedAuthorizations: 0, runs: 0 },
  );

const deleteDetail = (snapshot: ManagedDependencySnapshot): string => {
  const revokedReferences = usageTotals(snapshot).revokedAuthorizations;
  const revokedDetail =
    revokedReferences > 0 ? `删除时会清理 ${revokedReferences} 条已撤销授权中的旧快照选择。` : '';
  return `将删除 BetterWork 保存的 ${snapshot.fileCount} 个文件（${formatBytes(snapshot.totalBytes)}）及其登记记录。源目录 ${snapshot.origin} 不会被修改。${revokedDetail}`;
};

export function ToolchainSnapshotManager({
  snapshots,
  onDelete,
  onOpenSkill,
  onClose,
}: ToolchainSnapshotManagerProps): React.JSX.Element {
  const [confirming, setConfirming] = useState<ManagedDependencySnapshot>();
  const [deletingId, setDeletingId] = useState<string>();
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  const confirmDelete = (): void => {
    const snapshot = confirming;
    if (!snapshot) return;
    setDeletingId(snapshot.id);
    setError('');
    setWarning('');
    trackAction(
      onDelete(snapshot.id)
        .then((result) => {
          setConfirming(undefined);
          if (result.status === 'error') {
            setError(result.message);
            return;
          }
          if (result.status === 'not-found') {
            setError('这条快照记录已不存在，请关闭后重新打开管理面板。');
            return;
          }
          if (result.status === 'in-use') {
            setError('快照在确认期间新增了使用引用，已取消删除；使用信息已刷新。');
            return;
          }
          if (result.cleanupPending) {
            setWarning('快照登记记录已删除，但受管文件未能完全清理。');
          }
        })
        .finally(() => setDeletingId(undefined)),
      '删除工具链快照',
    );
  };

  return (
    <>
      <Modal
        variant="sheet"
        className="toolchain-snapshot-manager"
        label="管理工具链快照"
        onClose={onClose}
      >
        <SectionHeader
          variant="block"
          eyebrow="运行环境资源"
          title="已登记工具链快照"
          hint={`共 ${snapshots.length} 条。删除只影响 BetterWork 的受管副本，不会修改来源目录。`}
          actions={
            <Button variant="secondary" size="lg" type="button" onClick={onClose}>
              关闭
            </Button>
          }
        />
        <div className="toolchain-snapshot-manager-list" aria-label="工具链快照列表">
          {snapshots.length === 0 ? (
            <EmptyNotice title="还没有登记工具链快照。" />
          ) : (
            snapshots.map((snapshot) => {
              const totals = usageTotals(snapshot);
              const blockedReasons = [
                ...(totals.activeAuthorizations > 0
                  ? [`当前依赖授权 ${totals.activeAuthorizations} 条`]
                  : []),
                ...(totals.runs > 0 ? [`历史 Run ${totals.runs} 次`] : []),
              ];
              return (
                <ListRow
                  key={snapshot.id}
                  as="article"
                  variant="card"
                  title={`${snapshot.manifestHash.slice(0, 12)} · ${snapshot.fileCount.toLocaleString('zh-CN')} 个文件`}
                  detail={snapshot.origin}
                  meta={`登记于 ${formatDate(snapshot.createdAt)} · ${formatBytes(snapshot.totalBytes)} · ${stateName[snapshot.originState]}${snapshot.originCommit ? ` · commit ${snapshot.originCommit.slice(0, 12)}` : ''}`}
                  multiline
                  actionsPlacement="below"
                  actions={
                    <Button
                      variant="danger"
                      size="md"
                      type="button"
                      disabled={!snapshot.canDelete || deletingId === snapshot.id}
                      onClick={() => {
                        setError('');
                        setConfirming(snapshot);
                      }}
                    >
                      删除快照
                    </Button>
                  }
                >
                  <section className="toolchain-snapshot-usage">
                    <strong>使用位置</strong>
                    {snapshot.usage.length === 0 ? (
                      <p>未被 Skill 授权或历史运行引用。</p>
                    ) : (
                      <ul>
                        {snapshot.usage.map((usage) => (
                          <ListRow
                            key={usage.skillId}
                            as="li"
                            variant="plain"
                            title={usage.skillName}
                            detail={`当前授权 ${usage.activeAuthorizationCount} · 已撤销 ${usage.revokedAuthorizationCount} · 历史 Run ${usage.runCount}`}
                            multiline
                            actions={
                              onOpenSkill ? (
                                <Button
                                  variant="link"
                                  size="md"
                                  type="button"
                                  onClick={() => {
                                    onClose();
                                    onOpenSkill(usage.skillId);
                                  }}
                                >
                                  打开 Skill
                                </Button>
                              ) : undefined
                            }
                          />
                        ))}
                      </ul>
                    )}
                  </section>
                  {snapshot.canDelete ? (
                    <StatusNote
                      tone={totals.revokedAuthorizations > 0 ? 'warning' : 'neutral'}
                      message={
                        totals.revokedAuthorizations > 0
                          ? '只有已撤销授权的历史选择引用；删除时会一并清理。'
                          : '没有当前授权或历史 Run 引用，可以删除。'
                      }
                    />
                  ) : (
                    <StatusNote
                      tone="warning"
                      message={`正在使用，暂不能删除：${blockedReasons.join('、')}。`}
                    />
                  )}
                </ListRow>
              );
            })
          )}
        </div>
        {error && <InlineError message={error} />}
        {warning && <InlineError tone="warning" message={warning} />}
        <div className="toolchain-snapshot-manager-footer">
          <Badge tone="outline">活跃授权与历史 Run 会阻止删除</Badge>
          <p>每条快照按文件内容指纹区分；来源路径相同也可能对应多份不同版本。</p>
        </div>
      </Modal>
      {confirming ? (
        <ConfirmationDialog
          title={`删除快照 ${confirming.manifestHash.slice(0, 12)}？`}
          detail={deleteDetail(confirming)}
          confirmLabel="删除快照"
          onConfirm={confirmDelete}
          onCancel={() => setConfirming(undefined)}
        />
      ) : undefined}
    </>
  );
}
