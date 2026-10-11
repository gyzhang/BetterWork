import type {
  AgentMessage,
  MarkdownArtifactSummary,
  RunSummary,
  TaskContinuityBrief,
} from '@betterwork/agent-protocol';
import {
  TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX,
  TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX_CODE_POINTS,
  TASK_CONTINUITY_PROGRESS_MAX_CODE_POINTS,
  TASK_CONTINUITY_RECENT_PROMPTS_MAX,
  TASK_CONTINUITY_RECENT_PROMPTS_MAX_CODE_POINTS,
  TASK_CONTINUITY_TOTAL_MAX_CODE_POINTS,
  type TaskContinuityOmission,
} from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import {
  assertTaskContinuityMessagesMatch,
  createTaskContinuityContextPlan,
  type TaskContinuityRecentRun,
} from './task-continuity-context';

const shortText = (codePoints: number): string => 'a'.repeat(codePoints);

const makeBrief = (overrides: Partial<TaskContinuityBrief> = {}): TaskContinuityBrief => ({
  schemaVersion: 1,
  objective: { text: 'Test objective', source: 'task-goal' },
  activeRequirements: [],
  ...overrides,
});

const makeRequirement = (
  id: string,
  text: string,
  authoredBy: 'assistant-summary' | 'user-edit' = 'user-edit',
) => ({
  id,
  text,
  authoredBy,
  ...(authoredBy === 'user-edit'
    ? {}
    : { sources: [{ runId: 'run-1', promptHash: 'aa'.repeat(32) }] }),
});

const makeArtifact = (
  overrides: Partial<MarkdownArtifactSummary> = {},
): MarkdownArtifactSummary => ({
  id: 'art-1',
  workspaceId: 'ws-1',
  taskId: 'task-1',
  type: 'markdown',
  title: 'Test Artifact',
  currentVersionId: 'ver-1',
  versionNumber: 1,
  origin: 'assistant-run',
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

const makeRun = (overrides: Partial<RunSummary> = {}): RunSummary => ({
  id: 'run-1',
  taskId: 'task-1',
  sessionId: 'session-1',
  prompt: 'test prompt',
  status: 'completed',
  createdAt: 1000,
  ...overrides,
});

const makeRecentRun = (runId: string, prompt: string): TaskContinuityRecentRun => ({
  runId,
  status: 'completed',
  prompt,
});

describe('createTaskContinuityContextPlan', () => {
  it('produces a minimal plan with just brief and facts messages', () => {
    const plan = createTaskContinuityContextPlan({
      brief: makeBrief(),
      recentRuns: [],
      artifacts: [],
    });
    expect(plan.messages).toHaveLength(2);
    expect(plan.omissions).toEqual([]);
    expect(plan.brief.objective.text).toBe('Test objective');
    expect(plan.brief.activeRequirements).toEqual([]);
  });

  it('includes request messages when recent runs are provided', () => {
    const plan = createTaskContinuityContextPlan({
      brief: makeBrief(),
      recentRuns: [makeRecentRun('run-1', 'hello')],
      artifacts: [],
    });
    expect(plan.messages).toHaveLength(3);
  });

  it('does not include request message when recent runs are empty', () => {
    const plan = createTaskContinuityContextPlan({
      brief: makeBrief(),
      recentRuns: [],
      artifacts: [],
    });
    expect(plan.messages).toHaveLength(2);
    const hasRequests = plan.messages.some((message) =>
      message.content.startsWith('【TASK_CONTINUITY_RECENT_USER_REQUESTS_V1】'),
    );
    expect(hasRequests).toBe(false);
  });

  describe('active requirements count limit', () => {
    it('omits lowest-priority requirements when count exceeds max', () => {
      const requirements = Array.from(
        { length: TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX + 2 },
        (_, index) => makeRequirement(`req-${index}`, `requirement ${index}`),
      );
      const plan = createTaskContinuityContextPlan({
        brief: makeBrief({ activeRequirements: requirements }),
        recentRuns: [],
        artifacts: [],
      });
      expect(plan.brief.activeRequirements.length).toBeLessThanOrEqual(
        TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX,
      );
      expect(plan.omissions).toContain('active-requirements-count');
    });

    it('keeps all requirements when count equals max', () => {
      const requirements = Array.from(
        { length: TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX },
        (_, index) => makeRequirement(`req-${index}`, `req ${index}`),
      );
      const plan = createTaskContinuityContextPlan({
        brief: makeBrief({ activeRequirements: requirements }),
        recentRuns: [],
        artifacts: [],
      });
      expect(plan.brief.activeRequirements).toHaveLength(TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX);
      expect(plan.omissions).not.toContain('active-requirements-count');
    });
  });

  describe('active requirements code point budget', () => {
    it('skips individual requirements that exceed the code point budget', () => {
      const oversized = makeRequirement(
        'big',
        shortText(TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX_CODE_POINTS + 1),
      );
      const small = makeRequirement('small', 'tiny');
      const plan = createTaskContinuityContextPlan({
        brief: makeBrief({ activeRequirements: [oversized, small] }),
        recentRuns: [],
        artifacts: [],
      });
      expect(plan.brief.activeRequirements.some((requirement) => requirement.id === 'small')).toBe(
        true,
      );
      expect(plan.brief.activeRequirements.some((requirement) => requirement.id === 'big')).toBe(
        false,
      );
      expect(plan.omissions).toContain('active-requirements-budget');
    });

    it('accumulates code points and skips items that exceed the remaining budget', () => {
      const halfBudget = Math.floor(TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX_CODE_POINTS / 2);
      // Requirements are processed in reverse order (last = highest priority),
      // so the first item in the input array is lowest priority.
      // [lowest, medium, highest] -> reversed: [highest, medium, lowest]
      const lowest = makeRequirement('lowest', shortText(halfBudget));
      const medium = makeRequirement('medium', shortText(halfBudget));
      const highest = makeRequirement('highest', 'tiny');
      const plan = createTaskContinuityContextPlan({
        brief: makeBrief({ activeRequirements: [lowest, medium, highest] }),
        recentRuns: [],
        artifacts: [],
      });
      const selectedIds = plan.brief.activeRequirements.map((requirement) => requirement.id);
      // highest (tiny) and medium (halfBudget) fit; lowest (halfBudget) overflows
      expect(selectedIds).toContain('highest');
      expect(selectedIds).toContain('medium');
      expect(selectedIds).not.toContain('lowest');
    });
  });

  describe('recent user prompts count limit', () => {
    it('records omission when recent runs exceed max count', () => {
      const runs = Array.from({ length: TASK_CONTINUITY_RECENT_PROMPTS_MAX + 1 }, (_, index) =>
        makeRecentRun(`run-${index}`, `prompt ${index}`),
      );
      const plan = createTaskContinuityContextPlan({
        brief: makeBrief(),
        recentRuns: runs,
        artifacts: [],
      });
      expect(plan.omissions).toContain('recent-user-prompts-count');
    });

    it('trims prompts to the max count', () => {
      const runs = Array.from({ length: TASK_CONTINUITY_RECENT_PROMPTS_MAX + 2 }, (_, index) =>
        makeRecentRun(`run-${index}`, `prompt ${index}`),
      );
      const plan = createTaskContinuityContextPlan({
        brief: makeBrief(),
        recentRuns: runs,
        artifacts: [],
      });
      const requestMessage = plan.messages.find((message) =>
        message.content.startsWith('【TASK_CONTINUITY_RECENT_USER_REQUESTS_V1】'),
      );
      expect(requestMessage).toBeDefined();
    });
  });

  describe('recent user prompts code point budget', () => {
    it('stops adding prompts when code point budget is exhausted', () => {
      const bigPrompt = shortText(TASK_CONTINUITY_RECENT_PROMPTS_MAX_CODE_POINTS);
      const runs = [makeRecentRun('run-1', bigPrompt), makeRecentRun('run-2', 'small')];
      const plan = createTaskContinuityContextPlan({
        brief: makeBrief(),
        recentRuns: runs,
        artifacts: [],
      });
      expect(plan.omissions).toContain('recent-user-prompts-budget');
    });
  });

  describe('progress budget', () => {
    it('strips assistant-authored progress with omission', () => {
      const brief = makeBrief({
        progress: {
          status: 'in-progress',
          completedActions: ['done something'],
          blockers: [],
          authoredBy: 'assistant-summary',
          artifactVersionIds: [],
        },
      });
      const plan = createTaskContinuityContextPlan({
        brief,
        recentRuns: [],
        artifacts: [],
      });
      expect(plan.brief.progress).toBeUndefined();
      expect(plan.omissions).toContain('assistant-progress-dependency-unverified');
    });

    it('keeps user-edit progress when within budget', () => {
      const brief = makeBrief({
        progress: {
          status: 'in-progress',
          completedActions: ['done'],
          blockers: [],
          authoredBy: 'user-edit',
          artifactVersionIds: [],
        },
      });
      const plan = createTaskContinuityContextPlan({
        brief,
        recentRuns: [],
        artifacts: [],
      });
      expect(plan.brief.progress).toBeDefined();
      expect(plan.omissions).not.toContain('progress-budget');
    });

    it('drops progress when it exceeds the progress budget alongside facts', () => {
      const bigProgress = {
        status: 'in-progress' as const,
        completedActions: [shortText(TASK_CONTINUITY_PROGRESS_MAX_CODE_POINTS - 10)],
        blockers: [],
        authoredBy: 'user-edit' as const,
        artifactVersionIds: [],
      };
      const plan = createTaskContinuityContextPlan({
        brief: makeBrief({ progress: bigProgress }),
        recentRuns: [],
        artifacts: [],
      });
      expect(plan.brief.progress).toBeUndefined();
      expect(plan.omissions).toContain('progress-budget');
    });
  });

  describe('artifact facts budget', () => {
    it('trims artifacts when facts content exceeds progress budget', () => {
      const artifacts = Array.from({ length: 50 }, (_, index) =>
        makeArtifact({
          id: `art-${index}`,
          title: shortText(200),
          currentVersionId: `ver-${index}`,
          versionNumber: index + 1,
        }),
      );
      const plan = createTaskContinuityContextPlan({
        brief: makeBrief(),
        recentRuns: [],
        artifacts,
      });
      expect(plan.omissions).toContain('artifact-facts-budget');
    });
  });

  describe('total budget trimming', () => {
    it('drops requests when total budget is exceeded across all sections', () => {
      // Fill all three sections close to their individual limits so their sum
      // exceeds the 32_000 total budget.
      const bigObjectiveText = shortText(20_000);
      const artifacts = Array.from({ length: 20 }, (_, index) =>
        makeArtifact({
          id: `art-${index}`,
          title: shortText(150),
          currentVersionId: `ver-${index}`,
          versionNumber: index + 1,
        }),
      );
      const brief = makeBrief({
        objective: { text: bigObjectiveText, source: 'task-goal' },
        activeRequirements: Array.from(
          { length: TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX },
          (_, index) => makeRequirement(`req-${index}`, shortText(490)),
        ),
      });
      const runs = Array.from({ length: TASK_CONTINUITY_RECENT_PROMPTS_MAX }, (_, index) =>
        makeRecentRun(`run-${index}`, shortText(2_600)),
      );
      const plan = createTaskContinuityContextPlan({
        brief,
        recentRuns: runs,
        artifacts,
      });
      expect(plan.omissions).toContain('total-budget');
    });
  });

  describe('omission accumulation', () => {
    it('carries forward pre-existing omissions from input', () => {
      const preExisting: TaskContinuityOmission = 'active-requirements-source-unavailable';
      const plan = createTaskContinuityContextPlan({
        brief: makeBrief(),
        recentRuns: [],
        artifacts: [],
        omissions: [preExisting],
      });
      expect(plan.omissions).toContain(preExisting);
    });

    it('deduplicates omissions via Set', () => {
      const requirements = Array.from(
        { length: TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX + 1 },
        (_, index) => makeRequirement(`req-${index}`, `req ${index}`),
      );
      const plan = createTaskContinuityContextPlan({
        brief: makeBrief({ activeRequirements: requirements }),
        recentRuns: [],
        artifacts: [],
        omissions: ['active-requirements-count'],
      });
      const countOccurrences = plan.omissions.filter(
        (omission) => omission === 'active-requirements-count',
      );
      expect(countOccurrences).toHaveLength(1);
    });
  });

  describe('latestRun terminal fact', () => {
    it('includes errorCategory failed when latest run event is run.failed', () => {
      const run = makeRun({ status: 'failed' });
      const plan = createTaskContinuityContextPlan({
        brief: makeBrief(),
        recentRuns: [],
        latestRun: run,
        latestRunEvent: {
          type: 'run.failed',
          runId: run.id,
          error: 'boom',
          id: 'evt-1',
          sequence: 1,
          createdAt: 1000,
        },
        artifacts: [],
      });
      const factsMessage = plan.messages.find((message) =>
        message.content.startsWith('【TASK_CONTINUITY_FACTS_V1】'),
      );
      expect(factsMessage).toBeDefined();
      expect(factsMessage?.content).toContain('"errorCategory":"failed"');
    });

    it('includes errorCategory cancelled when latest run event is run.cancelled', () => {
      const run = makeRun({ status: 'cancelled' });
      const plan = createTaskContinuityContextPlan({
        brief: makeBrief(),
        recentRuns: [],
        latestRun: run,
        latestRunEvent: {
          type: 'run.cancelled',
          runId: run.id,
          id: 'evt-1',
          sequence: 1,
          createdAt: 1000,
        },
        artifacts: [],
      });
      const factsMessage = plan.messages.find((message) =>
        message.content.startsWith('【TASK_CONTINUITY_FACTS_V1】'),
      );
      expect(factsMessage?.content).toContain('"errorCategory":"cancelled"');
    });

    it('omits errorCategory for completed runs', () => {
      const run = makeRun({ status: 'completed' });
      const plan = createTaskContinuityContextPlan({
        brief: makeBrief(),
        recentRuns: [],
        latestRun: run,
        latestRunEvent: {
          type: 'run.completed',
          runId: run.id,
          id: 'evt-1',
          sequence: 1,
          createdAt: 1000,
          finalContent: 'done',
        },
        artifacts: [],
      });
      const factsMessage = plan.messages.find((message) =>
        message.content.startsWith('【TASK_CONTINUITY_FACTS_V1】'),
      );
      expect(factsMessage?.content).not.toContain('errorCategory');
    });
  });

  it('throws when objective alone exceeds total budget', () => {
    const hugeObjective = shortText(TASK_CONTINUITY_TOTAL_MAX_CODE_POINTS + 1);
    expect(() =>
      createTaskContinuityContextPlan({
        brief: makeBrief({ objective: { text: hugeObjective, source: 'task-goal' } }),
        recentRuns: [],
        artifacts: [],
      }),
    ).toThrow('固定简报预算');
  });
});

describe('assertTaskContinuityMessagesMatch', () => {
  const systemMessage = (content: string): AgentMessage => ({
    id: 'msg-1',
    role: 'system',
    content,
  });

  it('passes when continuity messages match exactly', () => {
    const plan = createTaskContinuityContextPlan({
      brief: makeBrief(),
      recentRuns: [],
      artifacts: [],
    });
    expect(() => assertTaskContinuityMessagesMatch(plan.messages, plan.messages)).not.toThrow();
  });

  it('ignores non-continuity messages in actual', () => {
    const plan = createTaskContinuityContextPlan({
      brief: makeBrief(),
      recentRuns: [],
      artifacts: [],
    });
    const actualWithExtra: AgentMessage[] = [
      { id: 'user-1', role: 'user', content: 'hello' },
      ...plan.messages,
      { id: 'assistant-1', role: 'assistant', content: 'reply' },
    ];
    expect(() => assertTaskContinuityMessagesMatch(actualWithExtra, plan.messages)).not.toThrow();
  });

  it('throws when continuity message content differs', () => {
    const plan = createTaskContinuityContextPlan({
      brief: makeBrief(),
      recentRuns: [],
      artifacts: [],
    });
    const mismatched: AgentMessage[] = plan.messages.map((message, index) =>
      index === 0 ? systemMessage('wrong content') : message,
    );
    expect(() => assertTaskContinuityMessagesMatch(mismatched, plan.messages)).toThrow('不一致');
  });

  it('throws when continuity message count differs', () => {
    const plan = createTaskContinuityContextPlan({
      brief: makeBrief(),
      recentRuns: [],
      artifacts: [],
    });
    expect(() => assertTaskContinuityMessagesMatch([], plan.messages)).toThrow('不一致');
  });
});
