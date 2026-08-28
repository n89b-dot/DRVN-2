"use client";

import { useActionState, useState } from "react";

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
  const [claimState, claimAction, claiming] = useActionState<State, FormData>(
    async (_prev, fd) => adminCaseClaim(fd),
    null,
  );
  const [editState, editAction, editing] = useActionState<State, FormData>(
    async (_prev, fd) => adminCaseUpdate(fd),
    null,
  );
  const [open, setOpen] = useState(false);

  if (resolved) return <span className="chip chip--ok">resolved</span>;

  return (
    <span className="flex flex-wrap items-center gap-2">
      <form action={claimAction}>
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
        <form action={editAction} className="flex flex-wrap items-center gap-2">
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
    </span>
  );
}
