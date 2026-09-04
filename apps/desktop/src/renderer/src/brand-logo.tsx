export function BrandLogo({ size = 28 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <mask id="bw-logo-spark">
        <rect x="2" y="2" width="20" height="20" rx="7" fill="#fff" />
        <path
          d="M12 3.1 C12.5 5.9 13.9 7.3 16.7 7.8 C13.9 8.3 12.5 9.7 12 12.5 C11.5 9.7 10.1 8.3 7.3 7.8 C10.1 7.3 11.5 5.9 12 3.1 Z"
          fill="#000"
        />
        <path d="M12 13.5 C10.5 12.7 8.5 12.6 6.6 13 L6.6 19 C8.5 18.6 10.5 18.7 12 19.5 Z" fill="#000" />
        <path d="M12 13.5 C13.5 12.7 15.5 12.6 17.4 13 L17.4 19 C15.5 18.6 13.5 18.7 12 19.5 Z" fill="#000" />
      </mask>
      <rect x="2" y="2" width="20" height="20" rx="7" fill="currentColor" mask="url(#bw-logo-spark)" />
    </svg>
  );
}
