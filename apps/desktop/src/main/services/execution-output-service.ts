import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { JobSpec, VerifiedExecutionOutput } from '@betterwork/agent-protocol';

import { hashBytes, managedPath, readManagedFile } from '../infrastructure/managed-files';
import type { SupervisorCapture } from '../infrastructure/process-supervisor';
import { isCompleteValidationReport } from './ppt-generation-preset';

/** Application-owned collector, deliberately separate from process control messages. */
export class ExecutionOutputService {
  private readonly validationInputs = new Map<string, string[]>();

  prepare(spec: JobSpec): void {
    if (spec.validatorId && spec.validatorId !== 'pptx-validate')
      throw new Error('Unknown validator');
    if (spec.validatorId === 'pptx-validate') {
      if (spec.expectedOutputs.length !== 1)
        throw new Error('Validation requires exactly one output');
      this.validationInputs.set(
        spec.executionId,
        spec.expectedOutputs.map((file) => hashBytes(readManagedFile(spec.cwd, file))),
      );
    } else {
      for (const file of spec.expectedOutputs) {
        if (existsSync(managedPath(spec.cwd, file)))
          throw new Error('Output already exists; use a new attempt');
      }
    }
  }

  collect(spec: JobSpec, capture: SupervisorCapture): VerifiedExecutionOutput[] {
    const before = this.validationInputs.get(spec.executionId);
    this.validationInputs.delete(spec.executionId);
    if (spec.validatorId && (capture.truncated || !isCompleteValidationReport(capture.stdout))) {
      throw new Error('完整结构校验报告缺失或包含问题，拒绝登记输出');
    }
    return spec.expectedOutputs.map((file, index) => {
      const bytes = readManagedFile(spec.cwd, file);
      const fileHash = hashBytes(bytes);
      if (spec.validatorId && before?.[index] !== fileHash)
        throw new Error('Output changed during validation');
      if (spec.validatorId && (bytes[0] !== 0x50 || bytes[1] !== 0x4b))
        throw new Error('Output is not a PPTX ZIP');
      const report = JSON.stringify({
        version: 1,
        executionId: spec.executionId,
        fileHash,
        validatorId: spec.validatorId ?? null,
        report: spec.validatorId ? capture.stdout : null,
      });
      const outputId = randomUUID();
      const relativePath = path.join('.outputs', spec.executionId, `${outputId}.pptx`);
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
        validation: {
          structure: spec.validatorId ? 'passed' : 'not-checked',
          visual: 'not-checked',
          manualEdit: 'not-checked',
        },
      };
    });
  }

  discard(executionId: string): void {
    this.validationInputs.delete(executionId);
  }
}
