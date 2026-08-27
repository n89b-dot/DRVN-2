"use client";

import Link from "next/link";
import { useState } from "react";

import { ListingRow } from "@/components/commerce";
import {
  EmptyState,
  GalleryLightbox,
  KeyValueTable,
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
export function CarTabs({
  about,
  gallery,
  modGroups,
  wheelRows,
  activity,
  forSale,
  soldFrom,
  carName,
  carId,
  slug,
  isOwner,
  initialTab,
}: {
  about: string | null;
  gallery: GalleryImage[];
  modGroups: ModGroup[];
  wheelRows: { label: string; value: string }[];
  activity: ActivityItem[];
  forSale: ForSaleItem[];
  soldFrom: number;
  carName: string;
  carId: string;
  slug: string;
  isOwner: boolean;
  initialTab?: string;
}) {
  const [lightbox, setLightbox] = useState<number | null>(null);

  const hasBuild = modGroups.length > 0 || wheelRows.length > 0;
  const entryCount = modGroups.reduce((n, g) => n + g.items.length, 0) + wheelRows.length;

  const buildPanel = (
    <div className="mt-2">
      {about && <p className="max-w-[62ch] text-body leading-7">{about}</p>}

      {hasBuild ? (
        <section className={about ? "mt-8" : ""}>
          <div className="bsec">
            <span className="microlabel microlabel--ink">The build</span>
            <span className="microlabel">{entryCount} entries</span>
          </div>
          {modGroups.map((group) => (
            <div key={group.label}>
              <div className="bsec">
                {/* Group headings are taxonomy, not live state. */}
                <span className="microlabel microlabel--ink">{group.label}</span>
              </div>
              {group.items.map((mod) => (
                <div key={mod.id} className={`bline ${isOwner ? "bline--own" : ""}`}>
                  <span className="bline__label">{mod.brand ?? "Component"}</span>
                  <span className="bline__val">{mod.product ?? mod.raw}</span>

                  {/* Only states we can actually stand behind — this row once
                      stamped "Fitted" on every entry regardless. */}
                  {mod.listing ? (
                    <Link
                      href={`/listings/${mod.listing.id}`}
                      className={`chip ${mod.listing.status === "sold" ? "chip--spent" : "chip--live"}`}
                    >
                      {mod.listing.status === "sold" ? "Sold" : `For sale ${money(mod.listing.price)}`}
                    </Link>
                  ) : isOwner ? (
                    // "List this part" — .bline--own and .relbtn shipped in the
                    // stylesheet and had no call site until now.
                    <Link href={`/sell?car=${carId}&mod=${mod.id}`} className="relbtn">
                      Sell it
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
          {wheelRows.length > 0 && (
            <div>
              <div className="bsec">
                <span className="microlabel microlabel--ink">Wheels &amp; Tires</span>
              </div>
              <KeyValueTable rows={wheelRows} />
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
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={g.url} alt={g.alt ?? post.title} />
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
