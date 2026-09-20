import Link from "next/link";

import { ObjectRow } from "@/components/ui";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

import type { GarageSheet } from "./garage-data";

/** G-4's Overview: what's happened, and the two links that follow from it. */
export function GarageCarOverview({ sheet }: { sheet: GarageSheet }) {
  return (
    <div className="mt-8 grid gap-6">
      {sheet.latestUpdate ? (
        <ObjectRow
          href={sheet.is_public ? `/cars/${sheet.slug}/activity/${sheet.latestUpdate.id}` : undefined}
          media={{ src: sheet.latestUpdate.cover_url ?? undefined, alt: "" }}
          title={sheet.latestUpdate.title}
          meta={`Latest update · ${new Date(sheet.latestUpdate.published_at).toLocaleDateString()}`}
        />
      ) : (
        <p className="text-body text-dim">
          Nothing posted about this car yet.{" "}
          <Link href={`/garage/${sheet.id}/update/new`} className="jumplink">
            Write the first update →
          </Link>
        </p>
      )}
      {sheet.earnedCents > 0 && (
        <p className="text-body text-dim">
          {formatPrice(sheet.earnedCents)} earned from parts off this car.
        </p>
      )}
    </div>
  );
}

/**
 * G-5 — the Parts tab: what this car has for sale, what it has sold, and
 * what has come off it and is NOT listed.
 *
 * That third group is the point of the tab. A part sitting in a box is
 * invisible everywhere else in the product, and it is exactly the thing the
 * marketplace wants: already off the car, already documented, one tap from
 * being a listing.
 */
export async function GarageCarParts({ sheet }: { sheet: GarageSheet }) {
  const supabase = await createClient();

  const [{ data: listings }, { data: removedMods }] = await Promise.all([
    supabase
      .from("listings")
      .select("id, title, price_cents, status")
      .eq("source_car_id", sheet.id)
      .in("status", ["active", "reserved", "sold"])
      .order("created_at", { ascending: false }),
    supabase
      .from("mod_items")
      .select("id, brand, product, raw_text, linked_listing_id")
      .eq("car_id", sheet.id)
      .eq("status", "removed")
      .order("removed_at", { ascending: false }),
  ]);

  const forSale = (listings ?? []).filter((l) => l.status !== "sold");
  const sold = (listings ?? []).filter((l) => l.status === "sold");
  const unlisted = (removedMods ?? []).filter((m) => !m.linked_listing_id);

  return (
    <div className="mt-8 grid gap-8">
      <section>
        <span className="microlabel microlabel--ink">For sale</span>
        <div className="rowlist mt-2">
          {forSale.length ? (
            forSale.map((l) => (
              <ObjectRow
                key={l.id}
                href={`/listings/${l.id}`}
                title={l.title}
                meta={formatPrice(l.price_cents)}
              />
            ))
          ) : (
            <p className="text-body text-dim">Nothing listed off this car right now.</p>
          )}
        </div>
      </section>

      {sold.length > 0 && (
        <section>
          <span className="microlabel microlabel--ink">Sold</span>
          <div className="rowlist mt-2">
            {sold.map((l) => (
              <ObjectRow
                key={l.id}
                href={`/listings/${l.id}`}
                state="gone"
                title={l.title}
                meta={formatPrice(l.price_cents)}
              />
            ))}
          </div>
        </section>
      )}

      {unlisted.length > 0 && (
        <section>
          <span className="microlabel microlabel--ink">Came off, not listed</span>
          <div className="rowlist mt-2">
            {unlisted.map((mod) => (
              <ObjectRow
                key={mod.id}
                title={
                  [mod.brand, mod.product].filter(Boolean).join(" ") || mod.raw_text || "A part"
                }
                actions={
                  <Link
                    href={`/sell?car=${sheet.id}&mod=${mod.id}`}
                    className="relbtn !static shrink-0"
                  >
                    List it
                  </Link>
                }
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
