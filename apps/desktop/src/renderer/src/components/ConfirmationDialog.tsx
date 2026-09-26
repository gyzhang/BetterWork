import { useRef } from 'react';

import { Modal } from './Modal';

export interface ConfirmationDialogProps {
  title: string;
  detail: string;
  confirmLabel: string;
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
      <p className="eyebrow">请确认</p>
      <h2>{title}</h2>
      <p id="confirmation-dialog-detail" className="confirmation-dialog-detail">
        {detail}
      </p>
      <footer>
        <button ref={cancelButtonRef} className="secondary-button" type="button" onClick={onCancel}>
          取消
        </button>
        <button className="danger-confirm-button" type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </footer>
    </Modal>
  );
}
