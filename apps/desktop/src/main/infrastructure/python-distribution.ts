import type { TargetPlatform } from '@betterwork/agent-protocol';

/**
 * 受管 Python 发行候选（设计 §4.1、决策 D2）。
 *
 * 这里的每一条都指向一个**固定版本**的上游制品，绝不跟随 latest；`sha256` 取自上游
 * 发布的 `SHA256SUMS`，逐字记录在 [依赖验证记录](../../../../docs/development/dependency-verification.md)，
 * 不凭空填写。下载后的制品必须重新计算校验值并与这里比对，失配即拒绝使用。
 *
 * A10 只提供定位、下载、校验与解压的机制；制品本身不进入仓库，随包分发由 A20 处理。
 */
export interface PythonDistribution {
  readonly id: string;
  readonly version: string;
  readonly release: string;
  readonly platform: TargetPlatform;
  readonly fileName: string;
  readonly url: string;
  readonly sha256: string;
  readonly license: string;
  /** 解压后解释器相对解压根的路径。 */
  readonly entryRelativePath: string;
}

const upstream = (fileName: string): string =>
  `https://github.com/astral-sh/python-build-standalone/releases/download/20260901/${fileName}`;

/** PSF-2.0；上游 install_only 制品还捆绑了各自许可的第三方组件，详见发行说明。 */
const cpythonLicense = 'PSF-2.0 (bundled third-party components under their own licenses)';

export const pythonDistributions: readonly PythonDistribution[] = [
  {
    id: 'python-build-standalone-3.12.14-darwin-arm64',
    version: '3.12.14',
    release: '20260901',
    platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
    fileName: 'cpython-3.12.14+20260901-aarch64-apple-darwin-install_only.tar.gz',
    url: upstream('cpython-3.12.14+20260901-aarch64-apple-darwin-install_only.tar.gz'),
    sha256: '3ee3ee547cedfeb7c2b16b2b7156039f7b470bb8f857e226fd3d2eb11db83c76',
    license: cpythonLicense,
    entryRelativePath: 'python/bin/python3.12',
  },
  {
    id: 'python-build-standalone-3.12.14-darwin-x64',
    version: '3.12.14',
    release: '20260901',
    platform: { os: 'darwin', arch: 'x64', abi: 'cp312' },
    fileName: 'cpython-3.12.14+20260901-x86_64-apple-darwin-install_only.tar.gz',
    url: upstream('cpython-3.12.14+20260901-x86_64-apple-darwin-install_only.tar.gz'),
    sha256: '2e31b23f3f1319f707d0e620b48847a0046577541d357276821f9f1b5492e0ba',
    license: cpythonLicense,
    entryRelativePath: 'python/bin/python3.12',
  },
  {
    // 记录在案但本机无法验收：Windows supervisor（A09）blocked，跨平台门槛保留到 A21。
    id: 'python-build-standalone-3.12.14-win32-x64',
    version: '3.12.14',
    release: '20260901',
    platform: { os: 'win32', arch: 'x64', abi: 'cp312' },
    fileName: 'cpython-3.12.14+20260901-x86_64-pc-windows-msvc-install_only.tar.gz',
    url: upstream('cpython-3.12.14+20260901-x86_64-pc-windows-msvc-install_only.tar.gz'),
    sha256: 'e90c1b6419da3bd812dd73bb3de40287a21abf153438147639ec5e20375ea93f',
    license: cpythonLicense,
    entryRelativePath: 'python/python.exe',
  },
];

export const findDistribution = (id: string): PythonDistribution | undefined =>
  pythonDistributions.find((distribution) => distribution.id === id);

/** 按平台挑选默认候选：同一版本优先，找不到就返回 undefined，由调用方如实说明缺项。 */
export const findDistributionForPlatform = (
  platform: TargetPlatform,
): PythonDistribution | undefined =>
  pythonDistributions.find((distribution) => {
    const target = distribution.platform;
    return (
      target.os === platform.os && target.arch === platform.arch && target.abi === platform.abi
    );
  });

/** 由解释器版本派生 ABI 标签，例如 `3.12.14` → `cp312`。 */
export const abiTagOf = (version: string): string | null => {
  const match = /^(\d+)\.(\d+)/u.exec(version);
  if (!match?.[1] || !match[2]) return null;
  return `cp${match[1]}${match[2]}`;
};
