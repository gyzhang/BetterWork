import { readFileSync, writeFileSync } from 'node:fs';
import console from 'node:console';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

const readJson = (relativePath) =>
  JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), 'utf8'));

const writeJson = (relativePath, value) => {
  const filePath = path.join(repositoryRoot, relativePath);
  const current = readFileSync(filePath, 'utf8');
  const next = `${JSON.stringify(value, null, 2)}\n`;
  if (current === next) return false;
  if (checkOnly) {
    throw new Error(`${relativePath} 与根 package.json 版本不一致；运行 npm run version:sync。`);
  }
  writeFileSync(filePath, next);
  return true;
};

const rootPackage = readJson('package.json');
const version = rootPackage.version;
if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version)) {
  throw new Error('根 package.json 的 version 必须是三段稳定版本，例如 1.1.0。');
}

const desktopPackage = readJson('apps/desktop/package.json');
desktopPackage.version = version;
const updatedDesktopPackage = writeJson('apps/desktop/package.json', desktopPackage);

const packageLock = readJson('package-lock.json');
packageLock.version = version;
const rootLockPackage = packageLock.packages?.[''];
const desktopLockPackage = packageLock.packages?.['apps/desktop'];
if (!rootLockPackage || !desktopLockPackage) {
  throw new Error('package-lock.json 缺少根项目或桌面应用工作区记录。');
}
rootLockPackage.version = version;
desktopLockPackage.version = version;
const updatedPackageLock = writeJson('package-lock.json', packageLock);

if (updatedDesktopPackage || updatedPackageLock) {
  console.log(`已将桌面应用与 package-lock.json 同步到 ${version}。`);
} else {
  console.log(`产品版本 ${version} 已同步。`);
}
