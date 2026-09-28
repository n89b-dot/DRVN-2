"use client";

import Link from "next/link";
import { useState } from "react";

import { ListingRow } from "@/components/commerce";
import { ShowcaseExplorer, type ShowcasePin } from "@/features/garage/showcase";
import { BuildEvolution, type EvolutionMilestone } from "@/features/garage/build-evolution";
import {
  EmptyState,
  ObjectRow,
  GalleryLightbox,
  Media,
  SheetTabs,
  VehicleGallery,
  type GalleryImage,
  type SheetTab,
} from "@/components/ui";

export type ModLine = {
  id: string;
  brand: string | null;
  product: string | null;
  raw: string | null;
  /** Set when this part has been listed for sale off this car. */
  listing: { id: string; price: string; status: string } | null;
  /** Where the owner pasted this part from, and the thumbnail that came with
   *  it (L-3). A row that has them reads as an object rather than a ruled
   *  line — it has a picture and somewhere to go. */
  productUrl?: string | null;
  imageUrl?: string | null;
  sourceDomain?: string | null;
  /** Set when this part came from a DRVN purchase (C-1). */
  bought?: { bought: true; sourceCar: { name: string; slug: string } | null } | null;
};
type ModGroup = { label: string; items: ModLine[] };
type ActivityItem = {
  id: string;
  date: string;
  title: string;
  intro: string | null;
  gallery: GalleryImage[];
};
export type ForSaleItem = {
  id: string;
  title: string;
  price: string;
  status: string;
  cover: string | null;
};

function money(value: string) {
  return value;
}

/**
 * The public build page body.
 *
 * Now real tabs rather than scroll anchors: a car's activity is a place people
 * link to ("look at the build log on this one"), which anchors could not
 * express. Panels are all server-rendered and switched client-side — see
 * SheetTabs for why the state is URL-backed.
 */
/**
 * One build line, as an object row: the part's name, then a dim line with
 * its group (in a flat list), where it was bought or the shop it came from,
 * and its state at the end. Typed lines used to be a spreadsheet row — a
 * 200px brand column and an empty two-thirds — beside photo rows that
 * looked like a different list.
 *
 * `plate` is decided per list: when any line has a photo every line gets a
 * plate (the empty ones draw the undrawn fallback), so the names align.
 */
function ModRow({
  mod,
  carId,
  isOwner,
  off = false,
  group,
  plate = false,
}: {
  mod: ModLine;
  carId: string;
  isOwner: boolean;
  off?: boolean;
  /** The line's group, when the list is flat rather than under headings. */
  group?: string;
  plate?: boolean;
}) {
  const name = [mod.brand, mod.product].filter(Boolean).join(" ") || mod.raw || "Component";
  // The line a buyer reads back on their own build sheet. A private source
  // build is not named at all — same rule as every other source-car mention.
  const source = mod.bought ? (
    <>
      Bought on DRVN
      {mod.bought.sourceCar && (
        <>
          {" · off "}
          <Link href={`/cars/${mod.bought.sourceCar.slug}`} className="jumplink">
            {mod.bought.sourceCar.name}
          </Link>
        </>
      )}
    </>
  ) : mod.productUrl ? (
    <a href={mod.productUrl} target="_blank" rel="nofollow noreferrer" className="jumplink">
      {mod.sourceDomain ?? "View the product"} →
    </a>
  ) : null;
  const meta =
    group && source ? (
      <>
        {group} · {source}
      </>
    ) : (
      (group ?? source)
    );
  return (
    <ObjectRow
      className={off ? "opacity-60" : undefined}
      media={plate ? { src: mod.imageUrl ?? undefined, alt: "" } : undefined}
      title={name}
      meta={meta ?? undefined}
      actions={<ModState mod={mod} carId={carId} isOwner={isOwner} off={off} />}
    />
  );
}

/**
 * A build line's trailing state: its listing's real state, or the owner's way
 * to make one. Only an active listing says "For sale" — a draft, a reserved
 * part or a paused one used to claim it too. Drafts, paused and archived
 * listings are the owner's business, so visitors see nothing for them.
 */
function ModState({
  mod,
  carId,
  isOwner,
  off,
}: {
  mod: ModLine;
  carId: string;
  isOwner: boolean;
  off: boolean;
}) {
  const listing = mod.listing;
  if (listing) {
    if (listing.status === "active") {
      return (
        <Link href={`/listings/${listing.id}`} className="chip chip--live">
          For sale {money(listing.price)}
        </Link>
      );
    }
    if (listing.status !== "sold" && listing.status !== "reserved" && !isOwner) return null;
    return (
      <Link
        href={listing.status === "draft" ? `/listings/${listing.id}/edit` : `/listings/${listing.id}`}
        className="chip chip--spent"
      >
        {listing.status.charAt(0).toUpperCase() + listing.status.slice(1)}
      </Link>
    );
  }
  // Selling starts from a part that came off. A fitted part is taken off in
  // the garage (its List it marks it removed first); a Sell it here left it
  // fitted and for sale at once.
  if (!isOwner || !off) return null;
  return (
    <Link href={`/sell?car=${carId}&mod=${mod.id}`} className="relbtn !static">
      Sell it
    </Link>
  );
}

export function CarTabs({
  about,
  gallery,
  modGroups,
  cameOff,
  activity,
  forSale,
  soldFrom,
  carName,
  carId,
  slug,
  isOwner,
  initialTab,
  showcase,
  evolution,
}: {
  about: string | null;
  gallery: GalleryImage[];
  modGroups: ModGroup[];
  /** Parts that came off this car — still records, not deletions (A-2). */
  cameOff: ModLine[];
  activity: ActivityItem[];
  forSale: ForSaleItem[];
  soldFrom: number;
  carName: string;
  carId: string;
  slug: string;
  isOwner: boolean;
  initialTab?: string;
  /** The annotated showcase image (§U) — one photo, pinned parts. */
  showcase?: { imageUrl: string; pins: ShowcasePin[] } | null;
  /** Dated update milestones for the Build Evolution strip (§V). */
  evolution?: EvolutionMilestone[];
}) {
  const [lightbox, setLightbox] = useState<number | null>(null);

  const hasBuild = modGroups.length > 0 || cameOff.length > 0;
  const entryCount = modGroups.reduce((n, g) => n + g.items.length, 0);
  // A heading per group only pays when groups hold a few lines each. When
  // most hold one, five parts became ten rows — so the list goes flat and
  // each line carries its group in its label instead.
  const flat = modGroups.length > 0 && entryCount / modGroups.length < 2;
  const buildHasPhotos = modGroups.some((g) => g.items.some((m) => m.imageUrl));

  const buildPanel = (
    <div className="mt-2">
      {showcase && showcase.pins.length > 0 && (
        <div className="mb-6">
          <ShowcaseExplorer
            imageUrl={showcase.imageUrl}
            alt={`${carName} — showcase`}
            pins={showcase.pins}
          />
        </div>
      )}
      {about && <p className="max-w-[62ch] text-body leading-7">{about}</p>}

      {hasBuild ? (
        <section className={about ? "mt-8" : ""}>
          {/* No "The build" heading: the tab is already called that. */}
          {flat ? (
            <div className="rowlist">
              {modGroups.flatMap((group) =>
                group.items.map((mod) => (
                  <ModRow
                    key={mod.id}
                    mod={mod}
                    carId={carId}
                    isOwner={isOwner}
                    group={group.label}
                    plate={buildHasPhotos}
                  />
                ))
              )}
            </div>
          ) : (
            modGroups.map((group) => (
              <div key={group.label}>
                <div className="bsec">
                  {/* Group headings are taxonomy, not live state. */}
                  <span className="microlabel microlabel--ink">{group.label}</span>
                  <span className="microlabel">{group.items.length}</span>
                </div>
                {/* Only states we can actually stand behind — this row once
                    stamped "Fitted" on every entry regardless. */}
                <div className="rowlist">
                  {group.items.map((mod) => (
                    <ModRow key={mod.id} mod={mod} carId={carId} isOwner={isOwner} plate={buildHasPhotos} />
                  ))}
                </div>
              </div>
            ))
          )}
          {cameOff.length > 0 && (
            /* A-2. The parts that left the car, kept on the sheet. This is
               what makes a used part's provenance checkable: a buyer can read
               the build that the part came off, and see that it says so. */
            <div>
              <div className="bsec">
                <span className="microlabel microlabel--ink">Came off this car</span>
                <span className="microlabel">{cameOff.length}</span>
              </div>
              <div className="rowlist">
                {cameOff.map((mod) => (
                  <ModRow
                    key={mod.id}
                    mod={mod}
                    carId={carId}
                    isOwner={isOwner}
                    off
                    plate={cameOff.some((m) => m.imageUrl)}
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      ) : (
        !about && (
          <EmptyState
            mark="✎"
            title="No mods listed yet"
            action={
              isOwner && (
                <Link href={`/garage/${carId}/edit`} className="btn btn--ghost">
                  Record a mod
                </Link>
              )
            }
          >
            {isOwner
              ? "The build sheet starts with the first mod you record."
              : "This build sheet is still blank — the owner hasn't recorded any mods."}
          </EmptyState>
        )
      )}
    </div>
  );

  const forSalePanel = (
    <div className="mt-4">
      {forSale.length > 0 ? (
        <>
          <div className="bsec">
            <span className="microlabel microlabel--ink">Parts off this car</span>
            <span className="microlabel">
              {forSale.filter((i) => i.status !== "sold").length} for sale · {soldFrom} sold
            </span>
          </div>
          <div className="rowlist mt-2">
            {forSale.map((item) => (
              <ListingRow key={item.id} listing={item} />
            ))}
          </div>
          <div className="mt-4">
            <Link href="/marketplace" className="jumplink inline-flex">
              Browse the whole marketplace
            </Link>
          </div>
        </>
      ) : (
        <EmptyState
          mark="⌕"
          title="Nothing for sale from this car"
          action={
            isOwner && (
              <Link href={`/sell?car=${carId}`} className="btn btn--live">
                List a part
              </Link>
            )
          }
        >
          {isOwner
            ? "When you take a part off this car, list it from the build and it shows up here — with the car attached."
            : "No parts from this car are for sale right now."}
        </EmptyState>
      )}
    </div>
  );

  const activityPanel = (
    <div className="mt-4">
      {evolution && evolution.length >= 2 && (
        <div className="mb-6">
          <BuildEvolution milestones={evolution} />
        </div>
      )}
      {activity.length > 0 ? (
        <ul className="feed">
          {activity.map((post) => (
            <li key={post.id}>
              <time>{post.date}</time>
              <span className="min-w-0">
                <Link
                  href={`/cars/${slug}/activity/${post.id}`}
                  className="order__name block transition-colors hover:text-live"
                >
                  {post.title}
                </Link>
                {post.intro && <span className="order__meta block">{post.intro}</span>}
                {post.gallery.length > 0 && (
                  <span className="thumbs !mt-2">
                    {post.gallery.slice(0, 4).map((g, i) => (
                      <span key={i} className="thumb">
                        {/* Through the resizer: a raw <img> here shipped the
                            full-size original (≈470 KB each) for a ~120px
                            thumbnail, and React hoisted it into a head
                            preload even while this tab was hidden. */}
                        <Media src={g.url} alt={g.alt ?? post.title} className="h-full w-full" role="thumb" />
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          mark="✎"
          title="No updates yet"
          action={
            isOwner && (
              <Link href={`/garage/${carId}/update/new`} className="btn btn--ghost">
                Post an update
              </Link>
            )
          }
        >
          {isOwner
            ? "Post an update from your garage and the build log starts here."
            : "The owner hasn't posted any updates for this car yet."}
        </EmptyState>
      )}
    </div>
  );

  const galleryPanel = (
    <div className="mt-4">
      {gallery.length > 0 ? (
        <VehicleGallery images={gallery} onSelect={(i) => setLightbox(i)} />
      ) : (
        <EmptyState
          mark="✎"
          title="No photos yet"
          action={
            isOwner && (
              <Link href={`/garage/${carId}/edit`} className="btn btn--ghost">
                Add photos
              </Link>
            )
          }
        >
          {isOwner
            ? "Photos give the build sheet its face — add the first one."
            : "The owner hasn't photographed this car yet."}
        </EmptyState>
      )}
    </div>
  );

  const tabs: SheetTab[] = [
    { key: "build", label: "The build", count: entryCount || null, panel: buildPanel },
    {
      key: "forsale",
      label: "For sale",
      count: forSale.filter((i) => i.status !== "sold").length || null,
      live: true,
      panel: forSalePanel,
    },
    { key: "activity", label: "Activity", count: activity.length || null, panel: activityPanel },
    { key: "gallery", label: "Gallery", count: gallery.length || null, panel: galleryPanel },
  ];

  return (
    <div>
      <SheetTabs tabs={tabs} initialTab={initialTab} label={`${carName} — build sections`} />

      <GalleryLightbox
        images={gallery}
        index={lightbox ?? 0}
        onIndexChange={setLightbox}
        open={lightbox !== null}
        onClose={() => setLightbox(null)}
        label={carName}
      />
    </div>
  );
}
