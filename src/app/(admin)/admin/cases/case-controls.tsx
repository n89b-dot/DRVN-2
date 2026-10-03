"use client";

import { unstable_rethrow, useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui";

import { adminCaseClaim, adminCaseUpdate } from "@/lib/admin/actions";

type State = { error?: string; ok?: string } | null;

/** Claim/release + a fold-out priority/labels form. Everything audited. */
export function CaseControls({
  caseId,
  claimedByMe,
  claimed,
  priority,
  labels,
  resolved,
}: {
  caseId: string;
  claimedByMe: boolean;
  claimed: boolean;
  priority: "normal" | "high";
  labels: string[];
  resolved: boolean;
}) {
  const router = useRouter();
  const [claimState, setClaimState] = useState<State>(null);
  const [editState, setEditState] = useState<State>(null);
  const [claiming, setClaiming] = useState(false);
  const [editing, setEditing] = useState(false);
  const claimInFlight = useRef(false);
  const editInFlight = useRef(false);
  const [open, setOpen] = useState(false);

  // A transition, so a redirect the action already followed (MFA step-up)
  // lands in Next's redirect boundary instead of a second navigation.
  const [, startTransition] = useTransition();

  function submitClaim(formData: FormData) {
    if (claimInFlight.current) return;
    claimInFlight.current = true;
    setClaimState(null);
    setClaiming(true);
    startTransition(async () => {
      try {
        const result = await adminCaseClaim(formData);
        setClaimState(result);
        if (result && "ok" in result && result.ok) router.refresh();
      } catch (error) {
        unstable_rethrow(error);
        setClaimState({ error: "Couldn't confirm whether the claim changed. Reload the queue before issuing another claim command." });
      } finally {
        claimInFlight.current = false;
        setClaiming(false);
      }
    });
  }

  function submitEdit(formData: FormData) {
    if (editInFlight.current) return;
    editInFlight.current = true;
    setEditState(null);
    setEditing(true);
    startTransition(async () => {
      try {
        const result = await adminCaseUpdate(formData);
        setEditState(result);
        if (result && "ok" in result && result.ok) router.refresh();
      } catch (error) {
        unstable_rethrow(error);
        setEditState({ error: "Couldn't confirm whether the case changed. Your labels are still here; reload the queue before trying again." });
      } finally {
        editInFlight.current = false;
        setEditing(false);
      }
    });
  }

  if (resolved) return <span className="chip chip--ok">resolved</span>;

  return (
    <span className="flex flex-wrap items-center gap-2">
      <form onSubmit={(event) => { event.preventDefault(); void submitClaim(new FormData(event.currentTarget)); }}>
        <input type="hidden" name="case_id" value={caseId} />
        <Button type="submit" variant="ghost" loading={claiming} pendingLabel="…">
          {claimedByMe ? "Release" : claimed ? "Take over" : "Claim"}
        </Button>
      </form>
      <button
        type="button"
        className="jumplink"
        aria-expanded={open}
        onClick={() => setOpen((state) => !state)}
      >
        {open ? "Close" : "Label"}
      </button>
      {open && (
        <form onSubmit={(event) => { event.preventDefault(); void submitEdit(new FormData(event.currentTarget)); }} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="case_id" value={caseId} />
          <select name="priority" defaultValue={priority} className="ctl !w-28 !py-1 text-micro" aria-label="Priority">
            <option value="normal">normal</option>
            <option value="high">high</option>
          </select>
          <input
            name="labels"
            defaultValue={labels.join(", ")}
            placeholder="labels, comma-separated"
            className="ctl !w-52 !py-1 text-micro"
            aria-label="Labels"
          />
          <Button type="submit" variant="ghost" loading={editing} pendingLabel="…">
            Save
          </Button>
        </form>
      )}
      {(claimState?.error || editState?.error) && (
        <span role="alert" className="text-micro text-live">
          {claimState?.error ?? editState?.error}
        </span>
      )}
      {(claimState?.ok || editState?.ok) && (
        <span role="status" aria-live="polite" className="chip chip--ok">
          {editState?.ok ?? claimState?.ok}
        </span>
      )}
    </span>
  );
}
