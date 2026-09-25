import Link from "next/link";
import { unstable_cache } from "next/cache";
import { Suspense, type ReactNode } from "react";

import { ListingCard, Mosaic, MosaicCell } from "@/components/ui";
import { hydrateListingCards } from "@/lib/marketplace/query";
import { createAdminClient } from "@/lib/supabase/admin";
import { vehicleSubline } from "@/lib/vehicles/label";

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
    // Five parts and three builds — eight cards close a 4×2 desktop wall
    // (six left a ragged second row), and DRVN is builds and parts, not a
    // parts shop, so the pitch behind the gate shows both.
    const [{ data }, { data: builds }] = await Promise.all([
      supabase
        .from("listings")
        .select("id, title, price_cents, shipping_cents, condition, location, part_number, seller_id, source_car_id")
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("cars")
        .select("id, slug, name, make, model, year, cover_image_url")
        .eq("is_public", true)
        .not("cover_image_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(3),
    ]);
    const listings = data?.length ? await hydrateListingCards(supabase, data) : [];
    type Card =
      | { kind: "listing"; listing: (typeof listings)[number] }
      | { kind: "build"; build: NonNullable<typeof builds>[number] };
    const cards: Card[] = [];
    const parts = [...listings];
    const cars = [...(builds ?? [])];
    // A build in every second or third slot, so neither kind clumps.
    for (let i = 0; parts.length || cars.length; i++) {
      const wantBuild = i % 3 === 1;
      if ((wantBuild && cars.length) || !parts.length) {
        cards.push({ kind: "build", build: cars.shift()! });
      } else {
        cards.push({ kind: "listing", listing: parts.shift()! });
      }
    }
    return cards;
  },
  ["auth-backdrop-cards-v2"],
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
        <Mosaic>
          {cards.map((card) =>
            card.kind === "listing" ? (
              <ListingCard key={card.listing.id} listing={card.listing} prefetch={false} />
            ) : (
              <MosaicCell
                key={card.build.id}
                href={`/cars/${card.build.slug}`}
                size="sq"
                src={card.build.cover_image_url}
                alt=""
                eyebrow="Build"
                kind="car"
                headline={card.build.name}
                value={vehicleSubline(card.build.name, card.build) ?? undefined}
                prefetch={false}
              />
            )
          )}
        </Mosaic>
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
        {/* The gate reads as a dialog over the site, so it carries a dialog's
            way out. Both sit on paper plates: straight over the scrimmed
            backdrop the lockup was grey on a wheel photo, and it was the
            only navigation on the page. */}
        <div className="authtop">
          <Link href="/" className="authtop__plate bar__logo" aria-label="DRVN home">
            DRVN<em>.</em>
          </Link>
          <Link href="/" className="authtop__plate authtop__close">
            <span aria-hidden="true">×</span> Close
          </Link>
        </div>
        <div className="authcard">{children}</div>
      </div>
    </div>
  );
}
