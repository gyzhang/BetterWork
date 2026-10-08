import { useRef } from 'react';

import { Button } from './Button';
import { Modal } from './Modal';
import { SectionHeader } from './SectionHeader';

export interface ConfirmationDialogProps {
  title: string;
  detail: string;
  confirmLabel: string;
  busy?: boolean | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 破坏性确认。基座是 `Modal`（inert、Esc、焦点陷阱与归还都在那里），
 * 这里只规定：这是 `alertdialog`、初始焦点落在「取消」、点背板等于取消。
 */
export function ConfirmationDialog({
  title,
  detail,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps): React.JSX.Element {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Modal
      variant="dialog"
      className="confirmation-dialog"
      label={title}
      describedBy="confirmation-dialog-detail"
      alert
      initialFocusRef={cancelButtonRef}
      onClose={onCancel}
    >
      <SectionHeader variant="block" eyebrow="请确认" title={title} />
      <p id="confirmation-dialog-detail" className="confirmation-dialog-detail">
        {detail}
      </p>
      <footer>
        <Button
          variant="secondary"
          size="md"
          ref={cancelButtonRef}
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          取消
        </Button>
        <Button variant="danger" size="md" type="button" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </footer>
    </Modal>
  );
}
