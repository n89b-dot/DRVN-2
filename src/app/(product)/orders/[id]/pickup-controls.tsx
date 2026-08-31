"use client";

import Image from "next/image";
import { useActionState } from "react";

import { motion } from "motion/react";

import { Button, TextField } from "@/components/ui";
import { springs, transitions } from "@/lib/motion";
import {
  markReadyForPickup,
  redeemPickup,
  showPickupPass,
  type PickupPassState,
  type PickupState,
} from "@/features/commerce/pickup-actions";

/** Local pickup handshake UI (0054): seller readies, buyer shows the pass,
 *  seller burns it at handoff. */

function Feedback({ state }: { state: PickupState }) {
  if (state.error) {
    return (
      <p role="alert" aria-live="polite" className="field__err">
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p role="status" aria-live="polite" className="chip chip--ok">
        {state.ok}
      </p>
    );
  }
  return null;
}

export function ReadyForPickupButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState<PickupState, FormData>(
    markReadyForPickup,
    {}
  );
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="order_id" value={orderId} />
      <p className="spec-note">
        Boxed and waiting? Marking it ready gives the buyer their Pickup Pass —
        you confirm the handoff by scanning it (or typing its code) when they
        arrive.
      </p>
      <Button type="submit" variant="live" loading={pending} pendingLabel="Marking…">
        Mark ready for pickup
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function RedeemPickupForm({
  orderId,
  initialToken,
}: {
  orderId: string;
  /** Present when the seller arrived via the scanned QR. */
  initialToken?: string;
}) {
  const [state, action, pending] = useActionState<PickupState, FormData>(redeemPickup, {});
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="order_id" value={orderId} />
      {initialToken ? (
        <>
          <input type="hidden" name="token" value={initialToken} />
          <p className="spec-note">
            Pass scanned — confirm the part changed hands to complete the order.
          </p>
        </>
      ) : (
        <TextField
          id="pickup-code"
          label="Buyer's six-digit code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          maxLength={6}
          className="!max-w-none"
          fieldClassName="!mb-0"
          hint="On the buyer's Pickup Pass, under the QR."
        />
      )}
      <Button type="submit" variant="live" loading={pending} pendingLabel="Confirming…">
        Confirm handoff
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function PickupPassPanel({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState<PickupPassState, FormData>(
    showPickupPass,
    {}
  );
  return (
    <div className="grid gap-3">
      {state.qrDataUrl ? (
        // The pass settling in marks the moment it goes live — the reveal is
        // the state change (a fresh, ticking, single-use credential).
        <motion.div
          className="grid justify-items-center gap-2 text-center"
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{
            opacity: 1,
            y: 0,
            scale: 1,
            transition: { ...springs.spatial, opacity: transitions.standard },
          }}
        >
          {/* Data-URL QR, minted server-side; next/image can't optimize it. */}
          <Image
            src={state.qrDataUrl}
            alt="Pickup Pass QR — the seller scans this at handoff"
            width={220}
            height={220}
            unoptimized
            className="rounded-ctl bg-white p-2"
          />
          {state.code && (
            <p className="font-mono text-xl tracking-[0.3em]">{state.code}</p>
          )}
          <p className="spec-note !mt-0">
            Show this at handoff — the seller scans the QR or types the code.
            {state.expiresAt
              ? ` Fresh for an hour (until ${new Date(state.expiresAt).toLocaleTimeString()}); reopen for a new one.`
              : ""}
          </p>
        </motion.div>
      ) : (
        <p className="spec-note">
          Your Pickup Pass proves the handoff. Open it when you&apos;re with the
          seller — each pass is single-use and lasts an hour.
        </p>
      )}
      <form action={action}>
        <input type="hidden" name="order_id" value={orderId} />
        <Button type="submit" loading={pending} pendingLabel="Opening…">
          {state.qrDataUrl ? "Refresh the pass" : "Show pickup pass"}
        </Button>
      </form>
      {state.error && (
        <p role="alert" aria-live="polite" className="field__err">
          {state.error}
        </p>
      )}
    </div>
  );
}
