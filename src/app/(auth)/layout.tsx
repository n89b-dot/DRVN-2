import Link from "next/link";
import { unstable_cache } from "next/cache";
import { Suspense, type ReactNode } from "react";

import { ListingCard } from "@/components/ui";
import { hydrateListingCards } from "@/lib/marketplace/query";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The backdrop's data is public and identical for every visitor, and layouts
 * re-render on every server-action submit — uncached, each failed login or
 * signup validation error would re-run the listings query plus the four
 * hydrate queries for pure decoration. One cached payload, refreshed every
 * 60s, using the admin client because cookie-bound clients can't run inside
 * a cached scope (and anon visibility is what we're rendering anyway —
 * active listings are public).
 */
const getBackdropCards = unstable_cache(
  async () => {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("listings")
      .select("id, title, price_cents, shipping_cents, condition, location, part_number, seller_id")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(6);
    if (!data?.length) return [];
    return hydrateListingCards(supabase, data);
  },
  ["auth-backdrop-cards"],
  { revalidate: 60 }
);

/**
 * Recent real listings, rendered inert behind the auth card under the sheet
 * scrim — the marketplace is the pitch, the way read.cv floats its gates
 * over the live feed. Fails to a plain paper ground on any error; streams in
 * after the card so it never delays the form.
 */
async function LiveBackdrop() {
  let cards: Awaited<ReturnType<typeof getBackdropCards>> = [];
  try {
    cards = await getBackdropCards();
  } catch {
    return null;
  }
  if (!cards.length) return null;

  return (
    <div aria-hidden="true" inert className="authstage">
      <div className="wrap pt-8">
        <div className="mkt">
          {cards.map((card) => (
            <ListingCard key={card.id} listing={card} prefetch={false} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen px-5">
      <Suspense fallback={null}>
        <LiveBackdrop />
      </Suspense>
      <div className="authwrap">
        <Link href="/" className="bar__logo" aria-label="DRVN home">
          DRVN<em>.</em> <span className="microlabel">Parts marketplace</span>
        </Link>
        <div className="authcard mt-8">{children}</div>
      </div>
    </div>
  );
}
