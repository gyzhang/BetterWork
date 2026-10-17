import type { RunDiagnosticsScopeRequest } from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';
import { useTransientToast } from './use-transient-toast';

interface RunDiagnosticPackageExportState {
  busy: boolean;
  error: string;
}

const initialState = (): RunDiagnosticPackageExportState => ({ busy: false, error: '' });

/** Export a single scoped Run package and keep cancellation silent. */
export function useRunDiagnosticPackageExport(scope: RunDiagnosticsScopeRequest): {
  busy: boolean;
  error: string;
  toast: ReturnType<typeof useTransientToast>['toast'];
  run: () => void;
  dismissToast: () => void;
} {
  const [state, setState] = useState<RunDiagnosticPackageExportState>(initialState);
  const requestIdRef = useRef(0);
  const exportingRef = useRef(false);
  const { toast, showToast, dismissToast } = useTransientToast();
  const { workspaceId, taskId, runId } = scope;

  useEffect(
    () => () => {
      requestIdRef.current += 1;
    },
    [runId, taskId, workspaceId],
  );

  const run = useCallback((): void => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    dismissToast();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState({ busy: true, error: '' });

    const performExport = async (): Promise<void> => {
      try {
        const result = await window.betterwork.runs.exportDiagnosticPackage({
          workspaceId,
          taskId,
          runId,
        });
        if (requestIdRef.current !== requestId) return;
        if (!result.cancelled && result.byteLength !== undefined) {
          showToast('success', `诊断包已保存（${result.byteLength} 字节）`);
        }
      } catch (failure) {
        if (requestIdRef.current === requestId) {
          setState((current) => ({
            ...current,
            error: describeActionError(failure, '导出诊断包失败，请重试。'),
          }));
        }
      } finally {
        exportingRef.current = false;
        if (requestIdRef.current === requestId) {
          setState((current) => ({ ...current, busy: false }));
        }
      }
    };

    trackAction(performExport(), '导出 Run 诊断包');
  }, [dismissToast, runId, showToast, taskId, workspaceId]);

  return { ...state, toast, run, dismissToast };
}
