import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const Icon = ({ size = 16, children, ...rest }: IconProps): React.JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>{children}</svg>
);

export const WorkIcon = (props: IconProps): React.JSX.Element => <Icon {...props}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M3.5 9.5h17" /><path d="M7 14h6" /><path d="M7 16.5h3.5" /></Icon>;

export const ArtifactIcon = (props: IconProps): React.JSX.Element => <Icon {...props}><path d="M7.5 4h9L21 9l-9 11L3 9Z" /><path d="M3 9h18" /><path d="m9.5 9 2.5 11 2.5-11" /><path d="m7.5 4 2 5M16.5 4l-2 5" /></Icon>;

export const KnowledgeIcon = (props: IconProps): React.JSX.Element => <Icon {...props}><path d="m12 3.5 9 4.5-9 4.5L3 8Z" /><path d="m4.5 12.2 7.5 3.8 7.5-3.8" /><path d="m4.5 16.2 7.5 3.8 7.5-3.8" /></Icon>;

export const GlobeIcon = (props: IconProps): React.JSX.Element => <Icon {...props}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17" /><path d="M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5Z" /></Icon>;

export const SettingsIcon = (props: IconProps): React.JSX.Element => <Icon {...props}><path d="M4 7h3.5M11.5 7H20" /><circle cx="9.5" cy="7" r="2" /><path d="M4 12h8.5M16.5 12H20" /><circle cx="14.5" cy="12" r="2" /><path d="M4 17h1.5M9.5 17H20" /><circle cx="7.5" cy="17" r="2" /></Icon>;

export const PlusIcon = (props: IconProps): React.JSX.Element => <Icon {...props}><path d="M12 5.5v13M5.5 12h13" /></Icon>;

export const ChevronLeftIcon = (props: IconProps): React.JSX.Element => <Icon {...props}><path d="m14.5 6-6 6 6 6" /></Icon>;

export const ChevronRightIcon = (props: IconProps): React.JSX.Element => <Icon {...props}><path d="m9.5 6 6 6-6 6" /></Icon>;

export const ChevronDownIcon = (props: IconProps): React.JSX.Element => <Icon {...props}><path d="m6 9.5 6 6 6-6" /></Icon>;

export const ArrowUpIcon = (props: IconProps): React.JSX.Element => <Icon {...props}><path d="M12 19V5" /><path d="m5.5 11.5 6.5-6.5 6.5 6.5" /></Icon>;

export const CheckIcon = (props: IconProps): React.JSX.Element => <Icon {...props}><path d="m5 12.5 4.5 4.5L19 7" /></Icon>;

export const AlertIcon = (props: IconProps): React.JSX.Element => <Icon {...props}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V13" /><path d="M12 16.2v.1" /></Icon>;

export const CloseIcon = (props: IconProps): React.JSX.Element => <Icon {...props}><path d="m6 6 12 12M18 6 6 18" /></Icon>;

export const BellIcon = (props: IconProps): React.JSX.Element => <Icon {...props}><path d="M18 16H6c1.2-1.1 1.8-2.6 1.8-4.8v-1.4c0-2.9 1.9-5 4.2-5s4.2 2.1 4.2 5v1.4c0 2.2.6 3.7 1.8 4.8Z" /><path d="M10.2 19a1.9 1.9 0 0 0 3.6 0" /></Icon>;

export const InfoIcon = (props: IconProps): React.JSX.Element => <Icon {...props}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" /><path d="M12 7.8v.1" /></Icon>;

export const WarningIcon = (props: IconProps): React.JSX.Element => <Icon {...props}><path d="M12 4.2 21 19.5H3Z" /><path d="M12 10v4.2" /><path d="M12 16.8v.1" /></Icon>;

export const PanelLeftIcon = (props: IconProps): React.JSX.Element => <Icon {...props}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M9.5 4.5v15" /></Icon>;
