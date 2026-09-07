import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface ConfirmationDialogProps {
  title: string;
  detail: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationDialog({
  title,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps): React.JSX.Element {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const application = document.querySelector('main');
    const wasInert = application?.hasAttribute('inert') ?? false;
    application?.setAttribute('inert', '');
    cancelButtonRef.current?.focus();

    return () => {
      if (application && !wasInert) application.removeAttribute('inert');
      if (previousFocus instanceof HTMLElement && document.contains(previousFocus)) {
        previousFocus.focus();
      }
    };
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const cancel = cancelButtonRef.current;
    const confirm = confirmButtonRef.current;
    if (!cancel || !confirm) return;
    if (event.shiftKey && document.activeElement === cancel) {
      event.preventDefault();
      confirm.focus();
    } else if (!event.shiftKey && document.activeElement === confirm) {
      event.preventDefault();
      cancel.focus();
    }
  };

  return createPortal(
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-dialog-title"
        aria-describedby="confirmation-dialog-detail"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="eyebrow">请确认</p>
        <h2 id="confirmation-dialog-title">{title}</h2>
        <p id="confirmation-dialog-detail" className="confirmation-dialog-detail">
          {detail}
        </p>
        <footer>
          <button
            ref={cancelButtonRef}
            className="secondary-button"
            type="button"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            ref={confirmButtonRef}
            className="danger-confirm-button"
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
