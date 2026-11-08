import Link from "next/link";

import { ListingRow } from "@/components/commerce";
import { Media, MEDIA_SIZES, ObjectRow, TileHead } from "@/components/ui";
import { postHeadline } from "@/lib/activity/headline";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";
import { requiredRead } from "@/lib/supabase/required-read";

import type { GarageSheet } from "./garage-data";
import { workOrders } from "./garage-sheet";

type OverviewMod = {
  id: string;
  brand: string | null;
  product: string | null;
  raw_text: string | null;
  category: string | null;
  group_label?: string | null;
  image_url?: string | null;
  status?: string | null;
};

/**
 * G-4's Overview: the car at a glance, in two columns — what's been posted
 * and what's for sale on the left; what's on the car, its photos and what
 * needs doing on the right. Every tile is a summary of a tab (or a page) and
 * links to it; a tile with nothing to show says so in one line rather than
 * disappearing, because on your own car "nothing yet" is a prompt.
 */
export async function GarageCarOverview({
  sheet,
  mods,
}: {
  sheet: GarageSheet;
  mods: OverviewMod[];
}) {
  const supabase = await createClient();
  const [{ data: posts }, { data: listings }] = await Promise.all([
    supabase
      .from("activity_posts")
      .select("id, title, intro, published_at")
      .eq("car_id", sheet.id)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(3),
    supabase
      .from("listings")
      .select("id, title, price_cents, status")
      .eq("source_car_id", sheet.id)
      .in("status", ["active", "reserved"])
      .order("created_at", { ascending: false })
      .limit(4),
  ]);
  const postIds = (posts ?? []).map((p) => p.id);
  const listingIds = (listings ?? []).map((l) => l.id);
  const [{ data: postImages }, { data: listingImages }] = await Promise.all([
    postIds.length
      ? supabase.from("activity_images").select("post_id, url, position").in("post_id", postIds).order("position")
      : Promise.resolve({ data: [] as { post_id: string; url: string }[] }),
    listingIds.length
      ? supabase.from("listing_images").select("listing_id, url, position").in("listing_id", listingIds).order("position")
      : Promise.resolve({ data: [] as { listing_id: string; url: string }[] }),
  ]);
  const postCover = new Map<string, string>();
  for (const img of postImages ?? []) if (!postCover.has(img.post_id)) postCover.set(img.post_id, img.url);
  const listingCover = new Map<string, string>();
  for (const img of listingImages ?? [])
    if (!listingCover.has(img.listing_id)) listingCover.set(img.listing_id, img.url);

  const installed = mods.filter((m) => m.status !== "removed");
  const modsHavePhotos = installed.slice(0, 6).some((m) => m.image_url);
  // Next says only what the tiles beside it don't: the hero already offers
  // Post an update and the Parts tile already says nothing is listed.
  const orders = workOrders(sheet).filter(
    (o) => !o.href.endsWith("/update/new") && !o.href.startsWith("/sell")
  );
  const tab = (view: string) => `/garage?car=${sheet.id}&view=${view}`;

  return (
    <div className="deck deck--two mt-8">
      <div className="grid content-start gap-5">
        <section className="tile">
          {/* The hero already carries Post an update; this tile's link goes
              to the whole log instead of repeating it a third time. */}
          <TileHead
            label="Recent updates"
            end={
              sheet.is_public && sheet.updates > 0 ? (
                <Link href={`/cars/${sheet.slug}?view=activity`} className="jumplink">
                  All updates →
                </Link>
              ) : undefined
            }
          />
          {posts?.length ? (
            <div className="rowlist">
              {posts.map((post) => (
                <ObjectRow
                  key={post.id}
                  href={sheet.is_public ? `/cars/${sheet.slug}/activity/${post.id}` : undefined}
                  media={{ src: postCover.get(post.id), alt: "" }}
                  title={<span className="block truncate">{postHeadline(post)}</span>}
                  meta={new Date(post.published_at!).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                />
              ))}
            </div>
          ) : (
            <p className="text-body text-dim">Nothing posted about this car yet.</p>
          )}
        </section>

        <section className="tile">
          <TileHead
            label="Parts for sale"
            end={
              <Link href={tab("parts")} className="jumplink">
                View all →
              </Link>
            }
          />
          {listings?.length ? (
            <div className="rowlist">
              {listings.map((l) => (
                <ListingRow
                  key={l.id}
                  listing={{
                    id: l.id,
                    title: l.title,
                    price: formatPrice(l.price_cents),
                    cover: listingCover.get(l.id) ?? null,
                    status: l.status,
                  }}
                />
              ))}
            </div>
          ) : (
            <p className="text-body text-dim">
              Nothing listed off this car.{" "}
              <Link href={`/sell?car=${sheet.id}`} className="jumplink">
                List a part →
              </Link>
            </p>
          )}
          {sheet.salesCents > 0 && (
            <p className="mt-3 text-body text-dim">
              {formatPrice(sheet.salesCents)} in DRVN sales from parts off this car, after refunds and
              before fees.
            </p>
          )}
        </section>

        {/* Photos sit on the left, under the parts, so the two columns end
            nearer each other. One photo is shown wide, not as a quarter-width
            square in an empty tile. */}
        {sheet.photoUrls.length > 0 && (
          <section className="tile">
            <TileHead
              label="Photos"
              end={
                <Link href={tab("media")} className="jumplink">
                  View all →
                </Link>
              }
            />
            <div
              className={
                sheet.photoUrls.length === 1
                  ? "grid grid-cols-1"
                  : sheet.photoUrls.length === 2
                    ? "grid grid-cols-2 gap-2"
                    : "grid grid-cols-4 gap-2"
              }
            >
              {sheet.photoUrls.slice(0, 4).map((url) => (
                <Media
                  key={url}
                  src={url}
                  alt=""
                  className={
                    sheet.photoUrls.length === 1
                      ? "aspect-video w-full rounded-ctl"
                      : sheet.photoUrls.length === 2
                        ? "aspect-[4/3] w-full rounded-ctl"
                        : "aspect-square w-full rounded-ctl"
                  }
                  sizes={sheet.photoUrls.length === 1 ? MEDIA_SIZES.vehicle : MEDIA_SIZES.row}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="grid content-start gap-5">
        <section className="tile">
          <TileHead
            label={`Current mods${installed.length ? ` · ${installed.length}` : ""}`}
            end={
              <Link href={tab("mods")} className="jumplink">
                {installed.length ? "View all →" : "Add a mod →"}
              </Link>
            }
          />
          {installed.length ? (
            <div className="rowlist">
              {installed.slice(0, 6).map((mod) => (
                <ObjectRow
                  key={mod.id}
                  href={tab("mods")}
                  /* Most typed lines have no picture. A column of blank
                     plates read as failed loads, so the plates only appear
                     when at least one line has a photo to put in one. */
                  media={modsHavePhotos ? { src: mod.image_url ?? undefined, alt: "" } : undefined}
                  title={
                    <span className="block truncate">
                      {[mod.brand, mod.product].filter(Boolean).join(" ") || mod.raw_text || "A part"}
                    </span>
                  }
                  meta={mod.group_label ?? mod.category ?? undefined}
                />
              ))}
            </div>
          ) : (
            <p className="text-body text-dim">The mod list is empty.</p>
          )}
        </section>

        {/* Kept from the old sheet for evaluation (G-4): what needs doing —
            shown only when there is something the other tiles don't say. */}
        {orders.length > 0 && (
          <section className="tile">
            <TileHead label="Next" />
            <div className="rowlist">
              {orders.map((order) => (
                <ObjectRow key={order.label} href={order.href} title={order.label} />
              ))}
            </div>
          </section>
        )}
      </div>
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
/** What a came-off part's listing is, when it isn't in a group of its own. */
const HIDDEN_LISTING_LINE: Partial<Record<string, string>> = {
  paused: "Listing paused",
  archived: "Listing withdrawn",
  removed: "Listing taken down",
};

export async function GarageCarParts({ sheet }: { sheet: GarageSheet }) {
  const supabase = await createClient();

  const [listingsResult, removedModsResult] = await Promise.all([
    // Every status, not just the four grouped below: a came-off part whose
    // listing was paused, withdrawn or taken down must still be found.
    supabase
      .from("listings")
      .select("id, title, price_cents, status")
      .eq("source_car_id", sheet.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("mod_items")
      .select("id, brand, product, raw_text, linked_listing_id")
      .eq("car_id", sheet.id)
      .eq("status", "removed")
      .order("removed_at", { ascending: false }),
  ]);
  // RR-11: an empty tab says "nothing came off and nothing is listed". A
  // failed read must never say that; it is a failed page with Try again.
  const listings = requiredRead(listingsResult, "this car's listings");
  const removedMods = requiredRead(removedModsResult, "the parts that came off this car");

  // For sale = active + reserved: the same two states the garage counts as
  // live. A draft is not for sale, but it is not gone either — it gets its
  // own group, so a part saved as a draft from List it stays findable.
  const forSale = (listings ?? []).filter((l) => l.status === "active" || l.status === "reserved");
  const drafts = (listings ?? []).filter((l) => l.status === "draft");
  const sold = (listings ?? []).filter((l) => l.status === "sold");
  // Came off and not listed: no listing at all, or one that is not in any
  // group above (paused, withdrawn, taken down — or gone). Those rows open
  // their listing rather than starting another, as List it does (A-1).
  const grouped = new Set([...forSale, ...drafts, ...sold].map((l) => l.id));
  const statusOf = new Map((listings ?? []).map((l) => [l.id, l.status]));
  const unlisted = (removedMods ?? []).filter((m) => !m.linked_listing_id || !grouped.has(m.linked_listing_id));

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
                meta={
                  l.status === "reserved"
                    ? `${formatPrice(l.price_cents)} · Reserved`
                    : formatPrice(l.price_cents)
                }
              />
            ))
          ) : (
            <p className="text-body text-dim">Nothing listed off this car right now.</p>
          )}
        </div>
      </section>

      {drafts.length > 0 && (
        <section>
          <span className="microlabel microlabel--ink">Drafts</span>
          <div className="rowlist mt-2">
            {drafts.map((l) => (
              <ObjectRow
                key={l.id}
                title={l.title}
                meta={l.price_cents ? `Draft · ${formatPrice(l.price_cents)}` : "Draft · not listed yet"}
                actions={
                  <Link href={`/listings/${l.id}/edit`} className="relbtn !static shrink-0">
                    Finish listing
                  </Link>
                }
              />
            ))}
          </div>
        </section>
      )}

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
            {unlisted.map((mod) => {
              const linked = mod.linked_listing_id;
              const linkedStatus = linked ? statusOf.get(linked) : undefined;
              return (
                <ObjectRow
                  key={mod.id}
                  title={
                    [mod.brand, mod.product].filter(Boolean).join(" ") || mod.raw_text || "A part"
                  }
                  meta={linkedStatus ? HIDDEN_LISTING_LINE[linkedStatus] ?? null : null}
                  actions={
                    <Link
                      href={linked && linkedStatus ? `/listings/${linked}/edit` : `/sell?car=${sheet.id}&mod=${mod.id}`}
                      className="relbtn !static shrink-0"
                    >
                      {linked && linkedStatus ? "Open listing" : "List it"}
                    </Link>
                  }
                />
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
