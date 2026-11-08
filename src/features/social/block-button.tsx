"use client";

import { useActionState, useState } from "react";

import { Button, ResultNote } from "@/components/ui";

import { blockMember, unblockMember, type BlockState } from "./block-actions";

/**
 * Block / Unblock a member (N54). Quiet, like Report: a jumplink-weight
 * button, then one confirm. The other member is never told.
 */
export function BlockButton({ memberId, memberName, blocked = false }: { memberId: string; memberName: string; blocked?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<BlockState, FormData>(blocked ? unblockMember : blockMember, {});

  if (state.ok) return <ResultNote ok={state.ok} />;

  if (!confirming && !blocked) {
    return (
      <Button variant="quiet" onClick={() => setConfirming(true)}>
        Block
      </Button>
    );
  }

  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="member_id" value={memberId} />
      {!blocked && <span className="text-micro text-dim">Block {memberName}? They won&apos;t be told.</span>}
      <Button type="submit" variant="quiet" loading={pending} pendingLabel={blocked ? "Unblocking…" : "Blocking…"}>
        {blocked ? "Unblock" : `Block ${memberName}`}
      </Button>
      {!blocked && (
        <Button variant="quiet" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      )}
      <ResultNote error={state.error ?? null} />
    </form>
  );
}
