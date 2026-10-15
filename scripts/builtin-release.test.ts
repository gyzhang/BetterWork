import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import { AppStore } from '../apps/desktop/src/main/persistence';
import {
  type BuiltinExpertReleaseManifest,
  ExpertService,
} from '../apps/desktop/src/main/services/expert-service';
import {
  computeDependencyFingerprint,
  computeDependencyLockHash,
} from '../apps/desktop/src/main/services/skill-dependency-service';
import {
  type BuiltinReleaseManifest,
  SkillService,
} from '../apps/desktop/src/main/services/skill-service';

it('registers the built-in PPT generation Skill and research-and-reporting Expert from release resources', async () => {
  const resources = fileURLToPath(new URL('../resources/', import.meta.url));
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-release-consumers-'));
  const store = AppStore.open(':memory:');
  try {
    const skillContent = readFileSync(path.join(resources, 'skills/release-manifest.json'), 'utf8');
    const expertContent = readFileSync(
      path.join(resources, 'experts/release-manifest.json'),
      'utf8',
    );
    const skills = JSON.parse(skillContent) as BuiltinReleaseManifest;
    const experts = JSON.parse(expertContent) as BuiltinExpertReleaseManifest;
    expect(skills.formatVersion).toBe(1);
    expect(experts.formatVersion).toBe(1);
    expect(skills.skills.map((entry) => entry.skillId)).toEqual(['ppt-generation-expert']);
    expect(experts.experts.map((entry) => entry.expertId)).toEqual([
      'builtin-research-and-reporting',
    ]);
    const skillService = new SkillService(store, {
      developmentBuiltinRoot: path.join(resources, 'skills'),
      installedBuiltinRoot: path.join(directory, 'installed'),
      userRoot: path.join(directory, 'user'),
    });
    const registeredSkills = await skillService.registerBuiltinRelease(skills);
    expect(registeredSkills).toHaveLength(1);
    const skill = store.skills.get('ppt-generation-expert');
    expect(skill).toMatchObject({
      id: 'ppt-generation-expert',
      name: 'PPT 生成（中电金信模板）',
      sourceKind: 'builtin',
      enabled: true,
      trustStatus: 'trusted',
      revision: {
        originalVersion: 'v20261007.5',
        resourceKey: 'builtin/ppt-generation-expert',
      },
      runtimeProfile: {
        profile: {
          pythonRequirement: '3.12',
          dependencyBundle: {
            id: 'ppt-generation-expert-darwin-arm64-cp312',
          },
          toolchainRequirements: [{ id: 'ppt-master', versionHint: '6.6.0' }],
        },
      },
    });
    const skillEntry = skills.skills[0];
    if (!skill || !skill.runtimeProfile || !skillEntry) {
      throw new Error('Built-in PPT Skill registration is incomplete');
    }
    const dependencyAssets = await skillService.getDependencyAssets(skill.id);
    if (!dependencyAssets) throw new Error('Built-in PPT Skill dependency lock is missing');
    const computedProfileHash = createHash('sha256')
      .update(JSON.stringify(skill.runtimeProfile.profile))
      .digest('hex');
    const dependencyFingerprint = computeDependencyFingerprint({
      lockHash: computeDependencyLockHash(dependencyAssets.lock),
    });
    const scopeHash = createHash('sha256')
      .update(
        JSON.stringify({
          profileHash: computedProfileHash,
          commands: skill.runtimeProfile.profile.commands
            .map((command) => command.commandId)
            .sort(),
        }),
      )
      .digest('hex');
    expect(skill.runtimeProfile.profileHash).toBe(skillEntry.profileHash);
    expect(computedProfileHash).toBe(skillEntry.profileHash);
    expect(dependencyFingerprint).toBe(skillEntry.dependencyFingerprint);
    expect(scopeHash).toBe(skillEntry.scopeHash);
    expect(
      store.executions.findActiveGrant(
        skill.id,
        skill.revision.id,
        skill.runtimeProfile.profileHash,
        skillEntry.dependencyFingerprint,
      ),
    ).toBeDefined();
    expect(
      readFileSync(path.join(resources, 'skills/ppt-generation-expert/LICENSE'), 'utf8'),
    ).toContain('MIT License');
    expect(
      readFileSync(path.join(resources, 'skills/ppt-generation-expert/assets/中电金信模板.pptx')),
    ).toBeInstanceOf(Buffer);
    const expertService = new ExpertService(store);
    const registeredExperts = expertService.registerBuiltinRelease(experts.experts);
    expect(registeredExperts).toHaveLength(1);
    const expert = expertService.get('builtin-research-and-reporting');
    expect(expert).toMatchObject({
      sourceKind: 'builtin',
      lifecycle: 'active',
      name: '研究与汇报',
      revision: {
        modelReference: { mode: 'application-default' },
        builtinToolPolicy: {
          mode: 'allow-list',
          toolNames: [
            'knowledge_search',
            'read_text_file',
            'read_office_material',
            'web_search',
            'web_fetch',
          ],
        },
        skillPreset: [{ skillId: 'ppt-generation-expert', revisionId: skill?.revision.id }],
      },
    });
    expect(expertService.list().map((entry) => entry.id)).toEqual([
      'builtin-research-and-reporting',
    ]);

    const repeatedSkill = await skillService.registerBuiltinRelease(skills);
    const repeatedExpert = expertService.registerBuiltinRelease(experts.experts);
    expect(repeatedSkill[0]?.revision.id).toBe(skill?.revision.id);
    expect(repeatedExpert[0]?.revision.id).toBe(expert?.revision.id);
    expect(store.skills.list()).toHaveLength(1);
    expect(expertService.list()).toHaveLength(1);
    expect(readFileSync(path.join(resources, 'skills/release-manifest.json'), 'utf8')).toBe(
      skillContent,
    );
    expect(readFileSync(path.join(resources, 'experts/release-manifest.json'), 'utf8')).toBe(
      expertContent,
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
