export function BrandLogo({ size = 26 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <mask id="bw-logo-gong">
        <rect x="2" y="2" width="20" height="20" rx="7" fill="#fff" />
        <rect x="6.4" y="6.6" width="11.2" height="2.6" rx="1.3" fill="#000" />
        <rect x="10.7" y="6.6" width="2.6" height="10.8" rx="1.3" fill="#000" />
        <rect x="6.4" y="14.8" width="11.2" height="2.6" rx="1.3" fill="#000" />
      </mask>
      <rect x="2" y="2" width="20" height="20" rx="7" fill="currentColor" mask="url(#bw-logo-gong)" />
    </svg>
  );
}
