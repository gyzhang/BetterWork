import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { githubMcpDistribution } from '../apps/desktop/src/main/infrastructure/github-mcp-distribution.ts';

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runtimeRoot = path.join(repositoryRoot, 'apps', 'desktop', 'build', 'github-mcp-runtime');
const downloadCacheRoot = path.join(tmpdir(), 'betterwork-github-mcp-downloads');
const maxAssetBytes = 128 * 1024 * 1024;
const archiveMembers = ['LICENSE', 'README.md', githubMcpDistribution.entryRelativePath];

if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('GitHub MCP 随包运行时仅支持 macOS arm64。');

const hashFile = async (filePath) =>
  createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');

const ensureArchive = async () => {
  await mkdir(downloadCacheRoot, { recursive: true });
  const destination = path.join(downloadCacheRoot, githubMcpDistribution.sha256);
  try {
    if ((await hashFile(destination)) === githubMcpDistribution.sha256) return destination;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code !== 'ENOENT') throw error;
  }
  rmSync(destination, { force: true });
  const response = await globalThis.fetch(githubMcpDistribution.url, {
    signal: globalThis.AbortSignal.timeout(15 * 60 * 1000),
  });
  if (!response.ok)
    throw new Error(
      `下载 GitHub MCP ${githubMcpDistribution.version} 失败，HTTP ${response.status}`,
    );
  const expectedLength = Number(response.headers.get('content-length') ?? 0);
  if (expectedLength > maxAssetBytes) throw new Error('GitHub MCP 发行包超过资源大小上限。');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxAssetBytes) throw new Error('GitHub MCP 发行包超过资源大小上限。');
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== githubMcpDistribution.sha256)
    throw new Error('GitHub MCP 发行包的 SHA-256 不匹配。');
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
const memberNames = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .sort();
if (JSON.stringify(memberNames) !== JSON.stringify([...archiveMembers].sort()))
  throw new Error(`GitHub MCP 发行包内容与锁定清单不符：${memberNames.join(', ')}`);

const staging = mkdtempSync(path.join(tmpdir(), 'betterwork-github-mcp-extract-'));
try {
  execFileSync(
    'tar',
    ['-xzf', archive, '-C', staging, 'LICENSE', githubMcpDistribution.entryRelativePath],
    {
      stdio: 'ignore',
    },
  );
  const executable = path.join(staging, githubMcpDistribution.entryRelativePath);
  const license = path.join(staging, 'LICENSE');
  if (!(await stat(executable)).isFile() || !(await stat(license)).isFile())
    throw new Error('GitHub MCP 发行包缺少服务程序或许可证。');

  rmSync(runtimeRoot, { recursive: true, force: true });
  await mkdir(runtimeRoot, { recursive: true });
  const bundledExecutable = path.join(runtimeRoot, githubMcpDistribution.entryRelativePath);
  cpSync(executable, bundledExecutable);
  chmodSync(bundledExecutable, 0o755);
  cpSync(license, path.join(runtimeRoot, 'LICENSE.txt'));
  await writeFile(
    path.join(runtimeRoot, 'manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        distributionId: githubMcpDistribution.id,
        version: githubMcpDistribution.version,
        archiveSha256: githubMcpDistribution.sha256,
        sourceUrl: githubMcpDistribution.sourceUrl,
        entryRelativePath: githubMcpDistribution.entryRelativePath,
        license: githubMcpDistribution.license,
      },
      null,
      2,
    )}\n`,
  );
  globalThis.console.log(
    `GitHub MCP ${githubMcpDistribution.version} 运行时已准备：${path.relative(repositoryRoot, runtimeRoot)}。`,
  );
} finally {
  rmSync(staging, { recursive: true, force: true });
}
