"use client";

import { useRef, useState } from "react";

import {
  acceptRefund,
  addDisputeEvidence,
  closeDispute,
  escalateDispute,
  offerRefund,
  type CommerceState,
} from "@/features/commerce/actions";
import { DISPUTE_CATEGORIES } from "@/features/commerce/disputes";
import { TextField } from "@/components/ui";
import { formatPrice } from "@/lib/payments/fee";
import { uploadFailureMessage, uploadImages } from "@/lib/media-upload";
import { useRecoverableAction } from "@/features/commerce/use-recoverable-action";

function Result({ state }: { state: CommerceState }) {
  if (!state.error && !state.ok) return null;
  return (
    <p role="alert" aria-live="polite" className={state.error ? "field__err" : "chip chip--ok"}>
      {state.error ?? state.ok}
    </p>
  );
}

/** Buyer-only. Rendered once dispatch has happened, or — for "item never
 *  arrived" only — once the latest delivery date frozen at purchase has
 *  passed on an undispatched order; see order/[id]/page.tsx. The database
 *  (open_order_dispute) re-checks the stage and window either way. */
export function ReportProblemForm({
  orderId,
  categories = DISPUTE_CATEGORIES,
}: {
  orderId: string;
  categories?: typeof DISPUTE_CATEGORIES;
}) {
  const [state, setState] = useState<CommerceState>({});
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="relbtn !static">
        Report a problem
      </button>
    );
  }

  return (
    <form className="grid gap-3" onSubmit={async event => {
      event.preventDefault();
      if (submitting.current) return;
      submitting.current = true; setPending(true); setState({});
      const form = new FormData(event.currentTarget);
      try {
        const response = await fetch(`/api/orders/${orderId}/dispute`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: form.get("category"), reason: form.get("reason") }),
          signal: AbortSignal.timeout(30000),
        });
        const result: CommerceState = await response.json();
        if (!response.ok || result.error) { setState({ error: result.error || "The dispute could not be opened." }); return; }
        // A full navigation is independent of a stalled Server Action transition.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate full document load (4aef789): router.push would re-enter the stalled transition this escapes
        window.location.assign(`/orders/${orderId}`);
      } catch { setState({ error: "The result could not be confirmed. Reload the order before trying again." }); }
      finally { submitting.current = false; setPending(false); }
    }}>
      <input type="hidden" name="order_id" value={orderId} />
      <label className="field">
        <span className="field__label">What went wrong</span>
        <select
          name="category"
          required
          defaultValue={categories.length === 1 ? categories[0].value : ""}
          className="ctl !max-w-none"
        >
          <option value="" disabled>
            Choose one…
          </option>
          {categories.map((c) => (
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
  const [state, action, pending] = useRecoverableAction<CommerceState>(offerRefund);

  if (state.ok) return <Result state={state} />;

  return (
    <form onSubmit={(event) => { event.preventDefault(); void action(new FormData(event.currentTarget)); }} className="grid gap-3">
      <input type="hidden" name="order_id" value={orderId} />
      <TextField
        id={`refund-amount-${orderId}`}
        label="Refund amount"
        name="amount"
        inputMode="decimal"
        placeholder={(totalCents / 100).toFixed(2)}
        prefix="$"
        className="!max-w-none"
        fieldClassName="!mb-0"
        hint={`Leave empty for the full ${formatPrice(totalCents)}. A partial refund settles the dispute and the buyer keeps the item — useful when return postage makes no sense.`}
      />
      <button type="submit" disabled={pending} className="btn btn--live">
        {pending ? "Sending…" : "Offer this refund"}
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
  const [state, action, pending] = useRecoverableAction<CommerceState>(acceptRefund);

  return (
    <form onSubmit={(event) => { event.preventDefault(); void action(new FormData(event.currentTarget)); }} className="grid gap-2">
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
  const [state, action, pending] = useRecoverableAction<CommerceState>(escalateDispute);

  if (state.ok) return <Result state={state} />;

  return (
    <form onSubmit={(event) => { event.preventDefault(); void action(new FormData(event.currentTarget)); }} className="grid gap-2">
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
  const [state, action, pending] = useRecoverableAction<CommerceState>(addDisputeEvidence);
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
    setUploading(true);
    try {
      // Evidence keeps its original bytes (no re-encode) and Storage only
      // takes it at `<uploader>/<order>/<file>` while this order is disputed
      // (20261107203000). uploadImages ledgers it, so a photo never attached
      // is reclaimed after 48h.
      const { uploaded, failed } = await uploadImages({
        files: [file],
        bucket: "dispute-evidence",
        pathPrefix: `${userId}/${orderId}`,
      });
      if (failed.length) return setUploadError(uploadFailureMessage(failed));
      setPath(uploaded[0].path);
      setPreviewUrl(URL.createObjectURL(file));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void action(new FormData(event.currentTarget)); }} className="grid gap-2">
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
  const [state, action, pending] = useRecoverableAction<CommerceState>(closeDispute);

  return (
    <form onSubmit={(event) => { event.preventDefault(); void action(new FormData(event.currentTarget)); }} className="grid gap-2">
      <input type="hidden" name="order_id" value={orderId} />
      <button type="submit" disabled={pending} className="btn btn--ghost">
        {pending ? "Closing…" : "Resolved — no action needed"}
      </button>
      <Result state={state} />
    </form>
  );
}
