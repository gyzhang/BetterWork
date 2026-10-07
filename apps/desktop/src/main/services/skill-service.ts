import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { SkillInstruction } from '@betterwork/agent-core';
import type {
  DependencyLock,
  RuntimeProfileDraft,
  SkillDetail,
  SkillRuntimeDiscoveryFinding,
} from '@betterwork/agent-protocol';
import {
  dependencyLockSchema,
  runtimeProfileDraftSchema,
  runtimeProfileRevisionSchema,
} from '@betterwork/agent-protocol';
import JSZip from 'jszip';
import { parse } from 'yaml';
import { z } from 'zod';

import { type AppStore } from '../persistence';

const skillFileName = 'SKILL.md';
const skillExportFileName = 'betterwork.skill.json';
const maxFiles = 2_000;
const maxBytes = 50 * 1024 * 1024;
const archiveDownloadTimeoutMs = 60_000;

interface SkillFile {
  relativePath: string;
  bytes: Buffer;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
  version?: string;
  [key: string]: unknown;
}

export interface SkillResourceRoots {
  developmentBuiltinRoot: string;
  installedBuiltinRoot: string;
  userRoot: string;
}

export interface ImportedSkill {
  skill: SkillDetail;
  contentHash: string;
  resourceRoot: string;
}

export interface SkillExportManifest {
  formatVersion: 2;
  /** Stable publisher identity; the host database keeps its own local skillId. */
  skillId: string;
  name: string;
  description: string;
  packageVersion: string;
  runtimeProfile?: RuntimeProfileDraft;
}

const legacySkillExportManifestSchema = z
  .object({
    formatVersion: z.literal(1),
    skillId: z.string().trim().min(1).max(160),
    name: z.string().min(1),
    description: z.string(),
    runtimeProfile: runtimeProfileRevisionSchema.optional(),
  })
  .strict();

const skillPackageManifestSchema = z.discriminatedUnion('formatVersion', [
  legacySkillExportManifestSchema,
  z
    .object({
      formatVersion: z.literal(2),
      skillId: z.string().trim().min(1).max(160),
      name: z.string().min(1),
      description: z.string(),
      packageVersion: z.string().trim().min(1).max(100),
      runtimeProfile: runtimeProfileDraftSchema.optional(),
    })
    .strict(),
]);

export interface SkillDependencyAssets {
  lock: DependencyLock;
  wheelhouseRoot?: string;
}

const zipDeclaredSize = (entry: JSZip.JSZipObject): number | undefined => {
  const data = (entry as unknown as { _data?: Record<string, unknown> })._data;
  const size = data?.['uncompressedSize'];
  return typeof size === 'number' && Number.isSafeInteger(size) && size >= 0 ? size : undefined;
};

const archiveRelativePath = (name: string): string => {
  if (!name || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/u.test(name)) {
    throw new Error(`Skill ZIP 包含非法路径：${name}`);
  }
  const segments = name.split('/').filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Skill ZIP 路径不能离开包目录：${name}`);
  }
  const normalized = path.posix.normalize(segments.join('/'));
  if (!normalized || normalized === '.' || normalized.startsWith('../')) {
    throw new Error(`Skill ZIP 包含非法路径：${name}`);
  }
  return normalized;
};

const isZipSymlink = (entry: JSZip.JSZipObject): boolean => {
  const permissions = entry.unixPermissions;
  const mode =
    typeof permissions === 'number'
      ? permissions
      : typeof permissions === 'string'
        ? Number.parseInt(permissions, 8)
        : 0;
  return Number.isFinite(mode) && (mode & 0o170000) === 0o120000;
};

export interface BuiltinReleaseEntry {
  skillId: string;
  resourceName: string;
  name: string;
  description: string;
  contentHash: string;
  originalVersion?: string;
  profileHash: string;
  dependencyFingerprint: string;
  scopeHash: string;
  profile?: RuntimeProfileDraft;
}

export interface BuiltinReleaseManifest {
  formatVersion: 1;
  skills: BuiltinReleaseEntry[];
}

export interface SkillExecutionCanceller {
  cancelForSkill(skillId: string): Promise<number>;
}

const isWithin = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
};

const parseFrontmatter = (content: string): SkillFrontmatter => {
  const lines = content.split(/\r?\n/u);
  if (lines[0] !== '---') return {};
  const end = lines.findIndex((line, index) => index > 0 && line === '---');
  if (end < 0) throw new Error('SKILL.md frontmatter is not closed');
  const source = lines.slice(1, end).join('\n');
  let value: unknown;
  try {
    value = parse(source);
  } catch (error) {
    const fallback: Record<string, unknown> = {};
    const entries = source.split(/\r?\n/u).filter((line) => line.trim().length > 0);
    const flatMapping = entries.every((line) => /^\s*[A-Za-z0-9_-]+\s*:/u.test(line));
    if (!flatMapping) throw error;
    for (const line of entries) {
      const match = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)\s*$/u.exec(line);
      if (!match) throw error;
      const key = match[1];
      const rawValue = match[2];
      if (!key || rawValue === undefined) throw error;
      try {
        const parsedValue: unknown = parse(rawValue);
        fallback[key] =
          parsedValue !== null && typeof parsedValue === 'object' ? rawValue : parsedValue;
      } catch {
        fallback[key] = rawValue;
      }
    }
    value = fallback;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SKILL.md frontmatter must be a YAML mapping');
  }
  return value as SkillFrontmatter;
};

const stripFrontmatter = (content: string): string => {
  const lines = content.split(/\r?\n/u);
  if (lines[0] !== '---') return content;
  const end = lines.findIndex((line, index) => index > 0 && line === '---');
  if (end < 0) return content;
  return lines
    .slice(end + 1)
    .join('\n')
    .trimStart();
};

/** macOS / Windows 资源管理器的元数据不是 Skill 内容：不计入 hash、不复制。 */
const isOperatingSystemMetadata = (name: string): boolean =>
  name === '.DS_Store' || name === 'Thumbs.db' || name === 'desktop.ini' || name.startsWith('._');

const readPackage = async (
  sourceRoot: string,
): Promise<{
  files: SkillFile[];
  frontmatter: SkillFrontmatter;
  importedRuntimeProfile?: RuntimeProfileDraft;
  packageId?: string;
  packageName?: string;
  packageDescription?: string;
  packageVersion?: string;
}> => {
  const root = path.resolve(sourceRoot);
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error('Skill source must be a real directory');
  }
  const files: SkillFile[] = [];
  let totalBytes = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && isOperatingSystemMetadata(entry.name)) continue;
      if (entry.isSymbolicLink())
        throw new Error(`Skill package cannot contain symbolic links: ${entry.name}`);
      if (!entry.isDirectory() && !entry.isFile()) {
        throw new Error(`Skill package contains a special file: ${entry.name}`);
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      const relativePath = path.relative(root, absolutePath);
      if (
        !relativePath ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
      ) {
        throw new Error('Skill package contains a path outside its root');
      }
      const bytes = await readFile(absolutePath);
      totalBytes += bytes.byteLength;
      if (files.length >= maxFiles) throw new Error(`Skill package exceeds ${maxFiles} files`);
      if (totalBytes > maxBytes) throw new Error('Skill package exceeds 50 MB');
      files.push({ relativePath, bytes });
    }
  };
  await visit(root);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const exportFile = files.find((file) => file.relativePath === skillExportFileName);
  let importedRuntimeProfile: RuntimeProfileDraft | undefined;
  let packageName: string | undefined;
  let packageDescription: string | undefined;
  let packageVersion: string | undefined;
  let packageId: string | undefined;
  if (exportFile) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(exportFile.bytes.toString('utf8')) as unknown;
    } catch (error) {
      throw new Error('betterwork.skill.json 不是合法 JSON', { cause: error });
    }
    const manifest = skillPackageManifestSchema.parse(parsed);
    importedRuntimeProfile =
      manifest.formatVersion === 1 ? manifest.runtimeProfile?.profile : manifest.runtimeProfile;
    packageName = manifest.name;
    packageDescription = manifest.description;
    packageId = manifest.skillId;
    if (manifest.formatVersion === 2) packageVersion = manifest.packageVersion;
  }
  const packageFiles = files.filter((file) => file.relativePath !== skillExportFileName);
  validatePackageDependencyBundle(packageFiles, importedRuntimeProfile);
  const skillFile = packageFiles.find((file) => file.relativePath === skillFileName);
  if (!skillFile) throw new Error('Skill package must contain SKILL.md at its root');
  return {
    files: packageFiles,
    frontmatter: parseFrontmatter(skillFile.bytes.toString('utf8')),
    ...(importedRuntimeProfile ? { importedRuntimeProfile } : {}),
    ...(packageId ? { packageId } : {}),
    ...(packageName ? { packageName } : {}),
    ...(packageDescription !== undefined ? { packageDescription } : {}),
    ...(packageVersion ? { packageVersion } : {}),
  };
};

const hashFiles = (files: readonly SkillFile[]): string => {
  const hash = createHash('sha256');
  for (const file of files) {
    // Wheelhouse 内容可由锁内 SHA-256 和下载地址重建；缺失 wheel 不应使 Skill 源码失效。
    if (file.relativePath.startsWith('runtime/wheelhouse/')) continue;
    hash.update(file.relativePath).update('\0').update(file.bytes);
  }
  return hash.digest('hex');
};

const validatePackageDependencyBundle = (
  files: readonly SkillFile[],
  profile: RuntimeProfileDraft | undefined,
): void => {
  const bundle = profile?.dependencyBundle;
  if (!bundle) return;
  const lockFile = files.find((file) => file.relativePath === bundle.lockPath);
  if (!lockFile) throw new Error(`Skill 包缺少依赖锁文件：${bundle.lockPath}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(lockFile.bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(`Skill 依赖锁不是合法 JSON：${bundle.lockPath}`, { cause: error });
  }
  const result = dependencyLockSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Skill 依赖锁格式无效：${result.error.issues.map((issue) => issue.message).join('；')}`,
    );
  }
  if (profile.pythonRequirement && result.data.pythonRequirement !== profile.pythonRequirement) {
    throw new Error('Skill 依赖锁的 Python 版本与运行声明不一致');
  }
};

const externalDirectoryVariables = (line: string): string[] => {
  const variables = new Set<string>();
  const patterns = [
    /\bos\.environ(?:\.get)?\s*\[?\s*\(?\s*['"]([A-Z][A-Z0-9_]*_(?:HOME|ROOT|DIR))['"]/gu,
    /\bos\.getenv\s*\(\s*['"]([A-Z][A-Z0-9_]*_(?:HOME|ROOT|DIR))['"]/gu,
    /\$\{?([A-Z][A-Z0-9_]*_(?:HOME|ROOT|DIR))\}?/gu,
    /\b(?:set|export|configure|设置|配置)\s+([A-Z][A-Z0-9_]*_(?:HOME|ROOT|DIR))\b/giu,
  ];
  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) {
      const variable = match[1];
      if (variable) variables.add(variable.toUpperCase());
    }
  }
  return [...variables];
};

/**
 * 只对包内文本做静态提示：不 import Python、不读取 requirements 执行、不启动 git/npm。
 * 发现结果是线索，不会自动成为已验证的运行配置。
 */
export const discoverSkillRuntime = (
  files: readonly Pick<SkillFile, 'relativePath' | 'bytes'>[],
): SkillRuntimeDiscoveryFinding[] => {
  const findings: SkillRuntimeDiscoveryFinding[] = [];
  const add = (finding: SkillRuntimeDiscoveryFinding): void => {
    if (findings.length < 200) findings.push(finding);
  };
  const pythonFiles = files.filter((file) => file.relativePath.toLowerCase().endsWith('.py'));
  for (const file of pythonFiles.slice(0, 50)) {
    add({
      kind: 'python-script',
      sourcePath: file.relativePath,
      lineNumber: 1,
      label: '发现 Python 脚本',
    });
  }
  const dependencyFiles = files.filter((file) =>
    /(?:^|\/)(?:requirements(?:[-_.][^/]*)?\.txt|pyproject\.toml|Pipfile|environment\.ya?ml)$/iu.test(
      file.relativePath,
    ),
  );
  for (const file of dependencyFiles.slice(0, 50)) {
    add({
      kind: 'dependency-file',
      sourcePath: file.relativePath,
      lineNumber: 1,
      label: '发现 Python 依赖声明文件',
    });
  }
  const textExtensions = /\.(?:md|py|txt|toml|ya?ml|json|sh)$/iu;
  const seenEnvironmentVariables = new Set<string>();
  const seenPackages = new Set<string>();
  let sawPythonRuntimeHint = false;
  for (const file of files) {
    if (!textExtensions.test(file.relativePath) || file.bytes.includes(0)) continue;
    const content = file.bytes.toString('utf8');
    const lines = content.split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      const variables = externalDirectoryVariables(line);
      for (const variable of variables) {
        if (seenEnvironmentVariables.has(variable)) continue;
        seenEnvironmentVariables.add(variable);
        add({
          kind: 'environment-variable',
          sourcePath: file.relativePath,
          lineNumber,
          label: `发现外部目录变量 ${variable}`,
        });
      }
      const packages = line.matchAll(
        /\b(?:pip(?:3(?:\.\d+)?)?|python(?:3(?:\.\d+)?)?\s+-m\s+pip)\s+install\s+([^\s`|;]+)/giu,
      );
      for (const match of packages) {
        const packageName = /^([A-Za-z0-9][A-Za-z0-9._-]*)/u.exec(match[1] ?? '')?.[1];
        if (!packageName || seenPackages.has(packageName.toLowerCase())) continue;
        seenPackages.add(packageName.toLowerCase());
        add({
          kind: 'package-install-hint',
          sourcePath: file.relativePath,
          lineNumber,
          label: `发现 Python 包安装提示 ${packageName}`,
        });
      }
      if (
        !sawPythonRuntimeHint &&
        /(?:系统|system)\s*python|托管\s*python|managed\s+python/iu.test(line)
      ) {
        sawPythonRuntimeHint = true;
        add({
          kind: 'python-runtime-hint',
          sourcePath: file.relativePath,
          lineNumber,
          label: '发现 Python 运行环境说明',
        });
      }
    }
  }
  return findings;
};

const copyFiles = async (files: readonly SkillFile[], destination: string): Promise<void> => {
  for (const file of files) {
    const target = path.join(destination, file.relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.bytes, { flag: 'wx' });
  }
};

const copyDirectory = async (source: string, destination: string): Promise<void> => {
  const packageData = await readPackage(source);
  await mkdir(destination, { recursive: true });
  await copyFiles(packageData.files, destination);
};

export class SkillService {
  constructor(
    private readonly store: AppStore,
    private readonly roots: SkillResourceRoots,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private userRevisionRoot(skill: SkillDetail): string {
    const root = path.resolve(this.roots.userRoot);
    const resourceRoot = path.resolve(root, skill.revision.resourceKey.replace(/^user\//u, ''));
    if (!isWithin(root, resourceRoot))
      throw new Error('Skill resource key escapes the user Skill root');
    return resourceRoot;
  }

  private async copyToStaging(
    files: readonly SkillFile[],
    skillId: string,
    contentHash: string,
  ): Promise<string> {
    const root = path.resolve(this.roots.userRoot);
    const finalRoot = path.join(root, skillId, 'revisions', contentHash);
    const stagingRoot = path.join(root, skillId, 'revisions', `.staging-${randomUUID()}`);
    if (!isWithin(root, finalRoot) || !isWithin(root, stagingRoot)) {
      throw new Error('Skill destination escapes the user Skill root');
    }
    await mkdir(path.dirname(stagingRoot), { recursive: true });
    try {
      await copyFiles(files, stagingRoot);
      await stat(stagingRoot);
      await rename(stagingRoot, finalRoot);
      return finalRoot;
    } catch (error) {
      await rm(stagingRoot, { recursive: true, force: true });
      throw error;
    }
  }

  async importSource(sourcePath: string): Promise<ImportedSkill> {
    const source = path.resolve(sourcePath);
    const info = await lstat(source);
    if (info.isSymbolicLink()) throw new Error('Skill source cannot be a symbolic link');
    if (info.isDirectory()) return this.importDirectory(source);
    if (info.isFile() && path.extname(source).toLowerCase() === '.zip') {
      if (info.size > maxBytes) throw new Error('Skill ZIP 压缩包超过 50 MB 上限');
      return this.importArchiveBytes(
        await readFile(source),
        path.basename(source, path.extname(source)),
      );
    }
    throw new Error('请选择 Skill 文件夹或 ZIP 包');
  }

  async importFromUrl(value: string): Promise<ImportedSkill> {
    let url: URL;
    try {
      url = new URL(value);
    } catch (error) {
      throw new Error('Skill 下载地址无效', { cause: error });
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('Skill 下载地址必须是没有内嵌凭据的 HTTPS 链接');
    }
    const response = await this.fetcher(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(archiveDownloadTimeoutMs),
    });
    if (!response.ok) throw new Error(`Skill 下载失败（HTTP ${response.status}）`);
    const finalUrl = response.url ? new URL(response.url) : url;
    if (finalUrl.protocol !== 'https:' || finalUrl.username || finalUrl.password) {
      throw new Error('Skill 下载重定向必须保持 HTTPS 且不能包含凭据');
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error('Skill 下载包超过 50 MB 上限');
    }
    if (!response.body) throw new Error('Skill 下载响应没有文件内容');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error('Skill 下载包超过 50 MB 上限');
      }
      chunks.push(value);
    }
    const archive = Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
      totalBytes,
    );
    const fallbackName = path.posix.basename(finalUrl.pathname).replace(/\.zip$/iu, '');
    return this.importArchiveBytes(archive, fallbackName || 'skill-package');
  }

  private async importArchiveBytes(
    archiveBytes: Uint8Array,
    fallbackName: string,
  ): Promise<ImportedSkill> {
    if (archiveBytes.byteLength > maxBytes) throw new Error('Skill ZIP 压缩包超过 50 MB 上限');
    const archive = await JSZip.loadAsync(archiveBytes, { checkCRC32: true });
    const entries = Object.values(archive.files).filter((entry) => !entry.dir);
    if (entries.length > maxFiles) throw new Error(`Skill ZIP 包超过 ${maxFiles} 个文件`);
    const normalizedEntries: Array<{
      entry: JSZip.JSZipObject;
      relativePath: string;
      size: number;
    }> = [];
    const seenPaths = new Set<string>();
    let declaredBytes = 0;
    for (const entry of entries) {
      if (isZipSymlink(entry)) throw new Error(`Skill ZIP 不能包含符号链接：${entry.name}`);
      const permissions = entry.unixPermissions;
      const mode =
        typeof permissions === 'number'
          ? permissions
          : typeof permissions === 'string'
            ? Number.parseInt(permissions, 8)
            : 0;
      const fileType = mode & 0o170000;
      if (fileType !== 0 && fileType !== 0o100000) {
        throw new Error(`Skill ZIP 不能包含特殊文件：${entry.name}`);
      }
      const relativePath = archiveRelativePath(entry.name);
      if (
        relativePath.startsWith('__MACOSX/') ||
        isOperatingSystemMetadata(path.posix.basename(relativePath))
      ) {
        continue;
      }
      if (seenPaths.has(relativePath)) throw new Error(`Skill ZIP 路径重复：${relativePath}`);
      seenPaths.add(relativePath);
      const size = zipDeclaredSize(entry);
      if (size === undefined) throw new Error(`Skill ZIP 缺少条目大小信息：${relativePath}`);
      declaredBytes += size;
      if (declaredBytes > maxBytes) throw new Error('Skill ZIP 解压内容超过 50 MB 上限');
      normalizedEntries.push({ entry, relativePath, size });
    }
    if (normalizedEntries.length === 0) throw new Error('Skill ZIP 包中没有文件');
    const hasRootSkill = normalizedEntries.some((item) => item.relativePath === skillFileName);
    let wrapper = '';
    if (!hasRootSkill) {
      const roots = new Set(normalizedEntries.map((item) => item.relativePath.split('/')[0]));
      const onlyRoot = roots.values().next().value;
      if (
        roots.size !== 1 ||
        !onlyRoot ||
        !normalizedEntries.some((item) => item.relativePath === `${onlyRoot}/${skillFileName}`)
      ) {
        throw new Error('Skill ZIP 必须在根目录或唯一顶层目录中包含 SKILL.md');
      }
      wrapper = `${onlyRoot}/`;
    }
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'betterwork-skill-zip-'));
    try {
      let extractedBytes = 0;
      for (const item of normalizedEntries) {
        const relativePath = wrapper ? item.relativePath.slice(wrapper.length) : item.relativePath;
        if (!relativePath) continue;
        const target = path.resolve(temporaryRoot, ...relativePath.split('/'));
        if (!isWithin(temporaryRoot, target)) throw new Error('Skill ZIP 路径逃逸出临时目录');
        const bytes = await item.entry.async('nodebuffer');
        if (bytes.byteLength !== item.size)
          throw new Error(`Skill ZIP 条目大小不符：${relativePath}`);
        extractedBytes += bytes.byteLength;
        if (extractedBytes > maxBytes) throw new Error('Skill ZIP 解压内容超过 50 MB 上限');
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes, { flag: 'wx' });
      }
      return await this.importDirectory(temporaryRoot, fallbackName);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async importDirectory(sourceRoot: string, fallbackName?: string): Promise<ImportedSkill> {
    const source = path.resolve(sourceRoot);
    const packageData = await readPackage(source);
    const contentHash = hashFiles(packageData.files);
    const skillId = randomUUID();
    const resourceKey = `user/${skillId}/revisions/${contentHash}`;
    const resourceRoot = await this.copyToStaging(packageData.files, skillId, contentHash);
    const name =
      typeof packageData.frontmatter.name === 'string' && packageData.frontmatter.name.trim()
        ? packageData.frontmatter.name.trim()
        : (packageData.packageName ?? fallbackName ?? path.basename(source));
    const description =
      typeof packageData.frontmatter.description === 'string'
        ? packageData.frontmatter.description
        : (packageData.packageDescription ?? '');
    try {
      this.store.transaction(() => {
        this.store.skills.save({
          id: skillId,
          name,
          description,
          sourceKind: 'user',
          currentRevisionId: 'pending-revision',
        });
        const createdRevisionId = this.store.skills.saveRevision({
          skillId,
          contentHash,
          ...(packageData.packageId ? { packageId: packageData.packageId } : {}),
          ...(typeof packageData.frontmatter.version === 'string' || packageData.packageVersion
            ? {
                originalVersion:
                  typeof packageData.frontmatter.version === 'string'
                    ? packageData.frontmatter.version
                    : packageData.packageVersion,
              }
            : {}),
          resourceKey,
          frontmatter: packageData.frontmatter,
        });
        this.store.skills.save({
          id: skillId,
          name,
          description,
          sourceKind: 'user',
          currentRevisionId: createdRevisionId,
        });
        return createdRevisionId;
      });
      if (packageData.importedRuntimeProfile) {
        this.saveRuntimeProfile(skillId, packageData.importedRuntimeProfile);
      }
      const skill = this.store.skills.get(skillId);
      if (!skill) throw new Error('Imported Skill was not available after database registration');
      return { skill, contentHash, resourceRoot };
    } catch (error) {
      await rm(resourceRoot, { recursive: true, force: true });
      throw error;
    }
  }

  async resolveResourceRoot(skill: SkillDetail): Promise<string> {
    if (skill.sourceKind === 'user') return this.userRevisionRoot(skill);
    return this.resolveBuiltinResource(skill.revision.resourceKey.replace(/^builtin\//u, ''));
  }

  async getDetail(skillId: string): Promise<SkillDetail | undefined> {
    const skill = this.store.skills.get(skillId);
    if (!skill) return undefined;
    const resourceRoot = await this.resolveResourceRoot(skill);
    const packageData = await readPackage(resourceRoot);
    if (hashFiles(packageData.files) !== skill.revision.contentHash) {
      throw new Error('Skill 内容 hash 已变化，请重新导入并确认信任');
    }
    return { ...skill, runtimeDiscovery: discoverSkillRuntime(packageData.files) };
  }

  async verifyResourceRoot(skill: SkillDetail): Promise<string> {
    const root = await this.resolveResourceRoot(skill);
    const data = await readPackage(root);
    if (hashFiles(data.files) !== skill.revision.contentHash)
      throw new Error('Skill 内容 hash 已变化，请重新导入并确认信任');
    return root;
  }

  async getDependencyAssets(skillId: string): Promise<SkillDependencyAssets | undefined> {
    const skill = this.store.skills.get(skillId);
    if (!skill) throw new Error(`Skill ${skillId} does not exist`);
    const bundle = skill?.runtimeProfile?.profile.dependencyBundle;
    if (!bundle) return undefined;
    const root = await this.verifyResourceRoot(skill);
    const lockPath = path.resolve(root, bundle.lockPath);
    if (!isWithin(root, lockPath)) throw new Error('Skill 依赖锁路径逃逸出 Skill 包');
    let raw: unknown;
    try {
      raw = JSON.parse((await readFile(lockPath)).toString('utf8')) as unknown;
    } catch (error) {
      throw new Error(`无法读取 Skill 依赖锁 ${bundle.lockPath}`, { cause: error });
    }
    const result = dependencyLockSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(
        `Skill 依赖锁格式无效：${result.error.issues.map((issue) => issue.message).join('；')}`,
      );
    }
    const wheelhouseRoot = bundle.wheelhousePath
      ? path.resolve(root, bundle.wheelhousePath)
      : undefined;
    if (wheelhouseRoot && !isWithin(root, wheelhouseRoot)) {
      throw new Error('Skill wheelhouse 路径逃逸出 Skill 包');
    }
    return {
      lock: result.data,
      ...(wheelhouseRoot ? { wheelhouseRoot } : {}),
    };
  }

  async readSkillInstruction(skill: SkillDetail): Promise<SkillInstruction> {
    const resourceRoot = await this.resolveResourceRoot(skill);
    const skillFilePath = path.join(resourceRoot, skillFileName);
    const content = await readFile(skillFilePath, 'utf8');
    return {
      skillId: skill.id,
      name: skill.name,
      instruction: stripFrontmatter(content),
    };
  }

  private async resolveBuiltinResource(resourceName: string): Promise<string> {
    for (const root of [this.roots.developmentBuiltinRoot, this.roots.installedBuiltinRoot]) {
      const resolvedRoot = path.resolve(root);
      const candidate = path.resolve(resolvedRoot, resourceName);
      if (!isWithin(resolvedRoot, candidate))
        throw new Error('Builtin resource path escapes its root');
      try {
        const info = await stat(candidate);
        if (info.isDirectory()) return candidate;
      } catch {
        // Try the installed root after an absent development resource.
      }
    }
    throw new Error(`Builtin Skill resource is not available: ${resourceName}`);
  }

  async registerBuiltinRelease(manifest: BuiltinReleaseManifest): Promise<SkillDetail[]> {
    if (manifest.formatVersion !== 1) throw new Error('Unsupported Skill release manifest version');
    const registered: SkillDetail[] = [];
    for (const entry of manifest.skills) {
      const source = await this.resolveBuiltinResource(entry.resourceName);
      const packageData = await readPackage(source);
      const actualHash = hashFiles(packageData.files);
      if (actualHash !== entry.contentHash) {
        throw new Error(
          `Builtin Skill content does not match its release manifest: ${entry.skillId}`,
        );
      }
      const existing = this.store.skills.get(entry.skillId);
      if (existing && existing.sourceKind !== 'builtin') {
        throw new Error(`Builtin Skill ID conflicts with a user Skill: ${entry.skillId}`);
      }
      const preference = this.store.skills.getTrustPreference(entry.skillId);
      const profileMatches = entry.profile
        ? existing?.runtimeProfile?.profileHash === entry.profileHash
        : existing?.runtimeProfile === undefined;
      const sameRelease =
        existing?.sourceKind === 'builtin' &&
        existing.revision.contentHash === entry.contentHash &&
        existing.revision.resourceKey === `builtin/${entry.resourceName}` &&
        profileMatches;
      if (sameRelease && existing) {
        if (
          preference !== 'revoked' &&
          !this.store.executions.findActiveGrant(
            entry.skillId,
            existing.revision.id,
            entry.profileHash,
          )
        ) {
          this.store.skills.saveTrustGrant({
            skillId: entry.skillId,
            revisionId: existing.revision.id,
            profileHash: entry.profileHash,
            dependencyFingerprint: entry.dependencyFingerprint,
            scopeHash: entry.scopeHash,
            source: 'builtin-release',
          });
        }
        registered.push(existing);
        continue;
      }
      this.store.transaction(() => {
        this.store.skills.save({
          id: entry.skillId,
          name: entry.name,
          description: entry.description,
          sourceKind: 'builtin',
          currentRevisionId: 'pending-revision',
        });
        const revisionId = this.store.skills.saveRevision({
          skillId: entry.skillId,
          contentHash: entry.contentHash,
          packageId: entry.skillId,
          ...(entry.originalVersion ? { originalVersion: entry.originalVersion } : {}),
          resourceKey: `builtin/${entry.resourceName}`,
          frontmatter: packageData.frontmatter,
        });
        let profileId: string | undefined;
        if (entry.profile) {
          profileId = this.store.skills.saveProfile({
            skillId: entry.skillId,
            profileHash: entry.profileHash,
            profile: entry.profile,
          });
        }
        this.store.skills.save({
          id: entry.skillId,
          name: entry.name,
          description: entry.description,
          sourceKind: 'builtin',
          currentRevisionId: revisionId,
          ...(profileId ? { currentProfileRevisionId: profileId } : {}),
        });
        if (preference !== 'revoked') {
          this.store.skills.saveTrustGrant({
            skillId: entry.skillId,
            revisionId,
            profileHash: entry.profileHash,
            dependencyFingerprint: entry.dependencyFingerprint,
            scopeHash: entry.scopeHash,
            source: 'builtin-release',
          });
        }
      });
      const skill = this.store.skills.get(entry.skillId);
      if (!skill) throw new Error(`Builtin Skill was not registered: ${entry.skillId}`);
      registered.push(skill);
    }
    return registered;
  }

  async copyAsUser(skillId: string): Promise<ImportedSkill> {
    const sourceSkill = this.store.skills.get(skillId);
    if (!sourceSkill) throw new Error('Skill does not exist');
    const source = await this.resolveResourceRoot(sourceSkill);
    const packageData = await readPackage(source);
    const contentHash = hashFiles(packageData.files);
    const userSkillId = randomUUID();
    const resourceRoot = await this.copyToStaging(packageData.files, userSkillId, contentHash);
    const resourceKey = `user/${userSkillId}/revisions/${contentHash}`;
    try {
      this.store.transaction(() => {
        this.store.skills.save({
          id: userSkillId,
          name: sourceSkill.name,
          description: sourceSkill.description,
          sourceKind: 'user',
          currentRevisionId: 'pending-revision',
        });
        const revisionId = this.store.skills.saveRevision({
          skillId: userSkillId,
          contentHash,
          ...(sourceSkill.revision.packageId ? { packageId: sourceSkill.revision.packageId } : {}),
          ...(sourceSkill.revision.originalVersion
            ? { originalVersion: sourceSkill.revision.originalVersion }
            : {}),
          resourceKey,
          frontmatter: sourceSkill.revision.frontmatter,
        });
        const profileId = sourceSkill.runtimeProfile
          ? this.store.skills.saveProfile({
              skillId: userSkillId,
              profileHash: sourceSkill.runtimeProfile.profileHash,
              profile: sourceSkill.runtimeProfile.profile,
            })
          : undefined;
        this.store.skills.save({
          id: userSkillId,
          name: sourceSkill.name,
          description: sourceSkill.description,
          sourceKind: 'user',
          currentRevisionId: revisionId,
          ...(profileId ? { currentProfileRevisionId: profileId } : {}),
        });
      });
      const skill = this.store.skills.get(userSkillId);
      if (!skill) throw new Error('User Skill copy was not registered');
      return { skill, contentHash, resourceRoot };
    } catch (error) {
      await rm(resourceRoot, { recursive: true, force: true });
      throw error;
    }
  }

  async revokeTrust(skillId: string, canceller?: SkillExecutionCanceller): Promise<number> {
    if (!this.store.skills.setTrustPreference(skillId, 'revoked')) {
      throw new Error('Skill does not exist');
    }
    return canceller ? canceller.cancelForSkill(skillId) : 0;
  }

  setTrustPreference(skillId: string, trusted: boolean): SkillDetail {
    if (!this.store.skills.setTrustPreference(skillId, trusted ? 'trusted' : 'untrusted')) {
      throw new Error('Skill does not exist');
    }
    const skill = this.store.skills.get(skillId);
    if (!skill) throw new Error('Skill was not available after trust preference update');
    return skill;
  }

  saveRuntimeProfile(skillId: string, profile: RuntimeProfileDraft): SkillDetail {
    const skill = this.store.skills.get(skillId);
    if (!skill) throw new Error('Skill does not exist');
    const profileHash = createHash('sha256').update(JSON.stringify(profile)).digest('hex');
    const profileId = this.store.skills.saveProfile({ skillId, profileHash, profile });
    this.store.skills.save({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      sourceKind: skill.sourceKind,
      currentRevisionId: skill.currentRevisionId,
      currentProfileRevisionId: profileId,
    });
    const updated = this.store.skills.get(skillId);
    if (!updated) throw new Error('Skill was not available after runtime profile update');
    return updated;
  }

  async exportDirectory(skillId: string, destination: string): Promise<string> {
    const skill = this.store.skills.get(skillId);
    if (!skill) throw new Error('Skill does not exist');
    const target = path.resolve(destination);
    const targetInfo = await stat(target).catch(() => undefined);
    if (targetInfo) throw new Error('Skill export destination already exists');
    const source = await this.resolveResourceRoot(skill);
    await copyDirectory(source, target);
    const manifest: SkillExportManifest = {
      formatVersion: 2,
      skillId: skill.revision.packageId ?? skill.id,
      name: skill.name,
      description: skill.description,
      packageVersion: skill.revision.originalVersion ?? '1.0.0',
      ...(skill.runtimeProfile ? { runtimeProfile: skill.runtimeProfile.profile } : {}),
    };
    await writeFile(
      path.join(target, 'betterwork.skill.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      {
        flag: 'wx',
      },
    );
    return target;
  }

  async deleteUserSkill(skillId: string): Promise<boolean> {
    const skill = this.store.skills.get(skillId);
    if (!skill) throw new Error('Skill does not exist');
    if (skill.sourceKind !== 'user')
      throw new Error('Builtin Skill cannot be deleted; copy it first');
    const resourceRoot = await this.resolveResourceRoot(skill);
    if (!(await stat(resourceRoot)).isDirectory())
      throw new Error('Skill resource is not a directory');
    const deleted = this.store.skills.delete(skillId);
    if (deleted)
      await rm(path.join(this.roots.userRoot, skillId), { recursive: true, force: true });
    return deleted;
  }
}
