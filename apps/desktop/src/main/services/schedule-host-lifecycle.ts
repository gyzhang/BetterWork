export interface ScheduleSchedulerLifecyclePort {
  recover(): Promise<unknown>;
  start(): void;
  stop(): void;
}

export interface PrimaryInstancePort {
  requestSingleInstanceLock(): boolean;
  quit(): void;
}

export const startPrimaryInstance = (app: PrimaryInstancePort, start: () => void): boolean => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  start();
  return true;
};

export interface ScheduleHostLifecycleOptions {
  readonly ownsInstance: boolean;
  readonly initiallySuspended?: boolean;
  readonly readiness: Promise<unknown>;
  readonly scheduler: ScheduleSchedulerLifecyclePort;
  readonly onError: (error: unknown) => void;
}

/** Gates scheduler ownership on the single app instance, startup recovery and OS lifecycle. */
export class ScheduleHostLifecycle {
  private readonly readiness: Promise<unknown>;
  private readonly scheduler: ScheduleSchedulerLifecyclePort;
  private readonly onError: (error: unknown) => void;
  private readonly ownsInstance: boolean;
  private generation = 0;
  private suspended: boolean;
  private closing = false;
  readonly ready: Promise<void>;

  constructor(options: ScheduleHostLifecycleOptions) {
    this.ownsInstance = options.ownsInstance;
    this.suspended = options.initiallySuspended ?? false;
    this.readiness = options.readiness;
    this.scheduler = options.scheduler;
    this.onError = options.onError;
    this.ready = this.initialize().catch((error: unknown) => {
      this.reportError(error);
    });
  }

  suspend(): void {
    if (!this.ownsInstance || this.closing || this.suspended) return;
    this.suspended = true;
    this.generation += 1;
    this.scheduler.stop();
  }

  resume(): Promise<void> {
    if (!this.ownsInstance || this.closing) return Promise.resolve();
    this.suspended = true;
    const generation = ++this.generation;
    this.scheduler.stop();
    return this.recoverAndStart(generation);
  }

  /** Must be called synchronously from before-quit, before the async shutdown handler. */
  stopForQuit(): void {
    if (!this.ownsInstance || this.closing) return;
    this.closing = true;
    this.suspended = true;
    this.generation += 1;
    this.scheduler.stop();
  }

  private async initialize(): Promise<void> {
    if (!this.ownsInstance) return;
    const generation = this.generation;
    await this.readiness;
    if (!this.canStart(generation)) return;
    await this.scheduler.recover();
    if (this.canStart(generation)) this.scheduler.start();
  }

  private async recoverAndStart(generation: number): Promise<void> {
    await this.readiness;
    if (this.closing || generation !== this.generation) return;
    await this.scheduler.recover();
    if (this.closing || generation !== this.generation) return;
    this.suspended = false;
    this.scheduler.start();
  }

  private canStart(generation: number): boolean {
    return this.ownsInstance && !this.closing && !this.suspended && generation === this.generation;
  }

  private reportError(error: unknown): void {
    try {
      this.onError(error);
    } catch (reportError) {
      queueMicrotask(() => {
        throw reportError;
      });
    }
  }
}
