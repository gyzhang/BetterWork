import { describe, expect, it } from 'vitest';

import {
  deleteSkillRequestSchema,
  exportMarkdownArtifactRequestSchema,
  importSkillRequestSchema,
  runtimeProfileDraftSchema,
  setSkillTrustRequestSchema,
  skillRevisionSummarySchema,
  skillSummarySchema,
  startRunRequestSchema,
  updateWindowThemeRequestSchema,
} from './index';

describe('run protocol', () => {
  it('accepts only identifiers and prompt, leaving the workspace boundary to Main', () => {
    expect(
      startRunRequestSchema.parse({
        taskId: 'task-1',
        sessionId: 'session-1',
        prompt: '研究客户风险',
      }),
    ).toEqual({ taskId: 'task-1', sessionId: 'session-1', prompt: '研究客户风险' });
    expect(() =>
      startRunRequestSchema.parse({
        taskId: 'task-1',
        sessionId: 'session-1',
        prompt: '研究客户风险',
        workspacePath: '/',
      }),
    ).toThrow();
  });
});

describe('window theme protocol', () => {
  it('allows only explicit six-digit color values across the IPC boundary', () => {
    expect(
      updateWindowThemeRequestSchema.parse({ backgroundColor: '#F6F7F5', symbolColor: '#1D2420' }),
    ).toEqual({ backgroundColor: '#F6F7F5', symbolColor: '#1D2420' });
    expect(() =>
      updateWindowThemeRequestSchema.parse({
        backgroundColor: 'rgba(0,0,0,.4)',
        symbolColor: '#fff',
      }),
    ).toThrow();
  });
});

describe('artifact export protocol', () => {
  it('accepts an Artifact with an optional explicit historical version', () => {
    expect(exportMarkdownArtifactRequestSchema.parse({ artifactId: 'artifact-1' })).toEqual({
      artifactId: 'artifact-1',
    });
    expect(
      exportMarkdownArtifactRequestSchema.parse({
        artifactId: 'artifact-1',
        versionId: 'version-2',
      }),
    ).toEqual({ artifactId: 'artifact-1', versionId: 'version-2' });
    expect(() => exportMarkdownArtifactRequestSchema.parse({ artifactId: '' })).toThrow();
  });
});

describe('skill management protocol', () => {
  const skill = {
    id: 'skill-1',
    name: 'PPT generation',
    description: 'Generate editable presentations',
    sourceKind: 'user' as const,
    enabled: true,
    currentRevisionId: 'revision-1',
    trustStatus: 'untrusted' as const,
    environmentStatus: 'unprepared' as const,
    blockedReasons: ['untrusted' as const, 'environment-unprepared' as const],
  };

  it('keeps trust, enabled, and environment state independent', () => {
    expect(skillSummarySchema.parse(skill)).toEqual(skill);
    expect(() => skillSummarySchema.parse({ ...skill, canRun: false })).toThrow();
    expect(
      skillSummarySchema.parse({
        ...skill,
        enabled: false,
        trustStatus: 'trusted',
        environmentStatus: 'ready',
        blockedReasons: ['disabled'],
      }),
    ).toMatchObject({ enabled: false, trustStatus: 'trusted', environmentStatus: 'ready' });
  });

  it('rejects client-supplied trust fingerprints and arbitrary source paths', () => {
    expect(setSkillTrustRequestSchema.parse({ skillId: 'skill-1', trusted: true })).toEqual({
      skillId: 'skill-1',
      trusted: true,
    });
    expect(() =>
      setSkillTrustRequestSchema.parse({
        skillId: 'skill-1',
        trusted: true,
        contentHash: 'forged',
      }),
    ).toThrow();
    expect(importSkillRequestSchema.parse({})).toEqual({});
    expect(() => importSkillRequestSchema.parse({ sourcePath: '/Users/private/skill' })).toThrow();
  });

  it('preserves non-semver versions and allows a pure instruction profile', () => {
    expect(
      skillRevisionSummarySchema.parse({
        id: 'revision-1',
        skillId: 'skill-1',
        contentHash: 'sha256:content',
        originalVersion: 'v20260907',
        resourceKey: 'user/skill-1/sha256-content',
        frontmatter: { version: 'v20260907', custom: 'preserved' },
        createdAt: 1,
      }).originalVersion,
    ).toBe('v20260907');
    expect(
      runtimeProfileDraftSchema.parse({
        commands: [],
        environmentRequirements: [],
        outputContract: { outputPaths: [] },
      }),
    ).toEqual({ commands: [], environmentRequirements: [], outputContract: { outputPaths: [] } });
    expect(() =>
      runtimeProfileDraftSchema.parse({
        commands: [],
        environmentRequirements: [],
        outputContract: {},
        extra: 1,
      }),
    ).toThrow();
  });

  it('limits Skill deletion to an application-owned identifier', () => {
    expect(deleteSkillRequestSchema.parse({ skillId: 'skill-1' })).toEqual({ skillId: 'skill-1' });
    expect(() =>
      deleteSkillRequestSchema.parse({ skillId: 'skill-1', sourcePath: '/tmp' }),
    ).toThrow();
  });
});
