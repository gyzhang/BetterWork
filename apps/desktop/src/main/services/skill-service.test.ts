import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

  it('imports a ZIP Skill package with one wrapper directory without extracting outside its root', async () => {
    const directory = temporaryDirectory();
    const archive = new JSZip();
    archive.file('packaged-skill/SKILL.md', '---\nname: ZIP Skill\n---\n# Instructions');
    archive.file('packaged-skill/scripts/run.py', 'print("must not run")');
    const archivePath = path.join(directory, 'packaged-skill.zip');
    writeFileSync(archivePath, await archive.generateAsync({ type: 'nodebuffer' }));
    const store = AppStore.open(path.join(directory, 'app.sqlite'));
    const service = new SkillService(store, rootsFor(directory));

    const imported = await service.importSource(archivePath);

    expect(imported.skill.name).toBe('ZIP Skill');
    expect(existsSync(path.join(imported.resourceRoot, 'scripts', 'run.py'))).toBe(true);
    expect(existsSync(path.join(directory, 'scripts', 'run.py'))).toBe(false);
    store.close();
  });

  it('downloads HTTPS Skill ZIP packages with a byte limit and rejects credentialed or insecure URLs', async () => {
    const directory = temporaryDirectory();
    const archive = new JSZip();
    archive.file('SKILL.md', '---\nname: URL Skill\n---\n# Instructions');
    const bytes = await archive.generateAsync({ type: 'nodebuffer' });
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(bytes)));
    const store = AppStore.open(path.join(directory, 'app.sqlite'));
    const service = new SkillService(store, rootsFor(directory), fetcher);

    const imported = await service.importFromUrl('https://skills.example.com/url-skill.zip');

    expect(imported.skill.name).toBe('URL Skill');
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(service.importFromUrl('http://skills.example.com/url-skill.zip')).rejects.toThrow(
      /HTTPS/iu,
    );
    await expect(
      service.importFromUrl('https://user:secret@skills.example.com/url-skill.zip'),
    ).rejects.toThrow(/HTTPS/iu);
    expect(fetcher).toHaveBeenCalledOnce();
    store.close();
  });

  it('shows static runtime clues with source locations and never executes imported files', async () => {
    const directory = temporaryDirectory();
    const source = path.join(directory, 'static-discovery');
    mkdirSync(path.join(source, 'scripts'), { recursive: true });
    writeFileSync(path.join(source, 'SKILL.md'), '---\nname: Static discovery\n---\n');
    writeFileSync(path.join(source, 'requirements.txt'), 'python-pptx==1.0.2\n');
    writeFileSync(
      path.join(source, 'scripts', 'run.py'),
      [
        'from pathlib import Path',
        'import os',
        'SKILL_DIR = Path(__file__).resolve().parent.parent',
        "DIAGRAMS_DIR = SKILL_DIR / 'references' / 'diagrams'",
        "STYLES_DIR = SKILL_DIR / 'references' / 'styles'",
        "PPTM_HOME = Path(os.environ.get('PPTM_HOME', '/local/default'))",
        'raise RuntimeError("must not run")',
      ].join('\n'),
    );
    writeFileSync(
      path.join(source, 'README.md'),
      'Use system Python3 and run `pip install python-pptx`. Set PPTM_HOME to your local ppt-master checkout before running.\n',
    );
    const store = AppStore.open(path.join(directory, 'app.sqlite'));
    const service = new SkillService(store, rootsFor(directory));
    const imported = await service.importDirectory(source);

    const detail = await service.getDetail(imported.skill.id);
    expect(detail?.runtimeDiscovery).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'python-script',
          sourcePath: 'scripts/run.py',
          lineNumber: 1,
        }),
        expect.objectContaining({
          kind: 'dependency-file',
          sourcePath: 'requirements.txt',
          lineNumber: 1,
        }),
        expect.objectContaining({
          kind: 'environment-variable',
          sourcePath: 'README.md',
          label: '发现外部目录变量 PPTM_HOME',
        }),
        expect.objectContaining({
          kind: 'toolchain-name',
          sourcePath: 'README.md',
          label: '发现外部工具链引用 ppt-master',
        }),
        expect.objectContaining({
          kind: 'package-install-hint',
          sourcePath: 'README.md',
          label: '发现 Python 包安装提示 python-pptx',
        }),
        expect.objectContaining({
          kind: 'python-runtime-hint',
          sourcePath: 'README.md',
          label: '发现 Python 运行环境说明',
        }),
      ]),
    );
    expect(
      detail?.runtimeDiscovery
        ?.filter((finding) => finding.kind === 'environment-variable')
        .map((finding) => finding.label),
    ).toEqual(['发现外部目录变量 PPTM_HOME']);
    expect(readFileSync(path.join(imported.resourceRoot, 'scripts', 'run.py'), 'utf8')).toContain(
      'must not run',
    );
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
    const profile = {
      commands: [],
      environmentRequirements: [],
      pythonRequirement: '3.12',
      dependencyLockId: 'sample-lock',
      toolchainRequirements: [
        { id: 'ppt-master', name: 'PPT Master', environmentVariable: 'PPTM_HOME' },
      ],
      outputContract: { outputPaths: [] },
    };
    service.saveRuntimeProfile(imported.skill.id, profile);
    const destination = path.join(directory, 'exported');
    await service.exportDirectory(imported.skill.id, destination);

    expect(readFileSync(path.join(destination, 'SKILL.md'), 'utf8')).toContain('body');
    const manifest = JSON.parse(
      readFileSync(path.join(destination, 'betterwork.skill.json'), 'utf8'),
    ) as { skillId: string; trustGrant?: unknown; apiKey?: unknown };
    expect(manifest.skillId).toBe(imported.skill.id);
    expect(manifest.trustGrant).toBeUndefined();
    expect(manifest.apiKey).toBeUndefined();

    const reimported = await service.importDirectory(destination);
    expect(reimported.contentHash).toBe(imported.contentHash);
    expect(reimported.skill.runtimeProfile?.profile).toEqual(profile);
    store.close();
  });

  it('loads the exact dependency lock and optional wheelhouse from a versioned Skill package', async () => {
    const directory = temporaryDirectory();
    const source = path.join(directory, 'skill-package-v2');
    mkdirSync(path.join(source, 'runtime', 'locks'), { recursive: true });
    mkdirSync(path.join(source, 'runtime', 'wheelhouse'), { recursive: true });
    writeFileSync(path.join(source, 'SKILL.md'), '---\nname: Packaged Skill\n---\n# Skill\n');
    const lock = {
      lockVersion: 1,
      platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
      pythonRequirement: '3.12',
      packages: [],
      importProbes: [],
    };
    writeFileSync(
      path.join(source, 'runtime', 'locks', 'darwin-arm64-cp312.json'),
      JSON.stringify(lock),
    );
    writeFileSync(path.join(source, 'runtime', 'wheelhouse', 'cache-marker.whl'), 'cached wheel');
    writeFileSync(
      path.join(source, 'betterwork.skill.json'),
      JSON.stringify({
        formatVersion: 2,
        skillId: 'vendor.packaged-skill',
        name: 'Packaged Skill',
        description: 'package-owned runtime declaration',
        packageVersion: '1.2.0',
        runtimeProfile: {
          commands: [],
          environmentRequirements: [],
          pythonRequirement: '3.12',
          dependencyBundle: {
            id: 'packaged-skill-darwin-arm64-cp312',
            lockPath: 'runtime/locks/darwin-arm64-cp312.json',
            wheelhousePath: 'runtime/wheelhouse',
          },
          outputContract: { outputPaths: [] },
        },
      }),
    );
    const store = AppStore.open(path.join(directory, 'app.sqlite'));
    const service = new SkillService(store, rootsFor(directory));

    const imported = await service.importDirectory(source);
    const assets = await service.getDependencyAssets(imported.skill.id);
    expect(imported.skill.revision.packageId).toBe('vendor.packaged-skill');
    expect(imported.skill.runtimeProfile?.profile.dependencyBundle).toEqual({
      id: 'packaged-skill-darwin-arm64-cp312',
      lockPath: 'runtime/locks/darwin-arm64-cp312.json',
      wheelhousePath: 'runtime/wheelhouse',
    });
    expect(assets?.lock).toEqual(lock);
    expect(assets?.wheelhouseRoot).toBe(path.join(imported.resourceRoot, 'runtime', 'wheelhouse'));

    const exportRoot = path.join(directory, 'exported-package');
    await service.exportDirectory(imported.skill.id, exportRoot);
    const exportedManifest = JSON.parse(
      readFileSync(path.join(exportRoot, 'betterwork.skill.json'), 'utf8'),
    ) as { skillId: string };
    expect(exportedManifest.skillId).toBe('vendor.packaged-skill');
    const reimported = await service.importDirectory(exportRoot);
    expect(reimported.skill.revision.packageId).toBe('vendor.packaged-skill');

    writeFileSync(
      path.join(imported.resourceRoot, 'runtime', 'wheelhouse', 'cache-marker.whl'),
      'missing or replaced cache payload',
    );
    await expect(service.getDependencyAssets(imported.skill.id)).resolves.toMatchObject({ lock });
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

    const firstRegistration = await service.registerBuiltinRelease(
      manifest(contentHash(firstContent)),
    );
    expect(firstRegistration[0]?.revision.contentHash).toBe(contentHash(firstContent));
    const secondRegistration = await service.registerBuiltinRelease(
      manifest(contentHash(firstContent)),
    );
    expect(secondRegistration[0]?.revision.id).toBe(firstRegistration[0]?.revision.id);
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

  it('excludes operating system metadata from copies and content hashes', async () => {
    const directory = temporaryDirectory();
    const clean = path.join(directory, 'clean');
    const junky = path.join(directory, 'junky');
    for (const source of [clean, junky]) {
      mkdirSync(path.join(source, 'scripts'), { recursive: true });
      writeFileSync(
        path.join(source, 'SKILL.md'),
        '---\nname: 样本能力\ndescription: 描述\n---\n# Instructions\n',
      );
      writeFileSync(path.join(source, 'scripts', 'run.py'), 'print(1)\n');
    }
    writeFileSync(path.join(junky, '.DS_Store'), 'finder metadata');
    writeFileSync(path.join(junky, '._SKILL.md'), 'apple double');
    writeFileSync(path.join(junky, 'scripts', 'Thumbs.db'), 'explorer metadata');

    const roots = rootsFor(directory);
    const store = AppStore.open(path.join(directory, 'app.sqlite'));
    const service = new SkillService(store, roots);

    const junkyImport = await service.importDirectory(junky);
    const cleanImport = await service.importDirectory(clean);
    const junkyDetail = store.skills.get(junkyImport.skill.id);
    const cleanDetail = store.skills.get(cleanImport.skill.id);
    expect(junkyDetail?.revision.contentHash).toBe(cleanDetail?.revision.contentHash);

    const copiedNames: string[] = [];
    const collect = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (entry.isDirectory()) collect(path.join(current, entry.name));
        else copiedNames.push(entry.name);
      }
    };
    collect(path.join(roots.userRoot, junkyImport.skill.id));
    expect(copiedNames).not.toContain('.DS_Store');
    expect(copiedNames).not.toContain('._SKILL.md');
    expect(copiedNames).not.toContain('Thumbs.db');
    expect(copiedNames).toContain('run.py');
    store.close();
  });

  it('reads skill instruction content with frontmatter stripped', async () => {
    const directory = temporaryDirectory();
    const source = path.join(directory, 'instruction-skill');
    mkdirSync(source, { recursive: true });
    const skillContent =
      '---\nname: 指令测试\ndescription: 测试指令读取\n---\n\n# 指令内容\n\n请遵循这些说明。';
    writeFileSync(path.join(source, 'SKILL.md'), skillContent);
    const roots = rootsFor(directory);
    const store = AppStore.open(path.join(directory, 'app.sqlite'));
    const service = new SkillService(store, roots);
    const imported = await service.importDirectory(source);

    const instruction = await service.readSkillInstruction(imported.skill);
    expect(instruction.skillId).toBe(imported.skill.id);
    expect(instruction.name).toBe('指令测试');
    expect(instruction.instruction).toContain('# 指令内容');
    expect(instruction.instruction).toContain('请遵循这些说明');
    expect(instruction.instruction).not.toContain('---');
    expect(instruction.instruction).not.toContain('name:');
    store.close();
  });

  it('prefers the development root when both builtin roots contain the resource', async () => {
    const directory = temporaryDirectory();
    const roots = rootsFor(directory);
    const devContent = '---\nname: Example\n---\ndev';
    const installedContent = '---\nname: Example\n---\ninstalled';
    const devBuiltin = path.join(roots.developmentBuiltinRoot, 'example');
    const installedBuiltin = path.join(roots.installedBuiltinRoot, 'example');
    mkdirSync(devBuiltin, { recursive: true });
    mkdirSync(installedBuiltin, { recursive: true });
    writeFileSync(path.join(devBuiltin, 'SKILL.md'), devContent);
    writeFileSync(path.join(installedBuiltin, 'SKILL.md'), installedContent);
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
          contentHash: contentHash(devContent),
          profileHash: 'profile',
          dependencyFingerprint: 'deps',
          scopeHash: 'scope',
        },
      ],
    });

    const skill = store.skills.get('builtin-example');
    expect(skill).toBeDefined();
    expect(skill?.sourceKind).toBe('builtin');
    store.close();
  });

  it('falls back to the installed root when the development root lacks the resource', async () => {
    const directory = temporaryDirectory();
    const roots = rootsFor(directory);
    const installedContent = '---\nname: Example\n---\ninstalled';
    const installedBuiltin = path.join(roots.installedBuiltinRoot, 'example');
    mkdirSync(installedBuiltin, { recursive: true });
    writeFileSync(path.join(installedBuiltin, 'SKILL.md'), installedContent);
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
          contentHash: contentHash(installedContent),
          profileHash: 'profile',
          dependencyFingerprint: 'deps',
          scopeHash: 'scope',
        },
      ],
    });

    expect(store.skills.get('builtin-example')).toBeDefined();
    store.close();
  });

  it('rejects builtin registration when no root contains the resource', async () => {
    const directory = temporaryDirectory();
    const roots = rootsFor(directory);
    const store = AppStore.open(path.join(directory, 'app.sqlite'));
    const service = new SkillService(store, roots);

    await expect(
      service.registerBuiltinRelease({
        formatVersion: 1,
        skills: [
          {
            skillId: 'builtin-missing',
            resourceName: 'missing',
            name: 'Missing',
            description: 'Not present on disk',
            contentHash: 'does-not-matter',
            profileHash: 'profile',
            dependencyFingerprint: 'deps',
            scopeHash: 'scope',
          },
        ],
      }),
    ).rejects.toThrow(/not available/iu);
    expect(store.skills.get('builtin-missing')).toBeUndefined();
    store.close();
  });

  it('preserves user copy resources after the builtin source is updated', async () => {
    const directory = temporaryDirectory();
    const roots = rootsFor(directory);
    const builtin = path.join(roots.developmentBuiltinRoot, 'example');
    mkdirSync(builtin, { recursive: true });
    const originalContent = '---\nname: Example\n---\noriginal';
    writeFileSync(path.join(builtin, 'SKILL.md'), originalContent);
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
          contentHash: contentHash(originalContent),
          profileHash: 'profile',
          dependencyFingerprint: 'deps',
          scopeHash: 'scope',
        },
      ],
    });
    const copied = await service.copyAsUser('builtin-example');
    expect(readFileSync(path.join(copied.resourceRoot, 'SKILL.md'), 'utf8')).toContain('original');

    const updatedContent = '---\nname: Example\n---\nupdated';
    writeFileSync(path.join(builtin, 'SKILL.md'), updatedContent);
    await service.registerBuiltinRelease({
      formatVersion: 1,
      skills: [
        {
          skillId: 'builtin-example',
          resourceName: 'example',
          name: 'Example',
          description: 'Example',
          contentHash: contentHash(updatedContent),
          profileHash: 'profile',
          dependencyFingerprint: 'deps',
          scopeHash: 'scope',
        },
      ],
    });

    expect(readFileSync(path.join(copied.resourceRoot, 'SKILL.md'), 'utf8')).toContain('original');
    store.close();
  });

  it('allows a user Skill and a builtin Skill to share the same display name', async () => {
    const directory = temporaryDirectory();
    const roots = rootsFor(directory);
    const builtin = path.join(roots.developmentBuiltinRoot, 'assistant');
    mkdirSync(builtin, { recursive: true });
    const builtinContent = '---\nname: Assistant\n---\nbuiltin';
    writeFileSync(path.join(builtin, 'SKILL.md'), builtinContent);

    const userSource = path.join(directory, 'user-assistant');
    mkdirSync(userSource, { recursive: true });
    const userContent = '---\nname: Assistant\n---\nuser';
    writeFileSync(path.join(userSource, 'SKILL.md'), userContent);

    const store = AppStore.open(path.join(directory, 'app.sqlite'));
    const service = new SkillService(store, roots);

    await service.registerBuiltinRelease({
      formatVersion: 1,
      skills: [
        {
          skillId: 'builtin-assistant',
          resourceName: 'assistant',
          name: 'Assistant',
          description: 'Builtin assistant',
          contentHash: contentHash(builtinContent),
          profileHash: 'profile',
          dependencyFingerprint: 'deps',
          scopeHash: 'scope',
        },
      ],
    });
    const imported = await service.importDirectory(userSource);

    const builtinSkill = store.skills.get('builtin-assistant');
    const userSkill = store.skills.get(imported.skill.id);
    expect(builtinSkill?.name).toBe('Assistant');
    expect(userSkill?.name).toBe('Assistant');
    expect(builtinSkill?.sourceKind).toBe('builtin');
    expect(userSkill?.sourceKind).toBe('user');
    store.close();
  });

  it('does not include sensitive material in the builtin resource directory', () => {
    const resourcesRoot = path.resolve(__dirname, '../../../../../../resources/skills');
    if (!existsSync(resourcesRoot)) return;
    const forbidden: string[] = [];
    const scan = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) {
          scan(absolute);
          continue;
        }
        const lower = entry.name.toLowerCase();
        if (
          lower.endsWith('.key') ||
          lower.endsWith('.pem') ||
          lower.endsWith('.p12') ||
          lower.endsWith('.sqlite') ||
          lower.endsWith('.db') ||
          lower === '.env' ||
          lower.endsWith('.env.local')
        ) {
          forbidden.push(path.relative(resourcesRoot, absolute));
        }
      }
    };
    scan(resourcesRoot);
    expect(forbidden).toEqual([]);
  });
});
import { createHash } from 'node:crypto';
