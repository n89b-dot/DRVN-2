"use client";

import { useRouter, unstable_rethrow } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";

import {
  addToCart,
  buyNow,
  makeOffer,
  type CommerceState,
} from "@/features/commerce/actions";
import {
  AuthIntentDialog,
  Button,
  Dialog,
  PaymentModeNotice,
  TextField,
  Toast,
} from "@/components/ui";
import type { AuthIntent } from "@/lib/auth-intent";
import { formatPrice } from "@/lib/marketplace/taxonomy";

export function PurchaseActions({
  listingId,
  isLoggedIn,
  betaEnforced,
  buyerEligible,
  isOwn,
  isActive,
  paymentsLive,
  priceCents,
  shippingCents,
  resumeAction = null,
  returnPath,
}: {
  listingId: string;
  isLoggedIn: boolean;
  betaEnforced: boolean;
  buyerEligible: boolean;
  isOwn: boolean;
  isActive: boolean;
  paymentsLive: boolean;
  priceCents: number;
  shippingCents: number;
  /** `?action=` on the URL — the intent this visitor authenticated to resume. */
  resumeAction?: AuthIntent | null;
  returnPath?: string;
}) {
  const router = useRouter();
  const detailPath = returnPath ?? `/listings/${listingId}`;
  const idBase = useId();
  // Coming back from sign-in with `?action=offer` opens the dialog on first
  // render (initial state from props — no setState-in-effect); guarded on
  // isLoggedIn so a stale link can't put a signed-out visitor into a form
  // they can't submit.
  const [offerOpen, setOfferOpen] = useState(() => resumeAction === "offer" && isLoggedIn);
  // Which gated action a signed-out visitor reached for, if any.
  const [authIntent, setAuthIntent] = useState<AuthIntent | null>(null);
  const [offerState, setOfferState] = useState<CommerceState>({});
  const [offerPending, startOfferTransition] = useTransition();
  const [offerAmount, setOfferAmount] = useState("");
  const [offerMessage, setOfferMessage] = useState("");
  const offerIdentity = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Cart gets its own pending so "Buy now" doesn't flash "Processing…" while
  // a different button is the one working — and vice versa.
  const [cartPending, startCartTransition] = useTransition();
  const [cartState, setCartState] = useState<CommerceState | null>(null);

  // The sticky phone bar shows only while the real controls are off-screen,
  // so the same action never appears twice at once. Starts hidden: on load
  // the purchase tile sits right under the gallery and is usually visible.
  const actionsRef = useRef<HTMLDivElement>(null);
  const [actionsInView, setActionsInView] = useState(true);

  useEffect(() => {
    const node = actionsRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setActionsInView(entry.isIntersecting),
      { rootMargin: "0px 0px -56px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Strip `?action=` once so a refresh (or a shared link) doesn't reopen the
  // dialog forever. Ref-guarded — a pure side effect, no state involved.
  const strippedRef = useRef(false);
  useEffect(() => {
    if (strippedRef.current || resumeAction !== "offer" || !isLoggedIn) return;
    strippedRef.current = true;
    window.history.replaceState(null, "", detailPath);
  }, [resumeAction, isLoggedIn, detailPath, router]);

  if (isOwn || !isActive) return null;

  /**
   * Actions that genuinely need an account explain themselves rather than
   * bouncing to /login. The dialog carries
   * `?next=/listings/<id>?action=<intent>` through sign-in, signup, OAuth and
   * onboarding, so the visitor lands back here mid-action.
   *
   * Buying is NOT one of them: a guest can buy a part and identifies
   * themselves with an email at checkout. Making an offer is, because a
   * negotiation has to stay attached to someone across counters, notifications
   * and a 72-hour expiry.
   */
  function guard(intent: AuthIntent, run: () => void) {
    if (!isLoggedIn) {
      setAuthIntent(intent);
      return;
    }
    run();
  }

  function runBuyNow() {
    if (betaEnforced && !isLoggedIn) {
      router.push(`/login?next=${encodeURIComponent(detailPath)}`);
      return;
    }
    if (!buyerEligible) {
      setCartState({ error: "Buying is limited to invited beta members." });
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("listing_id", listingId);
      try {
        const result = await buyNow(fd);
        if (result?.error) setCartState(result);
      } catch (error) {
        unstable_rethrow(error);
        setCartState({ error: "Couldn't open checkout. Try again." });
      }
    });
  }

  function submitOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (offerPending) return;
    offerIdentity.current ??= crypto.randomUUID();
    const data = new FormData();
    data.set("offer_id", offerIdentity.current);
    data.set("listing_id", listingId);
    data.set("amount", offerAmount);
    data.set("message", offerMessage);
    setOfferState({});
    startOfferTransition(async () => {
      try {
        const result = await makeOffer({}, data);
        setOfferState(result);
        if (result.ok) {
          offerIdentity.current = null;
          setOfferAmount("");
          setOfferMessage("");
        }
      } catch (error) {
        unstable_rethrow(error);
        setOfferState({
          error: "Couldn't confirm your offer was sent. Your draft is still here; try again.",
        });
      }
    });
  }

  const buybarHidden = actionsInView || offerOpen;

  return (
    <div ref={actionsRef} className="mt-5 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="live" disabled={pending} onClick={runBuyNow} className="flex-1">
          {pending ? "Processing…" : betaEnforced && !isLoggedIn ? "Sign in to buy" : "Buy now"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => guard("offer", () => setOfferOpen(true))}
          className="flex-1"
        >
          Make an offer
        </Button>
      </div>
      {cartState?.ok ? (
        <a href="/cart" className="btn btn--ghost">
          In cart ✓ — view cart
        </a>
      ) : (
        <Button
          variant="ghost"
          disabled={pending || cartPending}
          onClick={() =>
            startCartTransition(async () => {
              const fd = new FormData();
              fd.set("listing_id", listingId);
              try {
                const result = await addToCart(fd);
                setCartState(result);
              } catch {
                setCartState({ error: "Couldn't add that just now — try again." });
              }
              // Refresh the shell so the cart badge count updates in place.
              // Cookie changes return the refreshed server UI with this action.
            })
          }
        >
          {cartPending ? "Adding…" : "Add to cart"}
        </Button>
      )}
      {cartState?.error && (
        <p role="alert" aria-live="polite" className="field__err">
          {cartState.error}
        </p>
      )}
      {cartState?.ok && <Toast message="Added to cart ✓" />}
      <PaymentModeNotice live={paymentsLive} />

      {/* Signed out: say why an account is needed before asking for one. */}
      <AuthIntentDialog
        open={authIntent !== null}
        onClose={() => setAuthIntent(null)}
        intent={authIntent ?? "offer"}
        returnPath={detailPath}
      />

      {/* Shared Dialog primitive: dialog role, Escape, focus trap, scroll
          lock. The amount input is a real <label> now — screen readers used
          to announce it as "edit text, blank". */}
      <Dialog open={offerOpen} onClose={() => setOfferOpen(false)} label="Make an offer">
        <div className="sheet">
          <span className="microlabel microlabel--ink">Make an offer</span>
          <form onSubmit={submitOffer} className="mt-4 flex flex-col gap-3">
            {/* TextField wires the field-state classes so a rejected amount
                paints the control itself (tinted border), not just the error
                line — and `.field.is-ok .field__ok` shows the success line
                without the old inline display override. */}
            <TextField
              id={`${idBase}-amount`}
              label="Your offer"
              prefix="$"
              name="amount"
              required
              inputMode="decimal"
              placeholder="0"
              value={offerAmount}
              onChange={(event) => setOfferAmount(event.target.value)}
              hint="The seller can accept, counter once, or let it lapse. Offers expire after 72 hours."
              error={offerState.error}
              ok={offerState.ok}
            />
            <div className="field">
              <label htmlFor={`${idBase}-message`} className="microlabel">
                Message — optional
              </label>
              <textarea
                id={`${idBase}-message`}
                name="message"
                rows={2}
                placeholder="Anything the seller should know"
                className="ctl"
                value={offerMessage}
                onChange={(event) => setOfferMessage(event.target.value)}
              />
            </div>
            <div className="sheet__actions">
              <Button type="submit" variant="live" disabled={offerPending} className="flex-1">
                {offerPending ? "Sending…" : "Send offer"}
              </Button>
              <Button variant="ghost" onClick={() => setOfferOpen(false)}>
                Close
              </Button>
            </div>
          </form>
        </div>
      </Dialog>

      {/* Phone-only sticky purchase bar (hidden ≥981px in CSS). `inert` keeps
          the duplicate controls out of the tab order and away from assistive
          tech while the real ones are on screen. */}
      <div
        className="buybar"
        data-hidden={buybarHidden ? "true" : undefined}
        inert={buybarHidden}
        aria-label="Purchase"
      >
        <span className="buybar__price">
          {formatPrice(priceCents)}
          <span className="buybar__ship">
            {shippingCents > 0 ? `+ ${formatPrice(shippingCents)} ship` : "Ship incl."}
          </span>
        </span>
        <Button variant="live" disabled={pending} onClick={runBuyNow} className="min-w-0 flex-1">
          {pending ? "Processing…" : betaEnforced && !isLoggedIn ? "Sign in to buy" : "Buy now"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => guard("offer", () => setOfferOpen(true))}
          className="min-w-0 flex-1"
        >
          Offer
        </Button>
      </div>
    </div>
  );
}
