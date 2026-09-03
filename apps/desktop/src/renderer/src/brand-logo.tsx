export function BrandLogo({ size = 30 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="18" height="18" rx="5.5" stroke="currentColor" strokeWidth={2} />
      <line x1="5.7" y1="12" x2="18.3" y2="12" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      <circle cx="7.2" cy="12" r="1.55" fill="currentColor" />
      <circle cx="10.4" cy="12" r="1.55" fill="currentColor" />
      <circle cx="13.6" cy="12" r="1.55" fill="currentColor" />
      <circle cx="16.8" cy="12" r="1.55" stroke="currentColor" strokeWidth={1.6} />
    </svg>
  );
}
