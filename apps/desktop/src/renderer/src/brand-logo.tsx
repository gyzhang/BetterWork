export function BrandLogo({ size = 26 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <mask id="bw-logo-spark">
        <rect x="2" y="2" width="20" height="20" rx="7" fill="#fff" />
        <path
          d="M12 4.4 C12.4 6.6 13.6 7.8 15.8 8.2 C13.6 8.6 12.4 9.8 12 12 C11.6 9.8 10.4 8.6 8.2 8.2 C10.4 7.8 11.6 6.6 12 4.4 Z"
          fill="#000"
        />
        <circle cx="7" cy="5.4" r="1" fill="#000" />
        <circle cx="17" cy="5.4" r="1" fill="#000" />
        <path d="M12 13.7 C10.7 13 9 12.9 7.4 13.2 L7.4 18.2 C9 17.9 10.7 18 12 18.7 Z" fill="#000" />
        <path d="M12 13.7 C13.3 13 15 12.9 16.6 13.2 L16.6 18.2 C15 17.9 13.3 18 12 18.7 Z" fill="#000" />
      </mask>
      <rect x="2" y="2" width="20" height="20" rx="7" fill="currentColor" mask="url(#bw-logo-spark)" />
    </svg>
  );
}
