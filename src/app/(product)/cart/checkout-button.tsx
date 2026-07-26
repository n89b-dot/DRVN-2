"use client";

import { useState, useTransition } from "react";

import type { CommerceState } from "@/features/commerce/actions";

export function CheckoutButton({ action }: { action: () => Promise<CommerceState> }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await action();
            if (result?.error) setError(result.error);
          })
        }
        className="btn btn--live w-full"
      >
        {pending ? "Placing order…" : "Confirm and pay"}
      </button>
      {error && (
        <p className="field__err mt-2" style={{ display: "flex" }}>
          {error}
        </p>
      )}
    </div>
  );
}
