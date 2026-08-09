"use client";

import { useActionState, useRef, useState } from "react";

import {
  acceptRefund,
  addDisputeEvidence,
  closeDispute,
  escalateDispute,
  offerRefund,
  openDispute,
  type CommerceState,
} from "@/features/commerce/actions";
import { DISPUTE_CATEGORIES } from "@/features/commerce/disputes";
import { formatPrice } from "@/lib/payments/fee";
import { createClient } from "@/lib/supabase/client";

function Result({ state }: { state: CommerceState }) {
  if (!state.error && !state.ok) return null;
  return (
    <p role="alert" aria-live="polite" className={state.error ? "field__err" : "chip chip--ok"}>
      {state.error ?? state.ok}
    </p>
  );
}

/** Buyer-only. Only rendered by the page once dispatch has happened and the
 *  order isn't already disputed/refunded/cancelled — see order/[id]/page.tsx. */
export function ReportProblemForm({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState<CommerceState, FormData>(openDispute, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="relbtn !static">
        Report a problem
      </button>
    );
  }

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="order_id" value={orderId} />
      <label className="field">
        <span className="field__label">What went wrong</span>
        <select name="category" required defaultValue="" className="ctl !max-w-none">
          <option value="" disabled>
            Choose one…
          </option>
          {DISPUTE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">Details (optional)</span>
        <textarea
          name="reason"
          rows={4}
          maxLength={1000}
          placeholder="Anything that helps the seller understand what happened…"
          className="ctl"
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn btn--live">
          {pending ? "Opening…" : "Open dispute"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn--ghost">
          Cancel
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

/** Seller-only. Offers a full or partial refund on a disputed order — money
 *  doesn't move until the buyer accepts. */
export function RefundOfferForm({
  orderId,
  totalCents,
}: {
  orderId: string;
  totalCents: number;
}) {
  const [state, action, pending] = useActionState<CommerceState, FormData>(offerRefund, {});

  if (state.ok) return <Result state={state} />;

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="order_id" value={orderId} />
      <p className="field__hint">
        Refunds are all-or-nothing: the buyer gets the full {formatPrice(totalCents)} back and the
        order closes as refunded.
      </p>
      <button type="submit" disabled={pending} className="btn btn--live">
        {pending ? "Sending…" : `Offer the full ${formatPrice(totalCents)} refund`}
      </button>
      <Result state={state} />
    </form>
  );
}

/** Buyer-only. Accepts the seller's outstanding refund offer. */
export function AcceptRefundButton({
  orderId,
  offerCents,
}: {
  orderId: string;
  offerCents: number;
}) {
  const [state, action, pending] = useActionState<CommerceState, FormData>(acceptRefund, {});

  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="order_id" value={orderId} />
      <button type="submit" disabled={pending} className="btn btn--live">
        {pending ? "Confirming…" : `Accept ${formatPrice(offerCents)} refund`}
      </button>
      <Result state={state} />
    </form>
  );
}

/** Buyer-only. "Ask DRVN to step in" — the explicit escalation, shown once
 *  the seller-response window has passed. The server re-checks every rule. */
export function EscalateDisputeButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState<CommerceState, FormData>(escalateDispute, {});

  if (state.ok) return <Result state={state} />;

  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="order_id" value={orderId} />
      <button type="submit" disabled={pending} className="btn">
        {pending ? "Escalating…" : "Ask DRVN to step in"}
      </button>
      <Result state={state} />
    </form>
  );
}

/** Either party. Uploads a photo into the dispute-evidence bucket, then
 *  records it against the dispute. Mirrors the sell form's upload flow. */
export function DisputeEvidenceForm({ orderId, userId }: { orderId: string; userId: string }) {
  const [state, action, pending] = useActionState<CommerceState, FormData>(
    addDisputeEvidence,
    {}
  );
  // dispute-evidence is private (0027) — the object has no fetchable public
  // URL, so `path` (submitted as `url`) is the bare storage path and
  // `previewUrl` is a local blob: URL for the pre-submit thumbnail only.
  const [path, setPath] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [clearedFor, setClearedFor] = useState<CommerceState | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function clearStaged() {
    setPath(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }

  // A successful attach clears the staged photo so the next one can follow —
  // derived during render (each action returns a fresh state object), not in
  // an effect.
  if (state.ok && state !== clearedFor) {
    setClearedFor(state);
    clearStaged();
  }

  async function handleFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploadError(null);
    if (file.size > 10 * 1024 * 1024) return setUploadError("Photos must be under 10MB.");
    if (!file.type.startsWith("image/")) return setUploadError("That isn't an image.");
    setUploading(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop() ?? "jpg";
      const objectPath = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("dispute-evidence")
        .upload(objectPath, file, { contentType: file.type });
      if (error) return setUploadError(error.message);
      setPath(objectPath);
      setPreviewUrl(URL.createObjectURL(file));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="url" value={path ?? ""} />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => handleFile(e.target.files)}
      />
      {path ? (
        <>
          <span className="thumb self-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {previewUrl && <img src={previewUrl} alt="Evidence photo, ready to attach" />}
            <button
              type="button"
              onClick={() => clearStaged()}
              className="thumb__x"
              aria-label="Remove photo"
            >
              ✕
            </button>
          </span>
          <input
            name="note"
            maxLength={500}
            placeholder="What does this photo show? — optional"
            className="ctl max-w-none"
            aria-label="Evidence note"
          />
          <button type="submit" disabled={pending} className="btn btn--live justify-self-start">
            {pending ? "Attaching…" : "Attach to the dispute"}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="btn btn--ghost justify-self-start"
        >
          {uploading ? "Uploading…" : "+ Add a photo"}
        </button>
      )}
      {uploadError && (
        <p role="alert" aria-live="polite" className="field__err">
          {uploadError}
        </p>
      )}
      <Result state={state} />
    </form>
  );
}

/** Buyer-only. Closes the dispute with no refund — "resolved, no action
 *  needed". */
export function CloseDisputeButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState<CommerceState, FormData>(closeDispute, {});

  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="order_id" value={orderId} />
      <button type="submit" disabled={pending} className="btn btn--ghost">
        {pending ? "Closing…" : "Resolved — no action needed"}
      </button>
      <Result state={state} />
    </form>
  );
}
