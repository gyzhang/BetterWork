import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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

it('keeps fresh installations free of bundled skills, experts, and sample resource directories', async () => {
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
    expect(skills.skills).toEqual([]);
    expect(experts.experts).toEqual([]);
    const skillService = new SkillService(store, {
      developmentBuiltinRoot: path.join(resources, 'skills'),
      installedBuiltinRoot: path.join(directory, 'installed'),
      userRoot: path.join(directory, 'user'),
    });
    const registeredSkills = await skillService.registerBuiltinRelease(skills);
    expect(registeredSkills).toEqual([]);
    expect(store.skills.list()).toEqual([]);
    const expertService = new ExpertService(store);
    const registeredExperts = expertService.registerBuiltinRelease(experts.experts);
    expect(registeredExperts).toEqual([]);
    expect(expertService.list()).toEqual([]);
    expect(await skillService.registerBuiltinRelease(skills)).toEqual([]);
    expect(expertService.registerBuiltinRelease(experts.experts)).toEqual([]);
    expect(readdirSync(path.join(resources, 'skills'))).toEqual(['release-manifest.json']);
    expect(readdirSync(path.join(resources, 'experts'))).toEqual(['release-manifest.json']);
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
