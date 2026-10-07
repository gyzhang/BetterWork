import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type {
  JobSpec,
  ValidationStateInput,
  VerifiedExecutionOutput,
} from '@betterwork/agent-protocol';

import { hashBytes, managedPath, readManagedFile } from '../infrastructure/managed-files';
import type { SupervisorCapture } from '../infrastructure/process-supervisor';

/** Application-owned collector, deliberately separate from process control messages. */
export class ExecutionOutputService {
  private readonly validationInputs = new Map<string, Array<string | undefined>>();

  prepare(spec: JobSpec): void {
    const contracts = this.contractsFor(spec);
    if (contracts.length !== spec.expectedOutputs.length) {
      throw new Error('Output declaration count does not match expected output paths');
    }
    this.validationInputs.set(
      spec.executionId,
      spec.expectedOutputs.map((file, index) => {
        const contract = contracts[index];
        if (!contract) throw new Error('Output contract is missing');
        if (contract.mode === 'unchanged') return hashBytes(readManagedFile(spec.cwd, file));
        if (existsSync(managedPath(spec.cwd, file)))
          throw new Error('Output already exists; use a new attempt');
        return undefined;
      }),
    );
  }

  collect(spec: JobSpec, capture: SupervisorCapture): VerifiedExecutionOutput[] {
    const before = this.validationInputs.get(spec.executionId);
    this.validationInputs.delete(spec.executionId);
    if (spec.requireCompleteStdout && capture.truncated) {
      throw new Error('Command output was truncated; refusing to publish an incomplete report');
    }
    const contracts = this.contractsFor(spec);
    return spec.expectedOutputs.map((file, index) => {
      const contract = contracts[index];
      if (!contract) throw new Error('Output contract is missing');
      const bytes = readManagedFile(spec.cwd, file);
      const fileHash = hashBytes(bytes);
      if (contract.mode === 'unchanged' && before?.[index] !== fileHash)
        throw new Error('Command changed a declared read-only output source');
      const report = JSON.stringify({
        version: 1,
        executionId: spec.executionId,
        fileHash,
        mimeType: contract.mimeType,
        validation: contract.validation,
        stdout: capture.stdout,
      });
      const outputId = randomUUID();
      const relativePath = path.join(
        '.outputs',
        spec.executionId,
        `${outputId}.${contract.extension}`,
      );
      const destination = managedPath(spec.cwd, relativePath, true);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, bytes, { flag: 'wx', mode: 0o400 });
      writeFileSync(`${destination}.report.json`, report, { flag: 'wx', mode: 0o400 });
      return {
        outputId,
        relativePath,
        fileHash,
        fileSize: bytes.length,
        reportHash: hashBytes(Buffer.from(report)),
        validation: contract.validation,
        mimeType: contract.mimeType,
      };
    });
  }

  private contractsFor(spec: JobSpec): NonNullable<JobSpec['outputContracts']> {
    return (
      spec.outputContracts ??
      spec.expectedOutputs.map((file) => ({
        mode: 'create' as const,
        extension: path.extname(file).slice(1).toLowerCase() || 'bin',
        mimeType: 'application/octet-stream',
        validation: {
          structure: 'not-checked',
          visual: 'not-checked',
          manualEdit: 'not-checked',
        } satisfies ValidationStateInput,
      }))
    );
  }

  discard(executionId: string): void {
    this.validationInputs.delete(executionId);
  }
}
