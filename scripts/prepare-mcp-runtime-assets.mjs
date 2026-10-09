import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { dependencyLockSchema } from '../packages/agent-protocol/src/index.ts';
import { findDistribution } from '../apps/desktop/src/main/infrastructure/python-distribution.ts';

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runtimeAssetsRoot = path.join(
  repositoryRoot,
  'apps',
  'desktop',
  'build',
  'mcp-runtime-assets',
);
const targetPlatform = { os: 'darwin', arch: 'arm64', abi: 'cp312' };
const distribution = findDistribution('python-build-standalone-3.12.14-darwin-arm64');
const lockPath = path.join(
  repositoryRoot,
  'resources',
  'dependency-locks',
  'mcp-server-fetch-darwin-arm64-cp312.json',
);
const lock = dependencyLockSchema.parse(JSON.parse(await readFile(lockPath, 'utf8')));
const maxAssetBytes = 128 * 1024 * 1024;

if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('内置 MCP 运行时资源仅支持 macOS arm64 打包。');
if (!distribution) throw new Error('找不到 macOS arm64 CPython 发行候选。');
if (
  lock.platform.os !== targetPlatform.os ||
  lock.platform.arch !== targetPlatform.arch ||
  lock.platform.abi !== targetPlatform.abi
)
  throw new Error('MCP fetch 依赖锁与当前打包平台不匹配。');

const hashFile = async (filePath) =>
  createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');

const downloadVerified = async (asset) => {
  const directory = path.dirname(asset.destination);
  await mkdir(directory, { recursive: true });
  try {
    if ((await hashFile(asset.destination)) === asset.sha256) return false;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code !== 'ENOENT') throw error;
  }
  await rm(asset.destination, { force: true });
  const response = await globalThis.fetch(asset.url, {
    signal: globalThis.AbortSignal.timeout(15 * 60 * 1000),
  });
  if (!response.ok) throw new Error(`下载 ${asset.name} 失败，HTTP ${response.status}`);
  const expectedLength = Number(response.headers.get('content-length') ?? 0);
  if (expectedLength > maxAssetBytes) throw new Error(`${asset.name} 超过资源大小上限`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxAssetBytes) throw new Error(`${asset.name} 超过资源大小上限`);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== asset.sha256) throw new Error(`${asset.name} 的 SHA-256 不匹配`);
  const temporaryPath = `${asset.destination}.download`;
  try {
    await writeFile(temporaryPath, bytes, { mode: 0o600 });
    await rename(temporaryPath, asset.destination);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return true;
};

const assets = [
  {
    name: distribution.fileName,
    url: distribution.url,
    sha256: distribution.sha256,
    destination: path.join(runtimeAssetsRoot, 'python', distribution.fileName),
  },
  ...lock.packages.map((entry) => {
    if (!entry.url) throw new Error(`wheel ${entry.wheel} 缺少锁定下载地址`);
    return {
      name: entry.wheel,
      url: entry.url,
      sha256: entry.sha256,
      destination: path.join(runtimeAssetsRoot, 'wheelhouse', entry.wheel),
    };
  }),
];

let nextIndex = 0;
let downloaded = 0;
const worker = async () => {
  while (nextIndex < assets.length) {
    const asset = assets[nextIndex];
    nextIndex += 1;
    if (!asset) return;
    if (await downloadVerified(asset)) downloaded += 1;
  }
};
await Promise.all(Array.from({ length: 6 }, () => worker()));

const files = await Promise.all(
  assets.map(async (asset) => ({
    file: path.relative(runtimeAssetsRoot, asset.destination),
    sha256: asset.sha256,
    size: (await stat(asset.destination)).size,
  })),
);
await writeFile(
  path.join(runtimeAssetsRoot, 'manifest.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      pythonDistributionId: distribution.id,
      files,
    },
    null,
    2,
  )}\n`,
);
globalThis.console.log(
  `MCP 运行时资源已准备：${String(files.length)} 项，${String(files.reduce((sum, file) => sum + file.size, 0))} 字节；本次下载 ${String(downloaded)} 项。`,
);
