"use client";

import { useRouter } from "next/navigation";
import { useActionState, useId, useState } from "react";

import { Dialog } from "@/components/ui";

import { fileReport, type ReportState } from "./actions";

const REASON_OPTIONS = [
  { value: "prohibited_item", label: "Prohibited item (airbags, cats, VIN parts…)" },
  { value: "counterfeit", label: "Counterfeit or replica sold as genuine" },
  { value: "stolen_goods", label: "Possibly stolen" },
  { value: "scam_or_fraud", label: "Scam or fraud" },
  { value: "offensive_content", label: "Offensive content" },
  { value: "wrong_category", label: "Miscategorised" },
  { value: "other", label: "Something else" },
];

/**
 * The report button (Rev E item 13). Quiet by design — a jumplink, not a
 * signal-red control — opening the shared Dialog with a labelled reason
 * select. Signed-out users are sent to login by the server action.
 */
export function ReportButton({
  subjectType,
  subjectId,
  subjectLabel,
  isLoggedIn,
}: {
  subjectType: "listing" | "user";
  subjectId: string;
  subjectLabel: string;
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ReportState, FormData>(fileReport, null);
  const idBase = useId();

  return (
    <>
      <button
        type="button"
        className="jumplink"
        onClick={() => {
          if (!isLoggedIn) {
            router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
            return;
          }
          setOpen(true);
        }}
      >
        Report {subjectType === "listing" ? "this listing" : "this seller"}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        label={`Report ${subjectLabel}`}
        align="center"
      >
        <div className="sheet w-[min(92vw,440px)] text-left">
          <span className="microlabel microlabel--ink">Report {subjectLabel}</span>
          <p className="field__hint mt-1">
            Goes straight to DRVN&apos;s review queue. The {subjectType === "listing" ? "seller" : "user"}{" "}
            isn&apos;t told who reported.
          </p>
          <form action={formAction} className="mt-4 flex flex-col gap-3">
            <input type="hidden" name="subject_type" value={subjectType} />
            <input type="hidden" name="subject_id" value={subjectId} />
            <div className="field">
              <label htmlFor={`${idBase}-reason`} className="microlabel">
                What&apos;s wrong
              </label>
              <select id={`${idBase}-reason`} name="reason" required className="ctl max-w-none">
                {REASON_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${idBase}-detail`} className="microlabel">
                Anything that helps — optional
              </label>
              <textarea
                id={`${idBase}-detail`}
                name="detail"
                rows={3}
                maxLength={1000}
                placeholder="What you saw, where"
                className="ctl"
              />
            </div>
            {state?.error && (
              <p role="alert" aria-live="polite" className="field__err">
                {state.error}
              </p>
            )}
            {state?.ok ? (
              <p role="status" aria-live="polite" className="chip chip--ok">
                {state.ok}
              </p>
            ) : (
              <button type="submit" disabled={pending} className="btn btn--live">
                {pending ? "Sending…" : "Send report"}
              </button>
            )}
          </form>
        </div>
      </Dialog>
    </>
  );
}
