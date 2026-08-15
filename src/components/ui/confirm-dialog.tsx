"use client";

import { useState } from "react";

import { Dialog } from "./dialog";

export type ConfirmDialogProps = {
  title: string;
  /** What happens if the user confirms — a bullet list, or custom content. */
  consequences: string[] | React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Money/inventory-affecting or irreversible actions get the one --live button. */
  destructive?: boolean;
  /** Trigger content, rendered inside the opening button. */
  children: React.ReactNode;
  triggerClassName?: string;
  triggerDisabled?: boolean;
  /** Form-action mode: rendered as `<form action={formAction}>` inside the dialog. */
  formAction?: (formData: FormData) => void | Promise<void>;
  /** Hidden inputs for form-action mode, e.g. `{ order_id: id }`. */
  hidden?: Record<string, string>;
  /** Callback mode — used when there's no form to submit. */
  onConfirm?: () => void | Promise<void>;
  pending?: boolean;
  error?: string | null;
  /** Extra fields rendered above the buttons — e.g. a reason input. */
  fields?: React.ReactNode;
  /** Typed confirmation for the irreversible tier: the confirm button stays
   *  disabled until the user types this exact string (e.g. the car's name). */
  confirmText?: string;
};

/**
 * One accessible two-step confirmation, built on the shared Dialog primitive.
 *
 * Three bespoke versions of this existed (listing delete, order cancel, admin
 * actions) plus one bare `confirm()` — none stated what would actually
 * change, and the browser confirm had no styling, no consequences, and
 * doesn't work in tests. This says what changes, whether it's reversible,
 * and any money/inventory impact, every time.
 */
export function ConfirmDialog({
  title,
  consequences,
  confirmLabel,
  cancelLabel = "Keep it",
  destructive = false,
  children,
  triggerClassName = "relbtn !static",
  triggerDisabled = false,
  formAction,
  hidden,
  onConfirm,
  pending = false,
  error,
  fields,
  confirmText,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const confirmBlocked = Boolean(confirmText) && typed.trim() !== confirmText;

  const list = Array.isArray(consequences) ? (
    <ul className="mt-2 grid gap-1 list-disc pl-4 text-micro leading-relaxed text-dim">
      {consequences.map((c, i) => (
        <li key={i}>{c}</li>
      ))}
    </ul>
  ) : (
    consequences
  );

  const content = (
    <div className="sheet">
      <h2 className="mb-1 font-display text-body font-semibold tracking-tight">{title}</h2>
      {list}
      {fields}
      {confirmText && (
        <div className="field mt-3 !mb-0">
          <label className="microlabel" htmlFor="confirm-text-gate">
            Type <b className="text-ink normal-case">{confirmText}</b> to confirm
          </label>
          <input
            id="confirm-text-gate"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className="ctl max-w-none"
          />
        </div>
      )}
      {error && (
        <p role="alert" aria-live="polite" className="field__err mt-2">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => setOpen(false)} className="btn btn--ghost">
          {cancelLabel}
        </button>
        <button
          type={formAction ? "submit" : "button"}
          onClick={formAction ? undefined : () => onConfirm?.()}
          disabled={pending || confirmBlocked}
          className={destructive ? "btn btn--live" : "btn"}
        >
          {pending ? "Working…" : confirmLabel}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => setOpen(true)}
        disabled={triggerDisabled}
      >
        {children}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} label={title} align="center">
        {formAction ? (
          <form action={formAction}>
            {Object.entries(hidden ?? {}).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            {content}
          </form>
        ) : (
          content
        )}
      </Dialog>
    </>
  );
}
