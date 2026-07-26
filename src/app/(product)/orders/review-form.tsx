"use client";

import { useActionState } from "react";

import { submitReview, type CommerceState } from "@/features/commerce/actions";

export function ReviewForm({ orderId, revieweeName }: { orderId: string; revieweeName: string }) {
  const [state, action, pending] = useActionState<CommerceState, FormData>(submitReview, {});

  if (state.ok) return <p className="text-sm text-success">Review posted — thanks.</p>;

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="order_id" value={orderId} />
      <select
        name="rating"
        defaultValue="5"
        className="h-9 rounded-input border border-border bg-app px-2 text-sm text-text-primary outline-none"
        aria-label={`Rate ${revieweeName}`}
      >
        {[5, 4, 3, 2, 1].map((n) => (
          <option key={n} value={n}>
            {"★".repeat(n)}
          </option>
        ))}
      </select>
      <input
        name="body"
        placeholder={`Review ${revieweeName} (optional)`}
        className="h-9 min-w-[180px] flex-1 rounded-input border border-border bg-app px-3 text-sm text-text-primary outline-none placeholder:text-text-muted"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-pill bg-accent px-4 py-1.5 text-sm font-semibold text-white"
      >
        {pending ? "…" : "Post review"}
      </button>
      {state.error && <p className="w-full text-sm text-red-400">{state.error}</p>}
    </form>
  );
}
