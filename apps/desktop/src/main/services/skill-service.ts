import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { SkillDetail } from '@betterwork/agent-protocol';
import { parse } from 'yaml';

import { type AppStore } from '../persistence';

const skillFileName = 'SKILL.md';
const maxFiles = 2_000;
const maxBytes = 50 * 1024 * 1024;

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
  formatVersion: 1;
  skillId: string;
  name: string;
  description: string;
  runtimeProfile?: SkillDetail['runtimeProfile'];
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
  const value: unknown = parse(lines.slice(1, end).join('\n'));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SKILL.md frontmatter must be a YAML mapping');
  }
  return value as SkillFrontmatter;
};

const readPackage = async (
  sourceRoot: string,
): Promise<{ files: SkillFile[]; frontmatter: SkillFrontmatter }> => {
  const root = path.resolve(sourceRoot);
  const rootInfo = await stat(root);
  if (!rootInfo.isDirectory()) throw new Error('Skill source must be a directory');
  const files: SkillFile[] = [];
  let totalBytes = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
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
  const skillFile = files.find((file) => file.relativePath === skillFileName);
  if (!skillFile) throw new Error('Skill package must contain SKILL.md at its root');
  return { files, frontmatter: parseFrontmatter(skillFile.bytes.toString('utf8')) };
};

const hashFiles = (files: readonly SkillFile[]): string => {
  const hash = createHash('sha256');
  for (const file of files) hash.update(file.relativePath).update('\0').update(file.bytes);
  return hash.digest('hex');
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

  async importDirectory(sourceRoot: string): Promise<ImportedSkill> {
    const source = path.resolve(sourceRoot);
    const packageData = await readPackage(source);
    const contentHash = hashFiles(packageData.files);
    const skillId = randomUUID();
    const resourceKey = `user/${skillId}/revisions/${contentHash}`;
    const resourceRoot = await this.copyToStaging(packageData.files, skillId, contentHash);
    const name =
      typeof packageData.frontmatter.name === 'string' && packageData.frontmatter.name.trim()
        ? packageData.frontmatter.name.trim()
        : path.basename(source);
    const description =
      typeof packageData.frontmatter.description === 'string'
        ? packageData.frontmatter.description
        : '';
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
          ...(typeof packageData.frontmatter.version === 'string'
            ? { originalVersion: packageData.frontmatter.version }
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
      const skill = this.store.skills.get(skillId);
      if (!skill) throw new Error('Imported Skill was not available after database registration');
      return { skill, contentHash, resourceRoot };
    } catch (error) {
      await rm(resourceRoot, { recursive: true, force: true });
      throw error;
    }
  }

  resolveResourceRoot(skill: SkillDetail): string {
    if (skill.sourceKind === 'user') return this.userRevisionRoot(skill);
    const roots = [this.roots.developmentBuiltinRoot, this.roots.installedBuiltinRoot];
    for (const root of roots) {
      const candidate = path.resolve(root, skill.name);
      if (isWithin(path.resolve(root), candidate)) return candidate;
    }
    throw new Error(`Built-in Skill resource is not available: ${skill.id}`);
  }

  async exportDirectory(skillId: string, destination: string): Promise<string> {
    const skill = this.store.skills.get(skillId);
    if (!skill) throw new Error('Skill does not exist');
    const target = path.resolve(destination);
    const targetInfo = await stat(target).catch(() => undefined);
    if (targetInfo) throw new Error('Skill export destination already exists');
    const source = this.resolveResourceRoot(skill);
    await copyDirectory(source, target);
    const manifest: SkillExportManifest = {
      formatVersion: 1,
      skillId: skill.id,
      name: skill.name,
      description: skill.description,
      ...(skill.runtimeProfile ? { runtimeProfile: skill.runtimeProfile } : {}),
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
}
