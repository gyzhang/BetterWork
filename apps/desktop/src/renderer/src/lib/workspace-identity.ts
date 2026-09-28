import type { WorkspaceAccentId } from '@betterwork/agent-protocol';

/**
 * 取一档工作空间身份色。
 *
 * 色值只住在 `styles.css` 的明暗两套 Variant 里（docs/10 §9.4），这里负责把档位 id
 * 换成对它的引用——侧栏的行与对话框里的色板因此画的是同一个颜色，而不是各抄一份十六进制。
 */
export const workspaceAccentVar = (accentId: WorkspaceAccentId): string => `var(--ws-${accentId})`;

/**
 * 从根目录取文件夹名，用于「名称留空则取文件夹名」的预览。
 *
 * 真正的兜底在主进程（它才有 `path`），这里只负责让对话框在用户还没提交时
 * 就先看到她将要得到的名字，两处共用同一条切分规则。
 */
export const folderNameOf = (rootPath: string): string =>
  rootPath
    .split('/')
    .filter((segment) => segment.length > 0)
    .at(-1) ?? rootPath;
