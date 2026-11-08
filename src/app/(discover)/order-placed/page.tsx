import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Alert, Foot, ObjectRow } from "@/components/ui";
import { readGuestOrders } from "@/lib/guest-checkout";
import { formatPrice } from "@/lib/payments/fee";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Order placed - DRVN" };

/**
 * Where a guest lands after paying.
 *
 * A guest has no session, so /orders would bounce them to /login the instant
 * their money went through — the worst possible moment to demand an account.
 * This is the receipt for the checkout this browser just completed.
 *
 * Access is the HMAC-signed guest cookie, and it grants exactly the orders
 * named in it: the read is by `id IN (…)` from that cookie, so a forged or
 * replayed value resolves to nothing. Orders RLS is untouched — this route
 * reads through the admin client precisely because it must NOT widen what a
 * client role can see.
 *
 * The durable way back is the emailed link, which proves the address and
 * signs them in properly.
 */
export default async function OrderPlacedPage({
  searchParams,
}: {
  searchParams: Promise<{ placed?: string; processing?: string; skipped?: string }>;
}) {
  const { processing, skipped } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // A signed-in buyer has a real orders surface; this page is not for them.
  if (user) redirect("/orders");

  const orderIds = await readGuestOrders();
  if (!orderIds.length) redirect("/marketplace");

  const admin = createAdminClient({ signPhotos: true }); // N455: shows listing photos
  const { data: orders } = await admin
    .from("orders")
    .select("id, status, total_cents, currency, ship_name, is_collection")
    .in("id", orderIds)
    .order("created_at", { ascending: false });

  if (!orders?.length) redirect("/marketplace");

  const { data: items } = await admin
    .from("order_items")
    .select("id, order_id, title, price_cents, listing_id")
    .in("order_id", orders.map((o) => o.id));

  const listingIds = (items ?? [])
    .map((i) => i.listing_id)
    .filter((id): id is string => Boolean(id));
  const { data: images } = listingIds.length
    ? await admin
        .from("listing_images")
        .select("listing_id, url, position")
        .in("listing_id", listingIds)
        .order("position")
    : { data: [] };
  const cover = new Map<string, string>();
  for (const img of images ?? []) {
    if (!cover.has(img.listing_id)) cover.set(img.listing_id, img.url);
  }

  const total = orders.reduce((sum, o) => sum + o.total_cents, 0);
  const stillSettling = processing === "1" || orders.some((o) => o.status === "pending");

  return (
    <div className="wrap wrap--narrow pb-10">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          {orders.length === 1 ? "Your order" : `${orders.length} orders`}
        </span>
        <h1>
          {stillSettling ? (
            <>
              Payment <span className="live-word">confirming.</span>
            </>
          ) : (
            <>
              That&apos;s <span className="live-word">yours.</span>
            </>
          )}
        </h1>
        <p className="sub">
          {stillSettling
            ? "Your payment is still settling. We'll email you the moment it's confirmed — nothing else is needed from you."
            : "Paid and confirmed. The seller has been told to get it packed."}
        </p>
      </Rv>

      {/* The one thing a guest needs to know: how they get back in. */}
      <div className="nextaction">
        <span className="microlabel">Next</span>
        <p className="nextaction__what">Check your email</p>
        <p className="spec-note">
          An email link is on its way. It opens this order — dispatch updates, tracking and
          messages to the seller all live there. Opening it also finishes setting up your
          DRVN account, so you never need a password.
        </p>
      </div>

      {skipped && (
        <Alert tone="live" className="mb-6" title={<>Some parts couldn&apos;t be included</>}>
          {skipped} — those weren&apos;t charged for.
        </Alert>
      )}

      <Rv className="tile">
        <div className="tile__head">
          <span className="microlabel microlabel--ink">What you bought</span>
          <span className="microlabel">
            Ref {orders.map((o) => o.id.slice(0, 8).toUpperCase()).join(" · ")}
          </span>
        </div>
        <div className="rowlist">
          {(items ?? []).map((item) => (
            <ObjectRow
              key={item.id}
              media={{
                src: item.listing_id ? cover.get(item.listing_id) : undefined,
                alt: item.title ?? "Part",
              }}
            >
              <span className="min-w-0">
                <span className="order__name block truncate">{item.title ?? "Part"}</span>
                <span className="order__meta block">{formatPrice(item.price_cents)}</span>
              </span>
            </ObjectRow>
          ))}
        </div>
        <div className="mt-3">
          <div className="sheet__row sheet__total">
            <span>You paid</span>
            <b>{formatPrice(total)}</b>
          </div>
        </div>
        {orders[0].ship_name && !orders[0].is_collection && (
          <p className="spec-note">Going to {orders[0].ship_name}.</p>
        )}
      </Rv>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/marketplace" className="btn btn--ghost">
          Keep browsing
        </Link>
      </div>

      <Foot
        left="DRVN — parts for modified cars"
        right={<Link href="/protection">How buyer protection works →</Link>}
      />
    </div>
  );
}
