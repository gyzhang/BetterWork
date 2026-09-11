import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { SkillInstruction } from '@betterwork/agent-core';
import type { RuntimeProfileDraft, SkillDetail } from '@betterwork/agent-protocol';
import { parse } from 'yaml';

import { type AppStore } from '../persistence';
import { suggestedPptProfile } from './ppt-generation-preset';

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
): Promise<{ files: SkillFile[]; frontmatter: SkillFrontmatter }> => {
  const root = path.resolve(sourceRoot);
  const rootInfo = await stat(root);
  if (!rootInfo.isDirectory()) throw new Error('Skill source must be a directory');
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
      const suggestedProfile = suggestedPptProfile(contentHash);
      if (suggestedProfile) this.saveRuntimeProfile(skillId, suggestedProfile);
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

  async verifyResourceRoot(skill: SkillDetail): Promise<string> {
    const root = await this.resolveResourceRoot(skill);
    const data = await readPackage(root);
    if (hashFiles(data.files) !== skill.revision.contentHash)
      throw new Error('Skill 内容 hash 已变化，请重新导入并确认信任');
    return root;
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
