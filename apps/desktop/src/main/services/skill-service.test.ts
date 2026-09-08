import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { type BuiltinReleaseManifest, SkillService } from './skill-service';

const temporaryDirectories: string[] = [];
const temporaryDirectory = (): string => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-skill-service-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const rootsFor = (directory: string) => ({
  developmentBuiltinRoot: path.join(directory, 'development'),
  installedBuiltinRoot: path.join(directory, 'installed'),
  userRoot: path.join(directory, 'user-skills'),
});

const contentHash = (content: string): string =>
  createHash('sha256').update('SKILL.md').update('\0').update(content).digest('hex');

describe('SkillService', () => {
  it('imports a complete directory as an immutable user revision without executing it', async () => {
    const directory = temporaryDirectory();
    const source = path.join(directory, 'ppt skill');
    mkdirSync(path.join(source, 'scripts'), { recursive: true });
    writeFileSync(
      path.join(source, 'SKILL.md'),
      '---\nname: PPT 生成\nversion: v20260907\ncustom: keep-me\ndescription: 生成可编辑演示\n---\n\n# Instructions\n',
    );
    writeFileSync(path.join(source, 'scripts', 'run.py'), 'print("must not run")\n');
    writeFileSync(path.join(source, '参考 文件.md'), '中文和空格路径');
    const original = readFileSync(path.join(source, 'SKILL.md'));
    const roots = rootsFor(directory);
    const store = AppStore.open(path.join(directory, 'app.sqlite'));
    const service = new SkillService(store, roots);

    const imported = await service.importDirectory(source);
    expect(imported.skill).toMatchObject({
      name: 'PPT 生成',
      sourceKind: 'user',
      trustStatus: 'untrusted',
      revision: { originalVersion: 'v20260907', frontmatter: { custom: 'keep-me' } },
    });
    expect(readFileSync(path.join(source, 'SKILL.md'))).toEqual(original);
    expect(existsSync(path.join(imported.resourceRoot, 'scripts', 'run.py'))).toBe(true);
    expect(existsSync(path.join(imported.resourceRoot, '参考 文件.md'))).toBe(true);
    expect(lstatSync(imported.resourceRoot).isDirectory()).toBe(true);
    store.close();
  });

  it('accepts flat frontmatter descriptions containing an unquoted colon', async () => {
    const directory = temporaryDirectory();
    const source = path.join(directory, 'ppt-generation-expert');
    mkdirSync(source, { recursive: true });
    writeFileSync(
      path.join(source, 'SKILL.md'),
      '---\nname: ppt-generation-expert\ndescription_en: Company-template PPT engine — Boundary: does not edit existing files.\nversion: v20260907\nagent_created: true\ndisable: false\n---\n# Instructions\n',
    );
    const roots = rootsFor(directory);
    const store = AppStore.open(path.join(directory, 'app.sqlite'));
    const service = new SkillService(store, roots);

    const imported = await service.importDirectory(source);
    expect(imported.skill.name).toBe('ppt-generation-expert');
    expect(imported.skill.revision.frontmatter).toMatchObject({
      description_en: 'Company-template PPT engine — Boundary: does not edit existing files.',
      agent_created: true,
      disable: false,
    });
    store.close();
  });

  it('rejects symbolic links and preserves no visible staging directory', async () => {
    const directory = temporaryDirectory();
    const source = path.join(directory, 'unsafe');
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, 'SKILL.md'), '# skill');
    symlinkSync(path.join(source, 'SKILL.md'), path.join(source, 'linked.md'));
    const roots = rootsFor(directory);
    const store = AppStore.open(path.join(directory, 'app.sqlite'));
    const service = new SkillService(store, roots);

    await expect(service.importDirectory(source)).rejects.toThrow(/symbolic links/iu);
    expect(existsSync(roots.userRoot)).toBe(false);
    store.close();
  });

  it('exports resources plus host configuration without trust grants or secrets', async () => {
    const directory = temporaryDirectory();
    const source = path.join(directory, 'source');
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, 'SKILL.md'), '---\nname: Exported\n---\nbody');
    const roots = rootsFor(directory);
    const store = AppStore.open(path.join(directory, 'app.sqlite'));
    const service = new SkillService(store, roots);
    const imported = await service.importDirectory(source);
    const destination = path.join(directory, 'exported');
    await service.exportDirectory(imported.skill.id, destination);

    expect(readFileSync(path.join(destination, 'SKILL.md'), 'utf8')).toContain('body');
    const manifest = JSON.parse(
      readFileSync(path.join(destination, 'betterwork.skill.json'), 'utf8'),
    ) as { skillId: string; trustGrant?: unknown; apiKey?: unknown };
    expect(manifest.skillId).toBe(imported.skill.id);
    expect(manifest.trustGrant).toBeUndefined();
    expect(manifest.apiKey).toBeUndefined();
    store.close();
  });

  it('verifies built-in release content, defaults trust, preserves overrides, and copies without grants', async () => {
    const directory = temporaryDirectory();
    const roots = rootsFor(directory);
    const builtin = path.join(roots.developmentBuiltinRoot, 'example');
    mkdirSync(builtin, { recursive: true });
    const firstContent = '---\nname: Example\n---\nfirst';
    writeFileSync(path.join(builtin, 'SKILL.md'), firstContent);
    const manifest = (hash: string): BuiltinReleaseManifest => ({
      formatVersion: 1,
      skills: [
        {
          skillId: 'builtin-example',
          resourceName: 'example',
          name: 'Example',
          description: 'A generic built-in example',
          contentHash: hash,
          profileHash: 'profile-1',
          dependencyFingerprint: 'deps-1',
          scopeHash: 'scope-1',
          profile: {
            commands: [],
            environmentRequirements: [],
            outputContract: { outputPaths: [] },
          },
        },
      ],
    });
    const store = AppStore.open(path.join(directory, 'app.sqlite'));
    const service = new SkillService(store, roots);
    await expect(service.registerBuiltinRelease(manifest('wrong-hash'))).rejects.toThrow(
      /does not match/iu,
    );
    expect(store.skills.get('builtin-example')).toBeUndefined();

    await service.registerBuiltinRelease(manifest(contentHash(firstContent)));
    expect(store.skills.get('builtin-example')).toMatchObject({
      sourceKind: 'builtin',
      trustStatus: 'trusted',
    });
    store.skills.setEnabled('builtin-example', false);
    await service.revokeTrust('builtin-example');
    const copied = await service.copyAsUser('builtin-example');
    expect(copied.skill).toMatchObject({
      sourceKind: 'user',
      trustStatus: 'untrusted',
      runtimeProfile: { profileHash: 'profile-1' },
    });
    expect(copied.skill.id).not.toBe('builtin-example');

    const secondContent = '---\nname: Example\n---\nsecond';
    writeFileSync(path.join(builtin, 'SKILL.md'), secondContent);
    await service.registerBuiltinRelease(manifest(contentHash(secondContent)));
    expect(store.skills.get('builtin-example')).toMatchObject({
      enabled: false,
      trustStatus: 'revoked',
    });
    store.close();
  });

  it('routes trust revocation to an injected canceller without inventing executions', async () => {
    const directory = temporaryDirectory();
    const source = path.join(directory, 'user-source');
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, 'SKILL.md'), '# user skill');
    const roots = rootsFor(directory);
    const store = AppStore.open(path.join(directory, 'app.sqlite'));
    const service = new SkillService(store, roots);
    const imported = await service.importDirectory(source);
    const cancelled: string[] = [];
    const count = await service.revokeTrust(imported.skill.id, {
      cancelForSkill: async (skillId) => {
        cancelled.push(skillId);
        return 0;
      },
    });
    expect(count).toBe(0);
    expect(cancelled).toEqual([imported.skill.id]);
    expect(store.skills.get(imported.skill.id)?.trustStatus).toBe('revoked');
    store.close();
  });

  it('deletes a user Skill resource and cascades its database records', async () => {
    const directory = temporaryDirectory();
    const source = path.join(directory, 'user-source');
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, 'SKILL.md'), '# user skill');
    const roots = rootsFor(directory);
    const store = AppStore.open(path.join(directory, 'app.sqlite'));
    const service = new SkillService(store, roots);
    const imported = await service.importDirectory(source);

    await expect(service.deleteUserSkill(imported.skill.id)).resolves.toBe(true);
    expect(store.skills.get(imported.skill.id)).toBeUndefined();
    expect(existsSync(path.join(roots.userRoot, imported.skill.id))).toBe(false);
    store.close();
  });

  it('does not delete built-in Skills', async () => {
    const directory = temporaryDirectory();
    const roots = rootsFor(directory);
    const builtin = path.join(roots.developmentBuiltinRoot, 'example');
    mkdirSync(builtin, { recursive: true });
    const content = '---\nname: Example\n---\nbody';
    writeFileSync(path.join(builtin, 'SKILL.md'), content);
    const store = AppStore.open(path.join(directory, 'app.sqlite'));
    const service = new SkillService(store, roots);
    await service.registerBuiltinRelease({
      formatVersion: 1,
      skills: [
        {
          skillId: 'builtin-example',
          resourceName: 'example',
          name: 'Example',
          description: 'Example',
          contentHash: contentHash(content),
          profileHash: 'profile',
          dependencyFingerprint: 'dependencies',
          scopeHash: 'scope',
          profile: {
            commands: [],
            environmentRequirements: [],
            outputContract: { outputPaths: [] },
          },
        },
      ],
    });

    await expect(service.deleteUserSkill('builtin-example')).rejects.toThrow(/cannot be deleted/iu);
    expect(existsSync(path.join(builtin, 'SKILL.md'))).toBe(true);
    store.close();
  });
});
import { createHash } from 'node:crypto';
