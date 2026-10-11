import '../../apps/desktop/src/renderer/src/styles.css';
import './ui-render-fixture.css';

import type React from 'react';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { applyAppearance } from '../../apps/desktop/src/renderer/src/appearance';
import { HelpPage } from '../../apps/desktop/src/renderer/src/views/HelpView';
import { runArtifactSteps } from './artifact-steps';
import { runExpertSteps } from './expert-steps';
import { runKnowledgeSteps } from './knowledge-steps';
import { runMcpHelpSteps } from './mcp-help-steps';
import { runMemorySteps } from './memory-steps';
import { runScheduleSteps } from './schedule-steps';
import { ArtifactScenario, artifactSteps } from './ui-artifact-fixture';
import { ExpertScenario, MemoryScenario } from './ui-governance-fixture';
import { KnowledgeScenario, knowledgeSteps } from './ui-knowledge-fixture';
import { McpScenario, mcpSteps } from './ui-mcp-fixture';
import { expertSteps, helpSteps, memorySteps } from './ui-page-route-steps';
import { requireElement } from './ui-page-step-support';
import {
  installScheduleApi,
  resetScheduleFixture,
  SchedulesScenario,
  scheduleSteps,
} from './ui-schedules-fixture';

function layoutChecks(): {
  headerHeight: number;
  width: number;
  alerts: number;
  minimumFontPx: number;
} {
  const memoryPage = new URLSearchParams(location.search).get('page') === 'memory';
  const mcpPage = new URLSearchParams(location.search).get('page') === 'mcp';
  const schedulePage = new URLSearchParams(location.search).get('page') === 'schedule';
  const header = requireElement<HTMLElement>(
    memoryPage || mcpPage ? '.section-header[data-variant="block"]' : '.page-header',
  ).getBoundingClientRect();
  if (
    (!memoryPage && !mcpPage && (header.height < 70 || Math.abs(header.width - innerWidth) > 1)) ||
    document.documentElement.scrollWidth > innerWidth + 1
  )
    throw new Error(
      `页面骨架或横向溢出异常：${header.height}/${document.documentElement.scrollWidth}/${innerWidth}`,
    );
  if (!memoryPage && !mcpPage) {
    const body = document.querySelector<HTMLElement>('.page-body');
    if (!body || Number.parseFloat(getComputedStyle(body).paddingTop) !== 12)
      throw new Error('生产页面正文入口不是 12px');
  }
  if (memoryPage) {
    const section = requireElement<HTMLElement>('.memory-settings');
    if (Number.parseFloat(getComputedStyle(section).rowGap) !== 12)
      throw new Error('记忆页签入口不是 12px');
  }
  const sourceSheet = document.querySelector<HTMLElement>('.schedule-source-sheet');
  if (sourceSheet && Number.parseFloat(getComputedStyle(sourceSheet).rowGap) !== 12)
    throw new Error('定时任务知识范围页签入口不是 12px');
  for (const element of document.querySelectorAll<HTMLElement>(
    '.page-header button, [role="alert"], .knowledge-detail-text, .artifact-editor, .expert-editor input, .memory-editor-host textarea',
  )) {
    const rect = element.getBoundingClientRect();
    if (
      element.matches('[role="alert"]') &&
      (rect.width === 0 ||
        rect.height === 0 ||
        getComputedStyle(element).visibility === 'hidden' ||
        Number(getComputedStyle(element).opacity) === 0)
    )
      throw new Error('页面反馈不可见');
    if (rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1))
      throw new Error(`页面动作/反馈越界：${element.textContent?.slice(0, 40)}`);
  }
  const readableCopy = [
    ...document.querySelectorAll<HTMLElement>(
      '.mcp-settings .section-header-title, .mcp-settings .section-header-hint, .mcp-settings .field-label, .mcp-settings .field-hint, .mcp-settings .status-note, .mcp-settings .inline-error, .mcp-settings .list-row-title, .mcp-settings .list-row-detail, .mcp-settings .list-row-meta, .schedules-page .page-header h1, .schedules-page .section-header-title, .schedules-page .section-header-hint, .schedules-page .field-label, .schedules-page .field-hint, .schedules-page .status-note, .schedules-page .inline-error, .schedules-page .list-row-title, .schedules-page .list-row-detail, .schedules-page .list-row-meta, .schedules-page .schedule-source-document-path, .schedules-page .action-bar-hint, .modal-panel .section-header-title, .modal-panel .section-header-hint, .modal-panel .field-label, .modal-panel .field-hint, .modal-panel .status-note, .modal-panel .inline-error, .modal-panel .action-bar-hint',
    ),
  ].filter((element) => element.getBoundingClientRect().width > 0);
  const minimumFontPx = readableCopy.length
    ? Math.min(
        ...readableCopy.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
      )
    : 0;
  if ((schedulePage || mcpPage) && readableCopy.length > 0 && minimumFontPx < 12)
    throw new Error(`定时任务正文/说明字号低于 12px：${minimumFontPx}px`);
  return {
    headerHeight: header.height,
    width: innerWidth,
    alerts: document.querySelectorAll('[role="alert"]').length,
    minimumFontPx,
  };
}

async function runStep(step: string): Promise<ReturnType<typeof layoutChecks>> {
  await runMcpHelpSteps(step);
  await runArtifactSteps(step);
  await runKnowledgeSteps(step);
  await runExpertSteps(step);
  await runMemorySteps(step);
  await runScheduleSteps(step);
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

  return layoutChecks();
}

function PageScenario(): React.JSX.Element {
  const query = new URLSearchParams(location.search);
  const pageId = query.get('page');
  const mode = query.get('mode') === 'dark' ? 'dark' : 'light';
  useEffect(() => {
    window.onerror = (message, source, line, column, error): boolean => {
      const messageText = typeof message === 'string' ? message : message.type;
      document.documentElement.dataset.fixtureError = `${messageText} ${source ?? ''}:${String(line ?? 0)}:${String(column ?? 0)} ${error?.stack ?? ''}`;
      return false;
    };
    window.onunhandledrejection = (event): void => {
      document.documentElement.dataset.fixtureError =
        event.reason instanceof Error
          ? event.reason.message
          : typeof event.reason === 'string'
            ? event.reason
            : (JSON.stringify(event.reason) ?? '发生未处理的 Promise 拒绝');
    };
    applyAppearance({ mode, scheme: 'jade' });
    if (pageId === 'schedule') {
      resetScheduleFixture();
      installScheduleApi();
    }
    window.uiPageChecks = {
      steps:
        pageId === 'mcp'
          ? mcpSteps
          : pageId === 'artifact'
            ? artifactSteps
            : pageId === 'expert'
              ? expertSteps
              : pageId === 'memory'
                ? memorySteps
                : pageId === 'schedule'
                  ? scheduleSteps
                  : pageId === 'help'
                    ? helpSteps
                    : knowledgeSteps,
      runStep,
    };
    document.documentElement.dataset.fixtureReady = 'true';
  }, [pageId, mode]);
  return (
    <main className="fixture-main">
      <section className="main-stage">
        {pageId === 'mcp' ? (
          <McpScenario />
        ) : pageId === 'artifact' ? (
          <ArtifactScenario />
        ) : pageId === 'expert' ? (
          <ExpertScenario />
        ) : pageId === 'memory' ? (
          <MemoryScenario />
        ) : pageId === 'schedule' ? (
          <SchedulesScenario />
        ) : pageId === 'help' ? (
          <HelpPage />
        ) : (
          <KnowledgeScenario />
        )}
      </section>
    </main>
  );
}

declare global {
  interface Window {
    uiPageChecks?: { steps: string[]; runStep: typeof runStep };
  }
}
const host = document.getElementById('root');
if (!host) throw new Error('缺页面测试挂载节点');
createRoot(host).render(<PageScenario />);
