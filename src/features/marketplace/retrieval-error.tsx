"use client";

import { useState } from "react";
import { Button, EmptyState } from "@/components/ui";

export function MarketplaceRetrievalError({ reference }: { reference: string }) {
  const [pending, setPending] = useState(false);
  return (
    <div role="alert">
      <EmptyState
        mark="!"
        title="Parts couldn’t be loaded"
        action={<Button variant="ghost" loading={pending} pendingLabel="Retrying…" onClick={() => { setPending(true); window.location.reload(); }}>Retry</Button>}
      >
        Your search is still here. Try again in a moment.
      </EmptyState>
      <p className="microlabel mt-3">Reference: {reference}</p>
    </div>
  );
}
