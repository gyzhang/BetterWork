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
import { SkillService } from './skill-service';

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
});
