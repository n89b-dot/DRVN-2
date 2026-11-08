"use client";

import { unstable_rethrow, useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button, ButtonLink, Dialog, ResultNote, TextArea } from "@/components/ui";

import type { CommerceState } from "./action-types";
import { messageSeller } from "./message-actions";

/**
 * "Message seller" on a listing (R-directcontact, Neil's ruling: buyers may
 * message sellers). Asks one question in a dialog; the message lands in the
 * conversation with that seller, where they can answer. Signed-out visitors
 * are sent to sign in and back.
 */
export function MessageSellerButton({
  listingId,
  sellerName,
  isLoggedIn,
  loginHref,
}: {
  listingId: string;
  sellerName: string;
  isLoggedIn: boolean;
  loginHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [state, setState] = useState<CommerceState>({});
  const [pending, setPending] = useState(false);
  // One identity per message until the server confirms it, so a retry after
  // a lost response is the same message, not a second one.
  const messageId = useRef<string | null>(null);
  const [, startTransition] = useTransition();

  if (!isLoggedIn) {
    return (
      <ButtonLink href={loginHref} variant="ghost">
        Message seller
      </ButtonLink>
    );
  }

  function send() {
    if (pending || !body.trim()) return;
    setPending(true);
    setState({});
    messageId.current ??= crypto.randomUUID();
    const data = new FormData();
    data.set("listing_id", listingId);
    data.set("message_id", messageId.current);
    data.set("body", body);
    startTransition(async () => {
      try {
        const result = await messageSeller({}, data);
        setState(result);
        if (result.ok) {
          messageId.current = null;
          setBody("");
          if (result.href) router.push(result.href);
        }
      } catch (error) {
        unstable_rethrow(error);
        setState({ error: "Couldn't confirm your message was sent. It's still here — try again." });
      } finally {
        setPending(false);
      }
    });
  }

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Message seller
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} label={`Message ${sellerName}`} align="center">
        <div className="sheet text-left">
          <span className="microlabel microlabel--ink">Message {sellerName}</span>
          <form
            className="mt-3 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <TextArea
              id={`message-seller-${listingId}`}
              label="Your question about this part"
              hint="It goes to your conversation with the seller, where they can reply. Offers and buying stay on the listing."
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={4000}
              rows={4}
              readOnly={pending}
              required
            />
            <ResultNote error={state.error ?? null} ok={state.ok ?? null} />
            <Button type="submit" variant="live" loading={pending} pendingLabel="Sending…" disabled={!body.trim()}>
              Send
            </Button>
          </form>
        </div>
      </Dialog>
    </>
  );
}
