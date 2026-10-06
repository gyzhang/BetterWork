import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import console from 'node:console';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const asRecord = (value, label) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
};

const requiredString = (value, label) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is missing`);
  }
  return value.trim();
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const normalizePackageName = (name) => name.toLowerCase().replaceAll(/[._-]+/gu, '-');

const packageFromPipReport = (item, index) => {
  const reportItem = asRecord(item, `install[${index}]`);
  const metadata = asRecord(reportItem.metadata, `install[${index}].metadata`);
  const downloadInfo = asRecord(reportItem.download_info, `install[${index}].download_info`);
  const archiveInfo = asRecord(
    downloadInfo.archive_info,
    `install[${index}].download_info.archive_info`,
  );
  const hashes = asRecord(
    archiveInfo.hashes,
    `install[${index}].download_info.archive_info.hashes`,
  );
  const name = requiredString(metadata.name, `install[${index}].metadata.name`);
  const version = requiredString(metadata.version, `install[${index}].metadata.version`);
  const url = requiredString(downloadInfo.url, `install[${index}].download_info.url`);
  const parsedUrl = new globalThis.URL(url);
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    throw new Error(`${name} must use an HTTPS artifact URL without embedded credentials`);
  }
  const wheel = decodeURIComponent(path.posix.basename(parsedUrl.pathname));
  if (!/^[A-Za-z0-9][A-Za-z0-9_.+-]{0,295}\.whl$/u.test(wheel)) {
    throw new Error(`${name} resolved to a source archive; only reviewed wheels can be locked`);
  }
  const digest = requiredString(hashes.sha256, `install[${index}].archive_info.hashes.sha256`);
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw new Error(`${name} has an invalid SHA-256`);
  }
  const license = typeof metadata.license === 'string' ? metadata.license.trim() : '';
  return {
    name,
    version,
    wheel,
    sha256: digest,
    source: 'approved-index',
    url,
    ...(license ? { license } : {}),
  };
};

export const generateSkillDependencyLock = (reportValue, importProbes) => {
  const report = asRecord(reportValue, 'pip report');
  if (!Array.isArray(report.install) || report.install.length === 0) {
    throw new Error('pip report contains no resolved packages');
  }
  if (importProbes.length === 0 || importProbes.some((probe) => !probe.trim())) {
    throw new Error('at least one import probe is required');
  }
  const packages = report.install.map(packageFromPipReport);
  const names = new Set();
  const wheels = new Set();
  for (const item of packages) {
    const normalizedName = normalizePackageName(item.name);
    if (names.has(normalizedName)) throw new Error(`pip report repeats package ${item.name}`);
    if (wheels.has(item.wheel)) throw new Error(`pip report repeats wheel ${item.wheel}`);
    names.add(normalizedName);
    wheels.add(item.wheel);
  }
  packages.sort((left, right) => {
    const normalizedLeft = normalizePackageName(left.name);
    const normalizedRight = normalizePackageName(right.name);
    return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
  });
  return {
    lockVersion: 1,
    platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
    pythonRequirement: '3.12',
    packages,
    importProbes: [...new Set(importProbes.map((probe) => probe.trim()))],
  };
};

const downloadWheelhouse = async (lock, directory) => {
  await mkdir(directory, { recursive: true });
  for (const item of lock.packages) {
    const target = path.join(directory, item.wheel);
    try {
      const existing = await readFile(target);
      if (sha256(existing) !== item.sha256) {
        throw new Error(
          `${item.wheel} already exists with a different SHA-256; review it manually`,
        );
      }
      continue;
    } catch (error) {
      if (error instanceof Error && !('code' in error && error.code === 'ENOENT')) throw error;
    }
    const response = await globalThis.fetch(item.url, {
      signal: globalThis.AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new Error(`download failed for ${item.wheel} (HTTP ${response.status})`);
    const finalUrl = new globalThis.URL(response.url || item.url);
    if (finalUrl.protocol !== 'https:' || finalUrl.username || finalUrl.password) {
      throw new Error(`${item.wheel} redirected to an insecure or credentialed URL`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== item.sha256)
      throw new Error(`${item.wheel} SHA-256 does not match the lock`);
    const temporary = `${target}.tmp-${randomUUID()}`;
    try {
      await writeFile(temporary, bytes, { flag: 'wx' });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
};

const parseArguments = (argumentsList) => {
  const options = new Map();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const key = argumentsList[index];
    if (!key?.startsWith('--')) throw new Error(`unexpected argument: ${key ?? ''}`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`);
    options.set(key, value);
    index += 1;
  }
  for (const key of options.keys()) {
    if (!['--report', '--output', '--import-probes', '--wheelhouse'].includes(key)) {
      throw new Error(`unknown option: ${key}`);
    }
  }
  return options;
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const reportPath = options.get('--report');
  const outputPath = options.get('--output');
  const probeList = options.get('--import-probes');
  if (!reportPath || !outputPath || !probeList) {
    throw new Error(
      'usage: node scripts/generate-skill-dependency-lock.mjs --report pip-report.json --output runtime/locks/lock.json --import-probes pptx,lxml,yaml',
    );
  }
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const lock = generateSkillDependencyLock(report, probeList.split(','));
  if (options.has('--wheelhouse')) await downloadWheelhouse(lock, options.get('--wheelhouse'));
  const destination = path.resolve(outputPath);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(lock, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
