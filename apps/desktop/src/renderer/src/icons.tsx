import type { WorkspaceIconId } from '@betterwork/agent-protocol';
import type { ComponentType, SVGProps } from 'react';

/**
 * 图标字形档位（docs/10 §9.13）：四档各有一个用途，没有第五档。
 * 省略 `size` 就是 `standalone`——缺省住在 `Icon` 里，页面不再各挑一个数。
 */
export const ICON_SIZES = {
  /** 与 12px 说明文字并排的行内小图标（通知行、chevron、chip 的关闭）。 */
  inline: 12,
  /** 按钮与下拉触发器里的图标，与 13px 控件文字同高。 */
  control: 13,
  /** 独立出现的图标（省略 `size` 时的缺省）。 */
  standalone: 16,
  /** 强调档：卡片身份块的标记。 */
  emphasis: 18,
  /** 导航行图标：侧栏一级导航与设置导航的图标，比 standalone 大一档以匹配 Codex 等参考产品的侧栏观感。 */
  nav: 20,
} as const;

export type IconSize = (typeof ICON_SIZES)[keyof typeof ICON_SIZES];

type IconProps = SVGProps<SVGSVGElement> & { size?: IconSize };

const Icon = ({
  size = ICON_SIZES.standalone,
  children,
  ...rest
}: IconProps): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    {children}
  </svg>
);

export const WorkIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M3.5 9.5h17" />
    <path d="M7 14h6" />
    <path d="M7 16.5h3.5" />
  </Icon>
);

export const ArtifactIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="M7.5 4h9L21 9l-9 11L3 9Z" />
    <path d="M3 9h18" />
    <path d="m9.5 9 2.5 11 2.5-11" />
    <path d="m7.5 4 2 5M16.5 4l-2 5" />
  </Icon>
);

export const KnowledgeIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="m12 3.5 9 4.5-9 4.5L3 8Z" />
    <path d="m4.5 12.2 7.5 3.8 7.5-3.8" />
    <path d="m4.5 16.2 7.5 3.8 7.5-3.8" />
  </Icon>
);

export const CapabilityIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="M8.5 4.5h7v15h-7z" />
    <path d="M5 8.5h3.5M15.5 8.5H19M5 15.5h3.5M15.5 15.5H19" />
    <circle cx="12" cy="8.5" r="1.2" />
    <circle cx="12" cy="15.5" r="1.2" />
  </Icon>
);

export const ExpertIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <circle cx="12" cy="8" r="3.2" />
    <path d="M5.5 19.5c.8-3.2 3.1-5 6.5-5s5.7 1.8 6.5 5" />
    <path d="M4 5.5h2M18 5.5h2M12 2.5v2" />
  </Icon>
);

export const ScheduleIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <rect x="4" y="5.5" width="16" height="15" rx="2.5" />
    <path d="M8 3.5v4M16 3.5v4M4 9.5h16M12 12.5v3l2 1" />
    <circle cx="12" cy="15" r="4" />
  </Icon>
);

/** 召唤：四角星闪光，表示把一个专家请进来开始工作，与发送（ArrowUp）区分开。 */
export const SummonIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="M12 5.5Q12 12 18.5 12 12 12 12 18.5 12 12 5.5 12 12 12 12 5.5Z" />
    <path d="M18.8 5.2v2.4M17.6 6.4h2.4" />
  </Icon>
);

export const GlobeIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17" />
    <path d="M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5Z" />
  </Icon>
);

export const SettingsIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="M4 7h3.5M11.5 7H20" />
    <circle cx="9.5" cy="7" r="2" />
    <path d="M4 12h8.5M16.5 12H20" />
    <circle cx="14.5" cy="12" r="2" />
    <path d="M4 17h1.5M9.5 17H20" />
    <circle cx="7.5" cy="17" r="2" />
  </Icon>
);

export const PlusIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="M12 5.5v13M5.5 12h13" />
  </Icon>
);

export const ChevronLeftIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="m14.5 6-6 6 6 6" />
  </Icon>
);

export const ChevronRightIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="m9.5 6 6 6-6 6" />
  </Icon>
);

export const ArrowUpIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="M12 19V5" />
    <path d="m5.5 11.5 6.5-6.5 6.5 6.5" />
  </Icon>
);

export const CheckIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Icon>
);

export const AlertIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V13" />
    <path d="M12 16.2v.1" />
  </Icon>
);

export const CloseIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);

export const MoreHorizontalIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <circle cx="5.5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="18.5" cy="12" r="1" />
  </Icon>
);

export const BellIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="M18 16H6c1.2-1.1 1.8-2.6 1.8-4.8v-1.4c0-2.9 1.9-5 4.2-5s4.2 2.1 4.2 5v1.4c0 2.2.6 3.7 1.8 4.8Z" />
    <path d="M10.2 19a1.9 1.9 0 0 0 3.6 0" />
  </Icon>
);

export const InfoIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5" />
    <path d="M12 7.8v.1" />
  </Icon>
);

export const WarningIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="M12 4.2 21 19.5H3Z" />
    <path d="M12 10v4.2" />
    <path d="M12 16.8v.1" />
  </Icon>
);

export const FolderIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.5l2 2H18a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5Z" />
  </Icon>
);

/* ——— 工作空间图标集（docs/10 §9.12）：形状承载「这是哪类持续工作」，颜色承载身份。 ——— */

export const WorkspaceDocIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
    <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" />
  </Icon>
);

export const WorkspaceSheetIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <rect x="4" y="5" width="16" height="14" rx="2.5" />
    <path d="M4 10h16M4 14.5h16M10 10v9" />
  </Icon>
);

export const WorkspaceSlidesIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <rect x="3.5" y="4.5" width="17" height="11.5" rx="2.5" />
    <path d="M12 16v3.5M9 19.5h6" />
  </Icon>
);

export const WorkspaceChartIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="M4 19.5h16" />
    <path d="M7 16.5V11M11.5 16.5V6.5M16 16.5v-5" />
  </Icon>
);

export const WorkspaceClientIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <rect x="5.5" y="4.5" width="13" height="15" rx="2" />
    <path d="M9 8.5h2M13 8.5h2M9 12.5h2M13 12.5h2M10.5 19.5v-3h3v3" />
  </Icon>
);

export const WorkspaceResearchIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="m15 15 5 5" />
  </Icon>
);

export const WorkspaceWritingIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="M15.5 4.5 19.5 8.5 8.8 19.2H4.8v-4Z" />
    <path d="m13.4 6.6 4 4" />
  </Icon>
);

export const WorkspaceCodeIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="m9 8.5-4 3.5 4 3.5M15 8.5l4 3.5-4 3.5" />
  </Icon>
);

export const WorkspaceProjectIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="m12 3.6 8 4.2v8.4l-8 4.2-8-4.2V7.8Z" />
    <path d="m4 7.8 8 4.3 8-4.3M12 12.1v8.3" />
  </Icon>
);

export const WorkspaceCycleIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <rect x="4" y="5.5" width="16" height="14" rx="2.5" />
    <path d="M4 10.5h16M8.5 3.6v3.8M15.5 3.6v3.8" />
  </Icon>
);

export const WorkspaceLibraryIcon = (props: IconProps): React.JSX.Element => (
  <Icon {...props}>
    <path d="M12 6.5C10.5 5 8.5 4.5 5 4.5v14c3.5 0 5.5.5 7 2 1.5-1.5 3.5-2 7-2v-14c-3.5 0-5.5.5-7 2Z" />
    <path d="M12 6.5v14" />
  </Icon>
);

/**
 * 图标 id 由协议的 `workspaceIconIdSchema` 定义，这里用 `Record` 穷举：
 * 枚举加了一档而图标集没跟上时，编译直接失败，而不是侧栏画出一个空白。
 */
export const workspaceIcons: Record<WorkspaceIconId, ComponentType<{ size?: IconSize }>> = {
  folder: FolderIcon,
  doc: WorkspaceDocIcon,
  sheet: WorkspaceSheetIcon,
  slides: WorkspaceSlidesIcon,
  chart: WorkspaceChartIcon,
  client: WorkspaceClientIcon,
  research: WorkspaceResearchIcon,
  writing: WorkspaceWritingIcon,
  code: WorkspaceCodeIcon,
  project: WorkspaceProjectIcon,
  cycle: WorkspaceCycleIcon,
  library: WorkspaceLibraryIcon,
};
