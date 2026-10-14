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
  type BuiltinReleaseManifest,
  SkillService,
} from '../apps/desktop/src/main/services/skill-service';

it('registers the actual release manifests through production services without changing resources', async () => {
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
    const skillService = new SkillService(store, {
      developmentBuiltinRoot: path.join(resources, 'skills'),
      installedBuiltinRoot: path.join(directory, 'installed'),
      userRoot: path.join(directory, 'user'),
    });
    const corruptSkills = structuredClone(skills);
    corruptSkills.skills[0]!.contentHash = '0'.repeat(64);
    await expect(skillService.registerBuiltinRelease(corruptSkills)).rejects.toThrow(
      'content does not match its release manifest',
    );
    const registeredSkills = await skillService.registerBuiltinRelease(skills);
    expect(registeredSkills).toHaveLength(skills.skills.length);
    const expertService = new ExpertService(store);
    const corruptExperts = structuredClone(experts);
    corruptExperts.experts[0]!.identity = '';
    expect(() => expertService.registerBuiltinRelease(corruptExperts.experts)).toThrow();
    expect(expertService.list()).toEqual([]);
    const registeredExperts = expertService.registerBuiltinRelease(experts.experts);
    expect(registeredExperts).toHaveLength(experts.experts.length);
    for (const expert of registeredExperts) expect(expert.blockedReasons).toEqual([]);
    expect(await skillService.registerBuiltinRelease(skills)).toHaveLength(skills.skills.length);
    expect(expertService.registerBuiltinRelease(experts.experts)).toHaveLength(
      experts.experts.length,
    );
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
