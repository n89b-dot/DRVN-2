"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";

import { Dialog } from "@/components/ui";
import type { AdminActionState } from "@/lib/admin/actions";
import { cx } from "@/lib/format";

export type ActionField =
  | { kind: "reason"; name?: string; label?: string; placeholder?: string }
  | { kind: "amount"; name?: string; label: string; hint?: string }
  | { kind: "select"; name: string; label: string; options: { value: string; label: string }[] };

/**
 * One pattern for every admin mutation: a trigger button opening the shared
 * accessible Dialog, a form with real <label htmlFor> associations (the
 * microlabel-with-no-association mistake stops here), hidden subject ids, a
 * required reason, and the outcome surfaced inline. Success closes the dialog
 * after a beat so the refreshed data underneath is what the admin sees next.
 */
export function ActionDialog({
  action,
  title,
  trigger,
  triggerClassName = "btn",
  hidden,
  fields,
  submitLabel,
  danger = false,
  confirmNote,
}: {
  action: (prev: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  title: string;
  trigger: string;
  triggerClassName?: string;
  /** Subject ids etc., rendered as hidden inputs. */
  hidden: Record<string, string>;
  fields: ActionField[];
  submitLabel: string;
  /** Money-moving / destructive actions get the one --live button. */
  danger?: boolean;
  /** A sentence above the form spelling out what will happen. */
  confirmNote?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, null);
  const idBase = useId();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state?.ok) {
      closeTimer.current = setTimeout(() => setOpen(false), 1200);
    }
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [state]);

  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>
        {trigger}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} label={title} align="center">
        <div className="sheet w-[min(92vw,460px)]">
          <h2 className="mb-1 font-display text-[17px] font-semibold tracking-tight">{title}</h2>
          {confirmNote && <p className="mb-3 text-[13.5px] text-dim">{confirmNote}</p>}

          <form action={formAction} className="grid gap-3">
            {Object.entries(hidden).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}

            {fields.map((f, i) => {
              const fieldId = `${idBase}-${i}`;
              if (f.kind === "reason") {
                return (
                  <div key={fieldId} className="field">
                    <label htmlFor={fieldId} className="microlabel">
                      {f.label ?? "Reason (recorded in the audit log)"}
                    </label>
                    <textarea
                      id={fieldId}
                      name={f.name ?? "reason"}
                      required
                      rows={3}
                      maxLength={500}
                      className="ctl"
                      placeholder={f.placeholder ?? "Why — visible to other admins forever"}
                    />
                  </div>
                );
              }
              if (f.kind === "amount") {
                return (
                  <div key={fieldId} className="field">
                    <label htmlFor={fieldId} className="microlabel">
                      {f.label}
                    </label>
                    <input
                      id={fieldId}
                      name={f.name ?? "amount"}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0.01"
                      className="ctl"
                      placeholder="Leave blank for the full amount"
                    />
                    {f.hint && <p className="mt-1 text-[12.5px] text-dim">{f.hint}</p>}
                  </div>
                );
              }
              return (
                <div key={fieldId} className="field">
                  <label htmlFor={fieldId} className="microlabel">
                    {f.label}
                  </label>
                  <select id={fieldId} name={f.name} required className="ctl">
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}

            {state?.error && (
              <p role="alert" aria-live="polite" className="field__err">
                {state.error}
              </p>
            )}
            {state?.ok && (
              <p role="status" aria-live="polite" className="chip chip--ok">
                {state.ok}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              className={cx("btn", danger && "btn--live", pending && "opacity-60")}
            >
              {pending ? "Working…" : submitLabel}
            </button>
          </form>
        </div>
      </Dialog>
    </>
  );
}
