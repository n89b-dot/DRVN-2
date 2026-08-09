"use client";

import { useActionState, useId, useState } from "react";

import { submitReview, type CommerceState } from "@/features/commerce/actions";

const MAX_LEN = 1000;
const MIN_LEN = 5;
const STAR_LABELS = ["1 star", "2 stars", "3 stars", "4 stars", "5 stars"];

export function ReviewForm({
  orderId,
  revieweeName,
}: {
  orderId: string;
  revieweeName: string;
}) {
  const [state, action, pending] = useActionState<CommerceState, FormData>(submitReview, {});
  const [rating, setRating] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const legendId = useId();

  if (state.ok) {
    return <span className="chip chip--ok">Review posted — thanks</span>;
  }

  const trimmed = body.trim();
  const bodyTooShort = trimmed.length > 0 && trimmed.length < MIN_LEN;
  const canSubmit = rating !== null && !bodyTooShort;
  const alreadyReviewed = state.error === "You've already reviewed this order.";

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="rating" value={rating ?? ""} />

      <fieldset className="grid gap-2 border-0 p-0">
        <legend id={legendId} className="field__label">
          Rate {revieweeName} for order {orderId.slice(0, 8).toUpperCase()}
        </legend>
        <div role="radiogroup" aria-labelledby={legendId} className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={STAR_LABELS[n - 1]}
              onClick={() => setRating(n)}
              className="star-pick"
              data-on={rating !== null && n <= rating ? "true" : undefined}
            >
              ★
            </button>
          ))}
        </div>
        {rating === null && <span className="field__hint">Pick a rating to leave a review.</span>}
      </fieldset>

      <label className="field">
        <span className="field__label">Review {revieweeName} (optional)</span>
        <textarea
          name="body"
          value={body}
          onChange={(event) => setBody(event.target.value.slice(0, MAX_LEN))}
          maxLength={MAX_LEN}
          rows={3}
          className="ctl max-w-none"
          placeholder="What was it like dealing with them?"
        />
        <span className="field__hint">
          {body.length}/{MAX_LEN}
          {bodyTooShort ? ` — add at least ${MIN_LEN} characters, or leave it blank` : ""}
        </span>
      </label>

      <button type="submit" disabled={pending || !canSubmit} className="btn w-fit !py-2.5">
        {pending ? "Posting…" : "Leave review"}
      </button>

      {state.error && (
        <p role="alert" aria-live="polite" className="field__err">
          {alreadyReviewed ? "You've already reviewed this order." : state.error}
        </p>
      )}
    </form>
  );
}
