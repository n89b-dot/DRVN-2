"use client";

import { useRef, useState } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { ResultNote } from "@/components/ui";
import { sendThreadMessage } from "./message-actions";
import type { CommerceState } from "./action-types";

/** One identity survives retries until the server confirms the message. */
export function MessageComposer({ orderId, offerId }: { orderId?: string; offerId?: string }) {
  const router = useRouter();
  const identity = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<CommerceState>({});

  async function send() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setState({});
    identity.current ??= crypto.randomUUID();
    const data = new FormData();
    data.set("message_id", identity.current);
    data.set("body", body);
    if (orderId) data.set("order_id", orderId);
    if (offerId) data.set("offer_id", offerId);
    try {
      const result = await sendThreadMessage({}, data);
      setState(result);
      if (result.ok) {
        setBody("");
        identity.current = null;
        router.refresh();
      }
    } catch (error) {
      unstable_rethrow(error);
      setState({ error: "Couldn't confirm your message was sent. Your draft is still here; try again." });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="grid gap-2">
      <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="composer__row" aria-busy={pending}>
        <input name="body" aria-label="Message the other party" required maxLength={4000}
          value={body} onChange={(event) => setBody(event.target.value)} disabled={pending}
          placeholder="Message the other party…" className="ctl max-w-none flex-1 !py-2" />
        <button type="submit" disabled={pending} className="btn btn--ghost !py-2.5">
          {pending ? "Sending…" : "Send"}
        </button>
      </form>
      <ResultNote error={state.error} ok={state.ok} />
    </div>
  );
}
