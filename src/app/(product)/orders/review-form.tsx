"use client";

import { useActionState } from "react";

import { submitReview, type CommerceState } from "@/features/commerce/actions";

export function ReviewForm({ orderId, revieweeName }: { orderId: string; revieweeName: string }) {
  const [state, action, pending] = useActionState<CommerceState, FormData>(submitReview, {});

  if (state.ok) return <span className="chip chip--ok">Review filed — thanks</span>;

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="order_id" value={orderId} />
      <select
        name="rating"
        defaultValue="5"
        className="ctl w-auto !py-2"
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
        className="ctl max-w-none min-w-[180px] flex-1 !py-2"
      />
      <button type="submit" disabled={pending} className="btn !py-2.5">
        {pending ? "…" : "Leave review"}
      </button>
      {state.error && (
        <p className="field__err w-full" style={{ display: "flex" }}>
          {state.error}
        </p>
      )}
    </form>
  );
}
