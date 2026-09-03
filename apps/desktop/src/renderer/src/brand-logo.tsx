export function BrandLogo({ size = 26 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <mask id="bw-logo-beads">
        <rect x="2" y="2" width="20" height="20" rx="7" fill="#fff" />
        <rect x="4.6" y="11.2" width="14.8" height="1.9" rx="0.95" fill="#000" />
        <circle cx="12" cy="8.3" r="2.4" fill="#000" />
        <circle cx="8" cy="15.75" r="2.4" fill="#000" />
        <circle cx="16" cy="15.75" r="2.4" fill="#000" />
      </mask>
      <rect x="2" y="2" width="20" height="20" rx="7" fill="currentColor" mask="url(#bw-logo-beads)" />
    </svg>
  );
}
