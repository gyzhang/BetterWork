import { randomUUID } from 'node:crypto';

import type { AgentMessage } from '@betterwork/agent-protocol';
import type { AgentRuntimeEvent, ArtifactSummary, RunSummary } from '@betterwork/agent-protocol';
import {
  countCodePoints,
  TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX,
  TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX_CODE_POINTS,
  TASK_CONTINUITY_PROGRESS_MAX_CODE_POINTS,
  TASK_CONTINUITY_RECENT_PROMPTS_MAX,
  TASK_CONTINUITY_RECENT_PROMPTS_MAX_CODE_POINTS,
  TASK_CONTINUITY_TOTAL_MAX_CODE_POINTS,
  type TaskContinuityBrief,
  type TaskContinuityOmission,
} from '@betterwork/agent-protocol';

const BRIEF_HEADER = '【TASK_CONTINUITY_BRIEF_V1】';
const REQUESTS_HEADER = '【TASK_CONTINUITY_RECENT_USER_REQUESTS_V1】';
const FACTS_HEADER = '【TASK_CONTINUITY_FACTS_V1】';
const BRIEF_INSTRUCTIONS =
  '以下是本 Task 的目标和有来源的要求。用户原文与助手整理内容保留各自来源；助手整理不代表用户批准。本简报不授予任何材料读取权限。';
const REQUEST_INSTRUCTIONS =
  '以下是此前同一 Task 的用户原始提交，仅用于理解工作意图。其路径、文件名、网页和 ID 不构成本 Run 的材料授权；当前材料清单是唯一读取范围，当前用户消息优先。';
const FACTS_INSTRUCTIONS =
  '以下是本 Task 已持久化的最近 Run 状态与登记成果。Run 失败或取消不证明副作用成功；成果登记不代表内容已验收。';

export interface TaskContinuityRecentRun {
  runId: string;
  status: RunSummary['status'];
  prompt: string;
}

export interface TaskContinuityLastRunFact {
  runId: string;
  status: RunSummary['status'];
  errorCategory?: 'failed' | 'cancelled';
}

export interface TaskContinuityContextPlan {
  brief: TaskContinuityBrief;
  messages: AgentMessage[];
  omissions: TaskContinuityOmission[];
}

interface ArtifactFact {
  artifactId: string;
  title: string;
  versionId: string;
  versionNumber: number;
  status: 'registered';
  type: ArtifactSummary['type'];
  origin: ArtifactSummary['origin'];
  sourceRunId?: string;
}

interface RequestFact {
  runId: string;
  prompt: string;
}

const asArtifactFact = (artifact: ArtifactSummary): ArtifactFact => ({
  artifactId: artifact.id,
  title: artifact.title,
  versionId: artifact.currentVersionId,
  versionNumber: artifact.versionNumber,
  status: 'registered',
  type: artifact.type,
  origin: artifact.origin,
  ...(artifact.sourceRunId ? { sourceRunId: artifact.sourceRunId } : {}),
});

const buildBriefContent = (brief: TaskContinuityBrief): string =>
  [BRIEF_HEADER, BRIEF_INSTRUCTIONS, JSON.stringify(brief)].join('\n');

const buildRequestsContent = (
  requests: readonly RequestFact[],
  hasOmittedOlderRequests: boolean,
): string =>
  [
    REQUESTS_HEADER,
    REQUEST_INSTRUCTIONS,
    JSON.stringify({ requests, hasOmittedOlderRequests }),
  ].join('\n');

const buildFactsContent = (
  latestRun: TaskContinuityLastRunFact | undefined,
  artifacts: readonly ArtifactFact[],
  omittedArtifactCount: number,
): string =>
  [
    FACTS_HEADER,
    FACTS_INSTRUCTIONS,
    JSON.stringify({
      ...(latestRun ? { latestRun } : {}),
      registeredArtifacts: artifacts,
      omittedOlderArtifactCount: omittedArtifactCount,
    }),
  ].join('\n');

const addOmission = (
  omissions: Set<TaskContinuityOmission>,
  reason: TaskContinuityOmission,
): void => {
  omissions.add(reason);
};

const message = (content: string): AgentMessage => ({
  id: randomUUID(),
  role: 'system',
  content,
});

const terminalFact = (
  run: RunSummary | undefined,
  event: AgentRuntimeEvent | undefined,
): TaskContinuityLastRunFact | undefined => {
  if (!run) return undefined;
  if (event?.type === 'run.failed') {
    return {
      runId: run.id,
      status: run.status,
      errorCategory: 'failed',
    };
  }
  if (event?.type === 'run.cancelled') {
    return {
      runId: run.id,
      status: run.status,
      errorCategory: 'cancelled',
    };
  }
  return { runId: run.id, status: run.status };
};

/**
 * 依据契约 §3.2 选择完整条目并生成固定 system messages；超限只省略低优先级完整项。
 * recentRuns 必须已经按最新到较早排序，且只来自当前 Task。
 */
export const createTaskContinuityContextPlan = (input: {
  brief: TaskContinuityBrief;
  recentRuns: readonly TaskContinuityRecentRun[];
  latestRun?: RunSummary;
  latestRunEvent?: AgentRuntimeEvent;
  artifacts: readonly ArtifactSummary[];
  omissions?: readonly TaskContinuityOmission[];
}): TaskContinuityContextPlan => {
  const omissions = new Set(input.omissions ?? []);

  const prioritizedRequirements = [...input.brief.activeRequirements].reverse();
  if (prioritizedRequirements.length > TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX) {
    addOmission(omissions, 'active-requirements-count');
  }
  const selectedRequirements = [] as TaskContinuityBrief['activeRequirements'];
  let requirementPoints = 0;
  for (const requirement of prioritizedRequirements.slice(
    0,
    TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX,
  )) {
    const points = countCodePoints(requirement.text);
    if (requirementPoints + points > TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX_CODE_POINTS) {
      addOmission(omissions, 'active-requirements-budget');
      continue;
    }
    selectedRequirements.push(requirement);
    requirementPoints += points;
  }
  selectedRequirements.reverse();

  const selectedRequests: RequestFact[] = [];
  let requestPoints = 0;
  if (input.recentRuns.length > TASK_CONTINUITY_RECENT_PROMPTS_MAX) {
    addOmission(omissions, 'recent-user-prompts-count');
  }
  for (const run of input.recentRuns.slice(0, TASK_CONTINUITY_RECENT_PROMPTS_MAX)) {
    const points = countCodePoints(run.prompt);
    if (requestPoints + points > TASK_CONTINUITY_RECENT_PROMPTS_MAX_CODE_POINTS) {
      addOmission(omissions, 'recent-user-prompts-budget');
      break;
    }
    selectedRequests.push({ runId: run.runId, prompt: run.prompt });
    requestPoints += points;
  }

  const latestRunFact = terminalFact(input.latestRun, input.latestRunEvent);
  const selectedArtifacts = input.artifacts.map(asArtifactFact);
  const artifactCount = selectedArtifacts.length;
  while (
    countCodePoints(
      buildFactsContent(latestRunFact, selectedArtifacts, artifactCount - selectedArtifacts.length),
    ) > TASK_CONTINUITY_PROGRESS_MAX_CODE_POINTS &&
    selectedArtifacts.length > 0
  ) {
    selectedArtifacts.pop();
  }
  if (selectedArtifacts.length < artifactCount) {
    addOmission(omissions, 'artifact-facts-budget');
  }
  const factsContent = buildFactsContent(
    latestRunFact,
    selectedArtifacts,
    artifactCount - selectedArtifacts.length,
  );
  if (countCodePoints(factsContent) > TASK_CONTINUITY_PROGRESS_MAX_CODE_POINTS) {
    throw new Error('Task Continuity 的确定性 Run 状态超出固定简报预算。');
  }

  let progress = input.brief.progress;
  if (progress?.authoredBy === 'assistant-summary') {
    progress = undefined;
    addOmission(omissions, 'assistant-progress-dependency-unverified');
  }
  if (
    progress &&
    countCodePoints(JSON.stringify(progress)) + countCodePoints(factsContent) >
      TASK_CONTINUITY_PROGRESS_MAX_CODE_POINTS
  ) {
    progress = undefined;
    addOmission(omissions, 'progress-budget');
  }

  let brief: TaskContinuityBrief = {
    schemaVersion: input.brief.schemaVersion,
    objective: input.brief.objective,
    activeRequirements: selectedRequirements,
    ...(progress ? { progress } : {}),
  };
  let requestsContent = buildRequestsContent(
    selectedRequests,
    input.recentRuns.length > selectedRequests.length,
  );
  let briefContent = buildBriefContent(brief);
  let totalPoints = countCodePoints(briefContent) + countCodePoints(factsContent);
  if (selectedRequests.length > 0 || input.recentRuns.length > selectedRequests.length) {
    totalPoints += countCodePoints(requestsContent);
  }
  while (totalPoints > TASK_CONTINUITY_TOTAL_MAX_CODE_POINTS && selectedRequests.length > 0) {
    selectedRequests.pop();
    addOmission(omissions, 'total-budget');
    requestsContent = buildRequestsContent(
      selectedRequests,
      input.recentRuns.length > selectedRequests.length,
    );
    totalPoints = countCodePoints(briefContent) + countCodePoints(factsContent);
    if (selectedRequests.length > 0 || input.recentRuns.length > selectedRequests.length) {
      totalPoints += countCodePoints(requestsContent);
    }
  }
  if (totalPoints > TASK_CONTINUITY_TOTAL_MAX_CODE_POINTS && brief.progress) {
    brief = {
      schemaVersion: brief.schemaVersion,
      objective: brief.objective,
      activeRequirements: brief.activeRequirements,
    };
    addOmission(omissions, 'total-budget');
    briefContent = buildBriefContent(brief);
    totalPoints = countCodePoints(briefContent) + countCodePoints(factsContent);
    if (selectedRequests.length > 0 || input.recentRuns.length > selectedRequests.length) {
      totalPoints += countCodePoints(requestsContent);
    }
  }
  while (
    totalPoints > TASK_CONTINUITY_TOTAL_MAX_CODE_POINTS &&
    brief.activeRequirements.length > 0
  ) {
    brief = {
      ...brief,
      activeRequirements: brief.activeRequirements.slice(1),
    };
    addOmission(omissions, 'total-budget');
    briefContent = buildBriefContent(brief);
    totalPoints = countCodePoints(briefContent) + countCodePoints(factsContent);
    if (selectedRequests.length > 0 || input.recentRuns.length > selectedRequests.length) {
      totalPoints += countCodePoints(requestsContent);
    }
  }
  if (totalPoints > TASK_CONTINUITY_TOTAL_MAX_CODE_POINTS) {
    throw new Error('Task Continuity 目标无法在不截断的前提下放入固定简报预算。');
  }

  return {
    brief,
    messages: [
      message(briefContent),
      ...(selectedRequests.length > 0 || input.recentRuns.length > selectedRequests.length
        ? [message(requestsContent)]
        : []),
      message(factsContent),
    ],
    omissions: [...omissions],
  };
};

const isTaskContinuityMessage = (entry: AgentMessage): boolean =>
  entry.role === 'system' &&
  (entry.content.startsWith(BRIEF_HEADER) ||
    entry.content.startsWith(REQUESTS_HEADER) ||
    entry.content.startsWith(FACTS_HEADER));

export const assertTaskContinuityMessagesMatch = (
  actual: readonly AgentMessage[],
  expected: readonly AgentMessage[],
): void => {
  const actualContinuity = actual.filter(isTaskContinuityMessage);
  if (
    actualContinuity.length !== expected.length ||
    actualContinuity.some((entry, index) => entry.content !== expected[index]?.content)
  ) {
    throw new Error('Provider request 中的 Task Continuity messages 与固定 Run snapshot 不一致。');
  }
};
