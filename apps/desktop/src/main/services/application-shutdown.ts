import type { KnowledgeIndexService } from './knowledge-index-service';
import type { KnowledgeWorkerRunner } from './knowledge-worker-runner';
import type { McpClientService } from './mcp-client-service';
import type { MemoryExtractionService } from './memory-extraction-service';
import type { RunService } from './run-service';
import type { ScheduleDispatchService } from './schedule-dispatch-service';
import type { ScheduleHostLifecycle } from './schedule-host-lifecycle';
import type { ScheduleNotificationService } from './schedule-notification-service';
import type { ScheduleScheduler } from './schedule-scheduler';
import type { SkillDependencyService } from './skill-dependency-service';

export interface QuitEvent {
  preventDefault(): void;
}

export interface ApplicationShutdownServices {
  startupSettled: Promise<unknown>;
  scheduleHost: Pick<ScheduleHostLifecycle, 'ready' | 'stopForQuit'>;
  scheduleScheduler: Pick<ScheduleScheduler, 'cancelPreparations' | 'waitForPreparations'>;
  scheduleDispatch?: Pick<ScheduleDispatchService, 'cancelPreparations' | 'waitForPreparations'>;
  runs?: Pick<RunService, 'shutdown'>;
  knowledgeIndex?: Pick<KnowledgeIndexService, 'shutdown'>;
  memoryExtractions: Pick<MemoryExtractionService, 'shutdown'>;
  dependencies: Pick<SkillDependencyService, 'shutdown'>;
  scheduleNotifications?: Pick<ScheduleNotificationService, 'waitForPending'>;
  mcpClientService: Pick<McpClientService, 'shutdown'>;
  knowledgeWorker: Pick<KnowledgeWorkerRunner, 'shutdown'>;
}

export async function shutdownApplication(services: ApplicationShutdownServices): Promise<void> {
  services.scheduleHost.stopForQuit();
  services.scheduleScheduler.cancelPreparations();
  services.scheduleDispatch?.cancelPreparations();
  const work = Promise.allSettled(
    [
      () => services.runs?.shutdown(),
      () => services.knowledgeIndex?.shutdown(),
      () => services.memoryExtractions.shutdown(),
      () => services.dependencies.shutdown(),
      () => services.mcpClientService.shutdown(),
    ].map(async (stop) => stop()),
  );
  await Promise.all([services.startupSettled, services.scheduleHost.ready]);
  services.scheduleDispatch?.cancelPreparations();
  await services.scheduleDispatch?.waitForPreparations();
  await services.scheduleScheduler.waitForPreparations();
  const results = await work;
  const errors: unknown[] = [];
  for (const result of results) {
    if (result.status === 'rejected') errors.push(result.reason);
  }
  if (errors.length > 0) throw new AggregateError(errors, 'Background work failed to stop');
  await services.scheduleNotifications?.waitForPending();
  await services.knowledgeWorker.shutdown();
}

const shutdownTimeoutMs = 15_000;

const waitForCleanup = async (cleanup: Promise<void>, timeoutMs: number): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      cleanup,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Application shutdown timed out; storage remains open')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** Electron does not await event handlers. Keep the app alive until cleanup finishes. */
export function createQuitHandler(
  shutdown: () => Promise<void>,
  close: () => void,
  quit: () => void,
  onError: (error: unknown) => void,
  options: { timeoutMs?: number } = {},
): (event: QuitEvent) => void {
  let pending = false;
  let finished = false;
  let cleanup: Promise<void> | undefined;
  return (event) => {
    if (finished) return;
    event.preventDefault();
    if (pending) return;
    pending = true;
    cleanup ??= Promise.resolve()
      .then(shutdown)
      .catch((error: unknown) => {
        cleanup = undefined;
        throw error;
      });
    waitForCleanup(cleanup, options.timeoutMs ?? shutdownTimeoutMs)
      .then(close)
      .then(() => {
        finished = true;
        quit();
      })
      .catch((error: unknown) => {
        pending = false;
        onError(error);
      });
  };
}
