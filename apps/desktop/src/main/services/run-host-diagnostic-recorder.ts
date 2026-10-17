import { randomUUID } from 'node:crypto';

import { isAbortError } from '@betterwork/agent-core';
import {
  type HostDiagnosticErrorCode,
  type HostDiagnosticEvent,
  type HostDiagnosticEventInput,
  hostDiagnosticEventInputSchema,
  type RunHostDiagnosticPhase,
  type SkillHostDiagnosticPhase,
} from '@betterwork/agent-protocol';

import type { RunHostDiagnosticRepository } from '../persistence/run-host-diagnostic-repository';

interface DiagnosticAssociations {
  runId: string;
  operationId: string;
  parentOperationId?: string;
  toolCallId?: string;
  executionId?: string;
  metadata?: HostDiagnosticEventInput['metadata'];
}

export type RunHostDiagnosticStartInput = DiagnosticAssociations &
  (
    | { kind: 'run-host'; phase: RunHostDiagnosticPhase }
    | { kind: 'skill-host'; phase: SkillHostDiagnosticPhase }
  );

export interface RunHostDiagnosticFinishInput {
  state: Exclude<HostDiagnosticEvent['state'], 'started'>;
  errorCode?: HostDiagnosticErrorCode;
  metadata?: HostDiagnosticEventInput['metadata'];
}

export interface RunHostDiagnosticRecorderOptions {
  wallNow?: () => number;
  monotonicNow?: () => number;
  createId?: () => string;
  onRecorded?: (event: HostDiagnosticEvent) => void;
}

interface DiagnosticObservationBase {
  runId: string;
  errorCode: HostDiagnosticErrorCode;
  parentOperationId?: string;
  toolCallId?: string;
  executionId?: string;
}

export interface RunHostDiagnosticObservationInput extends DiagnosticObservationBase {
  phase: RunHostDiagnosticPhase;
}

export interface SkillHostDiagnosticObservationInput extends DiagnosticObservationBase {
  phase: SkillHostDiagnosticPhase;
}

export type HostDiagnosticObservationInput =
  | ({ kind: 'run-host' } & RunHostDiagnosticObservationInput)
  | ({ kind: 'skill-host' } & SkillHostDiagnosticObservationInput);

export interface RunHostDiagnosticOperation {
  operationId: string;
  recorded: boolean;
  finish(outcome: RunHostDiagnosticFinishInput): void;
}

interface StartedOperation {
  readonly monotonicAt: number;
}

const operationKey = (runId: string, operationId: string): string =>
  JSON.stringify([runId, operationId]);

const sameFinish = (event: HostDiagnosticEvent, outcome: RunHostDiagnosticFinishInput): boolean =>
  event.state === outcome.state &&
  event.errorCode === outcome.errorCode &&
  JSON.stringify(event.metadata ?? null) === JSON.stringify(outcome.metadata ?? null);

/** 为 Run 宿主事实分配身份与时间；SQLite Repository 仍拥有定序和原子写入。 */
export class RunHostDiagnosticRecorder {
  private readonly started = new Map<string, StartedOperation>();
  private readonly terminal = new Map<string, HostDiagnosticEvent>();
  private readonly wallNow: () => number;
  private readonly monotonicNow: () => number;
  private readonly createId: () => string;
  private readonly onRecorded: ((event: HostDiagnosticEvent) => void) | undefined;

  constructor(
    private readonly repository: RunHostDiagnosticRepository,
    options: RunHostDiagnosticRecorderOptions = {},
  ) {
    this.wallNow = options.wallNow ?? (() => Date.now());
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.createId = options.createId ?? randomUUID;
    this.onRecorded = options.onRecorded;
  }

  start(input: RunHostDiagnosticStartInput): HostDiagnosticEvent {
    const event = this.repository.append({
      ...input,
      id: this.createId(),
      state: 'started',
      createdAt: this.wallNow(),
    });
    this.publishInvalidation(event);
    try {
      const monotonicAt = this.monotonicNow();
      if (Number.isFinite(monotonicAt) && monotonicAt >= 0) {
        this.started.set(operationKey(event.runId, event.operationId), { monotonicAt });
      }
    } catch (error) {
      this.logObserverFailure(event, 'clock-start', error);
    }
    return event;
  }

  finish(
    startedEvent: HostDiagnosticEvent,
    outcome: RunHostDiagnosticFinishInput,
  ): HostDiagnosticEvent {
    if (startedEvent.state !== 'started') {
      throw new Error('Only a started host diagnostic operation can be closed');
    }
    const key = operationKey(startedEvent.runId, startedEvent.operationId);
    const cached = this.terminal.get(key);
    if (cached && sameFinish(cached, outcome)) return cached;

    const monotonicAt = this.started.get(key)?.monotonicAt;
    let monotonicEnd: number | undefined;
    try {
      monotonicEnd = this.monotonicNow();
    } catch (error) {
      this.logObserverFailure(startedEvent, 'clock-finish', error);
    }
    const durationMs =
      monotonicAt !== undefined &&
      monotonicEnd !== undefined &&
      Number.isFinite(monotonicEnd) &&
      monotonicEnd >= monotonicAt
        ? monotonicEnd - monotonicAt
        : undefined;
    const input = hostDiagnosticEventInputSchema.parse({
      id: this.createId(),
      runId: startedEvent.runId,
      operationId: startedEvent.operationId,
      kind: startedEvent.kind,
      phase: startedEvent.phase,
      state: outcome.state,
      createdAt: this.wallNow(),
      ...(startedEvent.parentOperationId
        ? { parentOperationId: startedEvent.parentOperationId }
        : {}),
      ...(startedEvent.toolCallId ? { toolCallId: startedEvent.toolCallId } : {}),
      ...(startedEvent.executionId ? { executionId: startedEvent.executionId } : {}),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(outcome.errorCode === undefined ? {} : { errorCode: outcome.errorCode }),
      ...(outcome.metadata === undefined ? {} : { metadata: outcome.metadata }),
    });
    const event = this.repository.append(input);
    this.started.delete(key);
    this.terminal.set(key, event);
    this.publishInvalidation(event);
    return event;
  }

  private publishInvalidation(event: HostDiagnosticEvent): void {
    try {
      this.onRecorded?.(event);
    } catch (error) {
      this.logObserverFailure(event, 'change-push', error);
    }
  }

  beginOperation(input: HostDiagnosticObservationInput): RunHostDiagnosticOperation {
    let operationId: string;
    try {
      operationId = this.createId();
    } catch (error) {
      this.logObserverFailure(input, 'operation-id', error);
      operationId = randomUUID();
    }
    const { errorCode, ...startInput } = input;
    void errorCode;
    let startedEvent: HostDiagnosticEvent | undefined;
    try {
      startedEvent = this.start({ ...startInput, operationId });
    } catch (error) {
      this.logObserverFailure(input, 'start', error);
    }
    let closed = false;
    return {
      operationId,
      recorded: startedEvent !== undefined,
      finish: (outcome) => {
        if (closed) return;
        closed = true;
        if (!startedEvent) return;
        try {
          this.finish(startedEvent, outcome);
        } catch (error) {
          this.logObserverFailure(input, 'finish', error);
        }
      },
    };
  }

  observeSync<T>(input: RunHostDiagnosticObservationInput, operation: () => T): T {
    const observation = this.beginOperation({ kind: 'run-host', ...input });
    try {
      const result = operation();
      this.finishObservation(observation, undefined, input.errorCode);
      return result;
    } catch (error) {
      this.finishObservation(observation, error, input.errorCode);
      throw error;
    }
  }

  observeSyncWithOperation<T>(
    input: HostDiagnosticObservationInput,
    operation: (observation: RunHostDiagnosticOperation) => T,
  ): T {
    const observation = this.beginOperation(input);
    try {
      const result = operation(observation);
      this.finishObservation(observation, undefined, input.errorCode);
      return result;
    } catch (error) {
      this.finishObservation(observation, error, input.errorCode);
      throw error;
    }
  }

  async observe<T>(
    input: RunHostDiagnosticObservationInput,
    operation: () => Promise<T>,
  ): Promise<T> {
    const observation = this.beginOperation({ kind: 'run-host', ...input });
    try {
      const result = await operation();
      this.finishObservation(observation, undefined, input.errorCode);
      return result;
    } catch (error) {
      this.finishObservation(observation, error, input.errorCode);
      throw error;
    }
  }

  async observeWithOperation<T>(
    input: HostDiagnosticObservationInput,
    operation: (observation: RunHostDiagnosticOperation) => Promise<T>,
  ): Promise<T> {
    const observation = this.beginOperation(input);
    try {
      const result = await operation(observation);
      this.finishObservation(observation, undefined, input.errorCode);
      return result;
    } catch (error) {
      this.finishObservation(observation, error, input.errorCode);
      throw error;
    }
  }

  private finishObservation(
    observation: RunHostDiagnosticOperation,
    error: unknown,
    errorCode: HostDiagnosticErrorCode = 'observer-failed',
  ): void {
    const state = error === undefined ? 'completed' : isAbortError(error) ? 'cancelled' : 'failed';
    observation.finish({
      state,
      ...(error === undefined
        ? { metadata: { result: 'success' } }
        : {
            errorCode: state === 'cancelled' ? 'cancelled' : errorCode,
            metadata: { result: state === 'cancelled' ? 'cancelled' : 'failure' },
          }),
    });
  }

  private logObserverFailure(
    input: Pick<HostDiagnosticEvent, 'runId' | 'phase'>,
    operation: string,
    error: unknown,
  ): void {
    console.error('Run host diagnostics observer failed', {
      runId: input.runId,
      phase: input.phase,
      operation,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}
