import { describe, expect, it, vi } from 'vitest';

import {
  ScheduleHostLifecycle,
  type ScheduleSchedulerLifecyclePort,
  startPrimaryInstance,
} from './schedule-host-lifecycle';

const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const fakeScheduler = () => {
  const scheduler = {
    recover: vi.fn<ScheduleSchedulerLifecyclePort['recover']>().mockResolvedValue(undefined),
    start: vi.fn(),
    stop: vi.fn(),
  } satisfies ScheduleSchedulerLifecyclePort;
  return scheduler;
};

describe('ScheduleHostLifecycle', () => {
  it('does not start recovery in a second process without the userData lock', async () => {
    const scheduler = fakeScheduler();
    const start = vi.fn(
      () =>
        new ScheduleHostLifecycle({
          ownsInstance: true,
          readiness: Promise.resolve(),
          scheduler,
          onError: (error) => {
            throw error;
          },
        }),
    );
    const quit = vi.fn();
    const app = { requestSingleInstanceLock: () => false, quit };

    expect(startPrimaryInstance(app, start)).toBe(false);

    expect(start).not.toHaveBeenCalled();
    expect(quit).toHaveBeenCalledOnce();
    expect(scheduler.recover).not.toHaveBeenCalled();
    expect(scheduler.start).not.toHaveBeenCalled();
  });

  it('runs startup only after acquiring the primary instance lock', () => {
    const start = vi.fn();
    const quit = vi.fn();

    expect(startPrimaryInstance({ requestSingleInstanceLock: () => true, quit }, start)).toBe(true);

    expect(start).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();
  });

  it('waits for existing recovery readiness before missed recovery and starts one timer', async () => {
    const readiness = deferred<void>();
    const scheduler = fakeScheduler();
    const lifecycle = new ScheduleHostLifecycle({
      ownsInstance: true,
      readiness: readiness.promise,
      scheduler,
      onError: (error) => {
        throw error;
      },
    });

    await Promise.resolve();
    expect(scheduler.recover).not.toHaveBeenCalled();
    expect(scheduler.start).not.toHaveBeenCalled();
    readiness.resolve();
    await lifecycle.ready;

    expect(scheduler.recover).toHaveBeenCalledOnce();
    expect(scheduler.start).toHaveBeenCalledOnce();
  });

  it('does not start while initially suspended and recovers before resume starts the timer', async () => {
    const scheduler = fakeScheduler();
    const lifecycle = new ScheduleHostLifecycle({
      ownsInstance: true,
      initiallySuspended: true,
      readiness: Promise.resolve(),
      scheduler,
      onError: (error) => {
        throw error;
      },
    });
    await lifecycle.ready;
    expect(scheduler.recover).not.toHaveBeenCalled();
    expect(scheduler.start).not.toHaveBeenCalled();

    const recovery = deferred<unknown>();
    scheduler.recover.mockReturnValueOnce(recovery.promise);
    const resumed = lifecycle.resume();
    expect(scheduler.stop).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(scheduler.recover).toHaveBeenCalledOnce();
    expect(scheduler.start).not.toHaveBeenCalled();
    recovery.resolve(undefined);
    await resumed;
    expect(scheduler.start).toHaveBeenCalledOnce();
  });

  it('invalidates stale initial and duplicate resume recoveries, then starts only the newest generation', async () => {
    const initial = deferred<unknown>();
    const olderResume = deferred<unknown>();
    const newestResume = deferred<unknown>();
    const scheduler = fakeScheduler();
    scheduler.recover
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(olderResume.promise)
      .mockReturnValueOnce(newestResume.promise);
    const lifecycle = new ScheduleHostLifecycle({
      ownsInstance: true,
      readiness: Promise.resolve(),
      scheduler,
      onError: (error) => {
        throw error;
      },
    });
    await Promise.resolve();
    expect(scheduler.recover).toHaveBeenCalledTimes(1);

    lifecycle.suspend();
    const firstResume = lifecycle.resume();
    await Promise.resolve();
    const secondResume = lifecycle.resume();
    await Promise.resolve();
    expect(scheduler.recover).toHaveBeenCalledTimes(3);

    initial.resolve(undefined);
    await lifecycle.ready;
    expect(scheduler.start).not.toHaveBeenCalled();
    olderResume.resolve(undefined);
    await firstResume;
    expect(scheduler.start).not.toHaveBeenCalled();
    newestResume.resolve(undefined);
    await secondResume;
    expect(scheduler.start).toHaveBeenCalledOnce();
  });

  it('stops synchronously on quit while readiness is pending and never starts afterward', async () => {
    const readiness = deferred<void>();
    const scheduler = fakeScheduler();
    const lifecycle = new ScheduleHostLifecycle({
      ownsInstance: true,
      readiness: readiness.promise,
      scheduler,
      onError: (error) => {
        throw error;
      },
    });

    lifecycle.stopForQuit();
    expect(scheduler.stop).toHaveBeenCalledOnce();
    readiness.resolve();
    await lifecycle.ready;
    expect(scheduler.recover).not.toHaveBeenCalled();
    expect(scheduler.start).not.toHaveBeenCalled();
    await lifecycle.resume();
    expect(scheduler.recover).not.toHaveBeenCalled();
    lifecycle.stopForQuit();
    expect(scheduler.stop).toHaveBeenCalledOnce();
  });

  it('keeps the scheduler stopped and reports a failed readiness dependency', async () => {
    const readiness = deferred<void>();
    const scheduler = fakeScheduler();
    const error = new Error('synthetic recovery failure');
    const report = vi.fn();
    const lifecycle = new ScheduleHostLifecycle({
      ownsInstance: true,
      readiness: readiness.promise,
      scheduler,
      onError: report,
    });
    readiness.reject(error);

    await lifecycle.ready;

    expect(report).toHaveBeenCalledWith(error);
    expect(scheduler.recover).not.toHaveBeenCalled();
    expect(scheduler.start).not.toHaveBeenCalled();
  });
});
