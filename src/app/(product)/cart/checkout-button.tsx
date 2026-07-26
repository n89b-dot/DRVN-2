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
        className="h-12 w-full rounded-pill bg-accent text-sm font-semibold text-white transition hover:bg-accent/90"
      >
        {pending ? "Placing order…" : "Checkout"}
      </button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
