import { useEffect } from 'react';

import { AlertIcon, CheckIcon } from '../icons';

export type ToastTone = 'success' | 'error';

export function TransientToast({
  tone,
  message,
  onDismiss,
}: {
  tone: ToastTone;
  message: string;
  onDismiss: () => void;
}): React.JSX.Element {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, tone === 'error' ? 6_000 : 4_000);
    return () => window.clearTimeout(timer);
  }, [onDismiss, tone, message]);

  return (
    <div className="page-toast-host" aria-live="polite">
      <div className="toast" role="status">
        <span className={`level-${tone}`} aria-hidden="true">
          {tone === 'success' ? <CheckIcon size={12} /> : <AlertIcon size={12} />}
        </span>
        <p>{message}</p>
      </div>
    </div>
  );
}
