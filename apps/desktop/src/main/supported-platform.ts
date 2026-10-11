export const isSupportedPlatform = (os: string, arch: string): boolean =>
  os === 'darwin' && arch === 'arm64';
