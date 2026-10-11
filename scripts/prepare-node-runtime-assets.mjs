import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, readlink, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { findNodeDistribution } from '../apps/desktop/src/main/infrastructure/node-distribution.ts';

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const nodeRuntimeRoot = path.join(repositoryRoot, 'apps', 'desktop', 'build', 'node-runtime');
const downloadCacheRoot = path.join(tmpdir(), 'betterwork-node-runtime-downloads');
const distribution = findNodeDistribution('node-24.21.0-darwin-arm64');
const maxAssetBytes = 128 * 1024 * 1024;

if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('内置 Node 运行时资源仅支持 macOS arm64 打包。');
if (!distribution) throw new Error('找不到 macOS arm64 Node 发行候选。');

const hashFile = async (filePath) =>
  createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');

/**
 * 下载或复用官方 Node 归档：缓存命中且 SHA-256 相符就直接用，否则重新下载并逐项校验。
 * 与 [prepare-python-runtime-assets](./prepare-python-runtime-assets.mjs) 同一套校验纪律：
 * 哈希失配立即删除并失败，绝不使用未经校验的内容。
 */
const ensureArchive = async () => {
  await mkdir(downloadCacheRoot, { recursive: true });
  const destination = path.join(downloadCacheRoot, distribution.sha256);
  try {
    if ((await hashFile(destination)) === distribution.sha256) return destination;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code !== 'ENOENT') throw error;
  }
  rmSync(destination, { force: true });
  const response = await globalThis.fetch(distribution.url, {
    signal: globalThis.AbortSignal.timeout(15 * 60 * 1000),
  });
  if (!response.ok) throw new Error(`下载 ${distribution.fileName} 失败，HTTP ${response.status}`);
  const expectedLength = Number(response.headers.get('content-length') ?? 0);
  if (expectedLength > maxAssetBytes) throw new Error(`${distribution.fileName} 超过资源大小上限`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxAssetBytes)
    throw new Error(`${distribution.fileName} 超过资源大小上限`);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== distribution.sha256) throw new Error(`${distribution.fileName} 的 SHA-256 不匹配`);
  const temporaryPath = `${destination}.download`;
  try {
    await writeFile(temporaryPath, bytes, { mode: 0o600 });
    await rename(temporaryPath, destination);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
  return destination;
};

const archive = await ensureArchive();
const staging = mkdtempSync(path.join(tmpdir(), 'betterwork-node-extract-'));
try {
  execFileSync('tar', ['-xzf', archive, '-C', staging], { stdio: 'ignore' });
  const extractedRoot = path.join(staging, `node-v${distribution.version}-darwin-arm64`);
  if (!existsSync(path.join(extractedRoot, 'bin', 'node')))
    throw new Error(`Node 归档解压后缺少 bin/node：${extractedRoot}`);

  // 只保留运行所需：bin/node（真实二进制）、bin/npm 与 bin/npx（相对 symlink）、lib/node_modules/npm。
  // strip 掉 include/（C 头文件）、share/（man pages）与 corepack，ADR-0047 决策 9。
  rmSync(nodeRuntimeRoot, { recursive: true, force: true });
  await mkdir(path.join(nodeRuntimeRoot, 'bin'), { recursive: true });
  await mkdir(path.join(nodeRuntimeRoot, 'lib', 'node_modules'), { recursive: true });

  cpSync(path.join(extractedRoot, 'bin', 'node'), path.join(nodeRuntimeRoot, 'bin', 'node'));
  chmodSync(path.join(nodeRuntimeRoot, 'bin', 'node'), 0o755);
  // npm/npx 是指向 ../lib/node_modules/npm/bin/*.js 的相对 symlink；逐字重建目标，保持相对结构可解析。
  for (const name of ['npm', 'npx']) {
    const target = await readlink(path.join(extractedRoot, 'bin', name));
    await symlink(target, path.join(nodeRuntimeRoot, 'bin', name));
  }
  cpSync(
    path.join(extractedRoot, 'lib', 'node_modules', 'npm'),
    path.join(nodeRuntimeRoot, 'lib', 'node_modules', 'npm'),
    { recursive: true },
  );

  // 构建期 smoke：解压出的 node 必须能自报锁定版本，npm 必须能被同一 node 驱动。
  const nodeBin = path.join(nodeRuntimeRoot, 'bin', 'node');
  const reportedVersion = execFileSync(nodeBin, ['--version'], { encoding: 'utf8' }).trim();
  if (reportedVersion !== `v${distribution.version}`)
    throw new Error(
      `Node 版本校验失败：期望 v${distribution.version}，实际 ${reportedVersion || '（空）'}`,
    );
  const reportedNpm = execFileSync(
    nodeBin,
    [path.join(nodeRuntimeRoot, 'bin', 'npm'), '--version'],
    {
      encoding: 'utf8',
    },
  ).trim();
  if (reportedNpm !== distribution.npmVersion)
    throw new Error(
      `随包 npm 版本校验失败：期望 ${distribution.npmVersion}，实际 ${reportedNpm || '（空）'}`,
    );

  await writeFile(
    path.join(nodeRuntimeRoot, 'manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        nodeDistributionId: distribution.id,
        nodeVersion: distribution.version,
        archiveSha256: distribution.sha256,
        npmVersion: reportedNpm,
        entryRelativePath: 'bin/node',
        license: distribution.license,
      },
      null,
      2,
    )}\n`,
  );
  globalThis.console.log(
    `Node 运行时资源已准备：node ${reportedVersion}、npm ${reportedNpm}，落地 ${path.relative(repositoryRoot, nodeRuntimeRoot)}。`,
  );
} finally {
  rmSync(staging, { recursive: true, force: true });
}
