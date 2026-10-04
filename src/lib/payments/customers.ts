import { stripeClient } from "./stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Stripe Customer linkage (P22). The customer is created lazily the first
 * time a user saves a card; `profiles.stripe_customer_id` (migration 0015)
 * holds the pointer. Card data lives only at Stripe.
 */

export type SavedCard = {
  id: string;
  /** "card" or "link" — Link wallets save from the Payment Element too. */
  kind: "card" | "link";
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  /** For Link methods: the wallet's email, the only useful identifier. */
  email: string | null;
};

/** The user's Stripe customer, or null when they have none. A failed read
 *  throws: null means "no customer", and treating an outage as that would
 *  create a second customer once the 24h idempotency window has passed. */
export async function getStripeCustomerId(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Stripe customer lookup failed: ${error.message}`);
  return data?.stripe_customer_id ?? null;
}

export async function getOrCreateStripeCustomer(userId: string, email?: string | null) {
  const existing = await getStripeCustomerId(userId);
  if (existing) return existing;

  const customer = await stripeClient().customers.create(
    { email: email ?? undefined, metadata: { user_id: userId } },
    // One customer per user even under a double-submit.
    { idempotencyKey: `customer:${userId}` }
  );

  const admin = createAdminClient();
  const { data: stored, error } = await admin
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", userId)
    .is("stripe_customer_id", null)
    .select("stripe_customer_id");
  // An unsaved pointer would orphan this customer and mint another on a later
  // visit, so the caller gets a retryable error instead of the id.
  if (error) throw new Error(`Stripe customer pointer write failed: ${error.message}`);
  if (stored?.length) return customer.id;

  // Nothing matched: a concurrent request stored its id first. Use that one.
  const winner = await getStripeCustomerId(userId);
  if (!winner) throw new Error("Stripe customer pointer was not saved");
  return winner;
}

export async function listSavedCards(userId: string): Promise<SavedCard[]> {
  const customerId = await getStripeCustomerId(userId);
  if (!customerId) return [];
  // No type filter: a buyer who paid with Stripe Link saved a `link` method,
  // not a `card` — both are reusable and both must show.
  const methods = await stripeClient().customers.listPaymentMethods(customerId, { limit: 20 });
  return methods.data
    .filter((m) => m.type === "card" || m.type === "link")
    .map((m) =>
      m.type === "link"
        ? {
            id: m.id,
            kind: "link" as const,
            brand: "link",
            last4: "",
            expMonth: 0,
            expYear: 0,
            email: m.link?.email ?? null,
          }
        : {
            id: m.id,
            kind: "card" as const,
            brand: m.card?.brand ?? "card",
            last4: m.card?.last4 ?? "????",
            expMonth: m.card?.exp_month ?? 0,
            expYear: m.card?.exp_year ?? 0,
            email: null,
          }
    );
}

/** Detaches a card — but only if it belongs to this user's customer. */
export async function detachSavedCard(userId: string, paymentMethodId: string) {
  const customerId = await getStripeCustomerId(userId);
  if (!customerId) return false;
  const method = await stripeClient().paymentMethods.retrieve(paymentMethodId);
  if (method.customer !== customerId) return false;
  await stripeClient().paymentMethods.detach(paymentMethodId);
  return true;
}
