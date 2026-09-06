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
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="eyebrow">请确认</p>
        <h2 id="confirmation-dialog-title">{title}</h2>
        <p className="confirmation-dialog-detail">{detail}</p>
        <footer>
          <button className="secondary-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="danger-confirm-button" type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
