import type { RunSummary } from '@betterwork/agent-protocol';

import { formatTime } from '../lib/format';
import { runStatusName } from '../lib/labels';
import { ListRow } from './ListRow';

/**
 * 一次运行怎么报：状态、中间点、时间；没有运行就是「等待开始」。
 *
 * 这句措辞此前有四份（docs/reviews/2026-09-27-ui-reuse-audit.md §3.2）。两处已在
 * 上几档并进 `ListRow` 的槽位，剩下的侧栏「最近任务」与上下文面板「执行记录」
 * 一份把状态与时间并成一行、另一份拆成说明与 meta 两行——同一个运行在两个列表里
 * 报出的信息层次不同。行几何仍归 `ListRow`，**措辞与「没跑过时说什么」归这里**。
 */
const runSummaryLine = (run: RunSummary | undefined): string =>
  run ? `${runStatusName[run.status]} · ${formatTime(run.createdAt)}` : '等待开始';

export interface RunSummaryRowProps {
  /** 这次运行；`undefined` 表示任务还没有跑过。 */
  run: RunSummary | undefined;
  /** 行的标题：侧栏给任务名，执行记录给这条运行的原始提问。 */
  title: string;
  /** 点这一行是在做什么：「打开任务」「查看执行记录」。整行是按钮，名称必须自己说清楚。 */
  action: string;
  selected?: boolean | undefined;
  onSelect?: (() => void) | undefined;
}

/**
 * 运行摘要行（§10.2 `RunSummary`）：`ListRow` 的一种具名填法，与 `SourceRow` 同源。
 *
 * 可及名称把「动词＋标题＋状态·时间」拼全，而不是只报标题——状态与时间只有这一处
 * 呈现，报漏了读屏就听不到这次运行到底完成没有。
 */
export function RunSummaryRow({
  run,
  title,
  action,
  selected = false,
  onSelect,
}: RunSummaryRowProps): React.JSX.Element {
  return (
    <ListRow
      variant="plain"
      selected={selected}
      onClick={onSelect}
      label={`${action}「${title}」，${runSummaryLine(run)}`}
      title={title}
      meta={runSummaryLine(run)}
    />
  );
}
