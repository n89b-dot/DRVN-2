"use client";

import Link from "next/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";

import { Dialog } from "@/components/ui";

import { fileReport, type ReportState } from "./actions";

export type ReportSubject = "listing" | "user" | "post" | "comment";

const SUBJECT_WORDS: Record<ReportSubject, { trigger: string; owner: string }> = {
  listing: { trigger: "Report this listing", owner: "seller" },
  user: { trigger: "Report this seller", owner: "user" },
  post: { trigger: "Report this post", owner: "author" },
  comment: { trigger: "Report", owner: "author" },
};

const REASON_OPTIONS = [
  { value: "prohibited_item", label: "Prohibited item (airbags, cats, VIN parts…)" },
  { value: "counterfeit", label: "Counterfeit or replica sold as genuine" },
  { value: "stolen_goods", label: "Possibly stolen" },
  { value: "scam_or_fraud", label: "Scam or fraud" },
  { value: "offensive_content", label: "Offensive content" },
  { value: "wrong_category", label: "Miscategorised" },
  { value: "copyright", label: "Uses my photos or work without permission" },
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
  triggerLabel,
  context,
}: {
  subjectType: ReportSubject;
  subjectId: string;
  subjectLabel: string;
  isLoggedIn: boolean;
  /** Overrides "Report this listing/seller" — e.g. "Report" in a conversation header. */
  triggerLabel?: string;
  /** Where the report was filed from, prefixed to the detail for the review
   *  queue — e.g. "From conversation <id>", so a reviewer can open the thread. */
  context?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const reportId = useRef<string | null>(null);
  const [detail, setDetail] = useState("");
  const [reason, setReason] = useState(REASON_OPTIONS[0].value);
  const [state, setState] = useState<ReportState>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  // A transition, so a redirect the action already followed — the sign-in
  // redirect when the session has ended, for one — lands in Next's redirect
  // boundary instead of being followed a second time.
  const [, startTransition] = useTransition();

  function submit(data: FormData) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    reportId.current ??= crypto.randomUUID();
    data.set("report_id", reportId.current);
    startTransition(async () => {
      try { setState(await fileReport(state, data)); }
      catch (error) { unstable_rethrow(error); setState({ error: "Couldn't confirm your report was filed. Your details are still here; try again." }); }
      finally { inFlight.current = false; setPending(false); }
    });
  }
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
        {triggerLabel ?? SUBJECT_WORDS[subjectType].trigger}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        label={`Report ${subjectLabel}`}
        align="center"
      >
        <div className="sheet text-left">
          <span className="microlabel microlabel--ink">Report {subjectLabel}</span>
          <p className="field__hint mt-1">
            Goes straight to DRVN&apos;s review queue. The {SUBJECT_WORDS[subjectType].owner}{" "}
            isn&apos;t told who reported.
          </p>
          <form onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }} className="mt-4 flex flex-col gap-3">
            <input type="hidden" name="subject_type" value={subjectType} />
            <input type="hidden" name="subject_id" value={subjectId} />
            {context && <input type="hidden" name="context" value={context} />}
            <div className="field">
              <label htmlFor={`${idBase}-reason`} className="microlabel">
                What&apos;s wrong
              </label>
              <select id={`${idBase}-reason`} name="reason" value={reason} onChange={(event) => setReason(event.target.value)} disabled={pending} required className="ctl max-w-none">
                {REASON_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {/* R69-dmca: a report flags it for review; a rights holder's
                formal notice is what a takedown acts on. */}
            {reason === "copyright" && (
              <p className="field__hint">
                Own the rights? Send a{" "}
                <Link href="/copyright" className="jumplink">
                  copyright notice
                </Link>{" "}
                as well, so we can act on it formally.
              </p>
            )}
            <div className="field">
              <label htmlFor={`${idBase}-detail`} className="microlabel">
                Anything that helps — optional
              </label>
              <textarea
                id={`${idBase}-detail`}
                name="detail"
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                readOnly={pending}
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
