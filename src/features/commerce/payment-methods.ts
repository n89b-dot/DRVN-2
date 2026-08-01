"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import {
  detachSavedCard,
  getOrCreateStripeCustomer,
  getStripeCustomerId,
} from "@/lib/payments/customers";
import { stripeClient, stripeSecretKey } from "@/lib/payments/stripe";
import { createClient } from "@/lib/supabase/server";

import type { CommerceState } from "./actions";

/** Payment-method management (P22) + saved-card checkout (P21). All Stripe
 *  calls are server-side; the browser only ever sees client secrets. */

export type SetupState = CommerceState & { clientSecret?: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
}

/** Starts saving a card from Settings: a SetupIntent on the user's customer. */
export async function createCardSetupIntent(): Promise<SetupState> {
  const user = await requireUser();
  if (!stripeSecretKey()) return { error: "Payments aren't configured." };

  try {
    const customerId = await getOrCreateStripeCustomer(user.id, user.email);
    const intent = await stripeClient().setupIntents.create({
      customer: customerId,
      usage: "off_session",
      metadata: { user_id: user.id },
    });
    if (!intent.client_secret) return { error: "Couldn't start card setup." };
    return { clientSecret: intent.client_secret };
  } catch (error) {
    console.error("[payments] setup intent failed", error);
    return { error: "Couldn't start card setup." };
  }
}

export async function removeSavedCard(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const user = await requireUser();
  const pmId = String(formData.get("payment_method_id") ?? "");
  if (!pmId) return { error: "Missing card." };

  try {
    const removed = await detachSavedCard(user.id, pmId);
    if (!removed) return { error: "That card isn't on your account." };
  } catch (error) {
    console.error("[payments] detach failed", error);
    return { error: "Couldn't remove the card. Try again." };
  }
  revalidatePath("/settings");
  revalidatePath("/checkout");
  return { ok: "Card removed." };
}

/**
 * Marks a checkout's PaymentIntent to save the card being used (P21's
 * "save this card for next time"). Ownership proven via intent metadata.
 */
export async function saveCardOnIntent(formData: FormData): Promise<void> {
  const user = await requireUser();
  const reference = String(formData.get("reference") ?? "");
  if (!reference) return;

  try {
    const intent = await stripeClient().paymentIntents.retrieve(reference);
    if (intent.metadata.buyer_id !== user.id) return;
    const customerId = await getOrCreateStripeCustomer(user.id, user.email);
    await stripeClient().paymentIntents.update(reference, {
      customer: customerId,
      setup_future_usage: "off_session",
    });
  } catch (error) {
    console.error("[payments] saveCardOnIntent failed", error);
  }
}

export type SavedCardPayState = CommerceState & {
  /** Set when the card needs 3DS — the browser runs handleNextAction. */
  actionClientSecret?: string;
  /** Where to land once the payment settles. */
  completeUrl?: string;
};

/**
 * Pays a checkout's PaymentIntent with a saved card, entirely server-side.
 * On success the webhook settles the orders exactly as with a new card.
 */
export async function payWithSavedCard(
  _prev: SavedCardPayState,
  formData: FormData
): Promise<SavedCardPayState> {
  const user = await requireUser();
  const reference = String(formData.get("reference") ?? "");
  const pmId = String(formData.get("payment_method_id") ?? "");
  const orders = String(formData.get("orders") ?? "");
  if (!reference || !pmId || !orders) return { error: "Missing payment details." };

  const customerId = await getStripeCustomerId(user.id);
  if (!customerId) return { error: "No saved cards on your account." };

  const completeUrl = `/cart/complete?payment_intent=${reference}&orders=${encodeURIComponent(orders)}`;

  try {
    const intent = await stripeClient().paymentIntents.retrieve(reference);
    if (intent.metadata.buyer_id !== user.id) return { error: "That isn't your checkout." };

    const method = await stripeClient().paymentMethods.retrieve(pmId);
    if (method.customer !== customerId) return { error: "That card isn't on your account." };

    // A saved card can only pay an intent that belongs to its customer —
    // attach the customer first (confirm() itself cannot set it).
    if (!intent.customer) {
      await stripeClient().paymentIntents.update(reference, { customer: customerId });
    }
    const confirmed = await stripeClient().paymentIntents.confirm(reference, {
      payment_method: pmId,
    });

    if (confirmed.status === "succeeded" || confirmed.status === "processing") {
      return { completeUrl };
    }
    if (confirmed.status === "requires_action" && confirmed.client_secret) {
      return { actionClientSecret: confirmed.client_secret, completeUrl };
    }
    return { error: "The card was declined. Try another." };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Payment failed";
    console.error("[payments] saved-card confirm failed", { reference, reason });
    return { error: reason };
  }
}
