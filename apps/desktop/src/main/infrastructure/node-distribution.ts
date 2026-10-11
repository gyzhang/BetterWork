/**
 * 受管 Node.js 发行候选（ADR-0047）。
 *
 * 与 [python-distribution](./python-distribution.ts) 对称：每一条都指向一个**固定版本**的上游
 * 官方制品，绝不跟随 latest；`sha256` 取自 nodejs.org 发布的 `SHASUMS256.txt`，逐字记录，
 * 不凭空填写。下载后的制品必须重新计算校验值并与这里比对，失配即拒绝使用。
 *
 * 与 Python 不同，Node 没有 CPython `cp312` 这类 ABI 标签，因此平台只含 os/arch。
 * ADR-0047 决策 9/10：构建期下载并校验，解压后随包分发；当前仅 darwin/arm64。
 */

/** Node 制品的目标平台；Node 无 ABI 标签概念，故只含 os/arch。 */
export interface NodePlatform {
  readonly os: 'darwin' | 'win32' | 'linux';
  readonly arch: 'arm64' | 'x64';
}

export interface NodeDistribution {
  readonly id: string;
  readonly version: string;
  readonly npmVersion: string;
  readonly platform: NodePlatform;
  readonly fileName: string;
  readonly url: string;
  readonly sha256: string;
  readonly license: string;
  /** 解压后 node 可执行文件相对解压根的路径。 */
  readonly entryRelativePath: string;
}

const upstream = (version: string, fileName: string): string =>
  `https://nodejs.org/dist/v${version}/${fileName}`;

/** MIT（Node.js）；随包 npm 及其依赖各自许可，详见 Node.js 发行说明。 */
const nodeLicense = 'MIT (Node.js); bundled npm and its dependencies under their own licenses';

export const nodeDistributions: readonly NodeDistribution[] = [
  {
    id: 'node-24.21.0-darwin-arm64',
    version: '24.21.0',
    npmVersion: '11.19.0',
    platform: { os: 'darwin', arch: 'arm64' },
    fileName: 'node-v24.21.0-darwin-arm64.tar.gz',
    url: upstream('24.21.0', 'node-v24.21.0-darwin-arm64.tar.gz'),
    sha256: 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057',
    license: nodeLicense,
    entryRelativePath: 'node-v24.21.0-darwin-arm64/bin/node',
  },
];

export const findNodeDistribution = (id: string): NodeDistribution | undefined =>
  nodeDistributions.find((distribution) => distribution.id === id);

/** 按平台挑选默认候选：找不到就返回 undefined，由调用方如实说明缺项。 */
export const findNodeDistributionForPlatform = (
  platform: NodePlatform,
): NodeDistribution | undefined =>
  nodeDistributions.find(
    (distribution) =>
      distribution.platform.os === platform.os && distribution.platform.arch === platform.arch,
  );
