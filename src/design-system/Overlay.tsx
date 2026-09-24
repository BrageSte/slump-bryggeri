import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button.tsx";
import { cx } from "./cx.ts";
import { Icon } from "./Icon.tsx";

/**
 * Bottom sheet on phones, centred dialog on larger screens. Built on <dialog> so focus
 * trapping, Escape and the backdrop come from the platform.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal() moves focus to the first focusable element (the close button). Put it in the
      // first field instead so the (numeric) keyboard is up immediately when logging.
      dialog.querySelector<HTMLElement>("[data-sheet-body] input:not([type=hidden]):not([type=file]), [data-sheet-body] textarea")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cx(
        "m-0 mt-auto w-full max-w-none bg-transparent p-0 text-text backdrop:bg-black/50",
        "sm:m-auto sm:max-w-lg",
      )}
    >
      {open && (
        <div className="safe-bottom flex max-h-[92dvh] flex-col rounded-t-[20px] border border-border bg-surface shadow-xl sm:rounded-card">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <h2 id={titleId} className="flex-1 text-section font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Lukk"
              className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:bg-surface-2"
            >
              <Icon name="x" />
            </button>
          </div>
          <div data-sheet-body className="overflow-y-auto px-4 py-4">
            {children}
          </div>
          {footer && <div className="border-t border-border px-4 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger = false,
  loading = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      {children && <div className="mb-5 text-muted">{children}</div>}
      <div className="grid grid-cols-2 gap-3">
        <Button onClick={onClose} size="lg">
          Avbryt
        </Button>
        <Button variant={danger ? "danger" : "primary"} size="lg" onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </BottomSheet>
  );
}
