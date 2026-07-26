"use client";

import Link from "next/link";
import { useState } from "react";

import {
  Dialog,
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
  /** Set when this part has been released for sale off this car. */
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
 * The public car sheet body.
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
      {about && <p className="max-w-[62ch] text-[15px] leading-7">{about}</p>}

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

                  {/* Only states we can actually stand behind — the old sheet
                      stamped "Fitted" on every row regardless. */}
                  {mod.listing ? (
                    <Link
                      href={`/listings/${mod.listing.id}`}
                      className={`chip ${mod.listing.status === "sold" ? "chip--spent" : "chip--live"}`}
                    >
                      {mod.listing.status === "sold" ? "Sold" : `Listed ${money(mod.listing.price)}`}
                    </Link>
                  ) : isOwner ? (
                    // "Release a part" — .bline--own and .relbtn shipped in the
                    // stylesheet and had no call site until now.
                    <Link href={`/sell?car=${carId}&mod=${mod.id}`} className="relbtn">
                      Release
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
          <p className="py-2 font-mono text-[12.5px] uppercase tracking-[0.1em] text-dim">
            No build entries yet — the sheet never fakes a line.
          </p>
        )
      )}
    </div>
  );

  const forSalePanel = (
    <div className="mt-4">
      {forSale.length > 0 ? (
        <>
          <div className="bsec">
            <span className="microlabel microlabel--ink">Released from this car</span>
            <span className="microlabel">
              {forSale.filter((i) => i.status !== "sold").length} live · {soldFrom} sold
            </span>
          </div>
          <div className="rowlist mt-2">
            {forSale.map((item) => (
              <Link key={item.id} href={`/listings/${item.id}`} className="order">
                <span className="order__img">
                  {item.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.cover} alt={item.title} className="h-full w-full object-cover" />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="order__name block truncate">{item.title}</span>
                  <span className="order__meta block">{item.price}</span>
                </span>
                <span className="order__actions">
                  <span className={`chip ${item.status === "sold" ? "chip--spent" : "chip--live"}`}>
                    {item.status === "sold" ? "Sold" : "Live"}
                  </span>
                </span>
              </Link>
            ))}
          </div>
          <div className="mt-4">
            <Link href="/marketplace" className="jumplink inline-flex">
              See everything in the market
            </Link>
          </div>
        </>
      ) : (
        <div className="undrawn">
          <span className="undrawn__mark" aria-hidden="true">
            ⌕
          </span>
          <h3>Nothing released yet</h3>
          <p>
            {isOwner
              ? "When you pull a part off this car, release it from the build sheet and it appears here."
              : "No parts from this car are on the market right now."}
          </p>
          {isOwner && (
            <Link href={`/sell?car=${carId}`} className="btn btn--live">
              Release a part
            </Link>
          )}
        </div>
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
        <div className="undrawn">
          <span className="undrawn__mark" aria-hidden="true">
            ✎
          </span>
          <h3>No entries yet</h3>
          <p>
            {isOwner
              ? "Post an update from your garage and the build log starts here."
              : "The keeper hasn't logged anything on this car yet."}
          </p>
          {isOwner && (
            <Link href={`/garage/${carId}/update/new`} className="btn btn--ghost">
              Post an update
            </Link>
          )}
        </div>
      )}
    </div>
  );

  const galleryPanel = (
    <div className="mt-4">
      {gallery.length > 0 ? (
        <VehicleGallery images={gallery} onSelect={(i) => setLightbox(i)} />
      ) : (
        <p className="py-2 font-mono text-[12.5px] uppercase tracking-[0.1em] text-dim">
          No frames on this sheet yet.
        </p>
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
      <SheetTabs tabs={tabs} initialTab={initialTab} label={`${carName} — sheet sections`} />

      <Dialog
        open={lightbox !== null}
        onClose={() => setLightbox(null)}
        label={`${carName} — photo`}
        align="center"
      >
        {lightbox !== null && gallery[lightbox] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={gallery[lightbox].url}
            alt={gallery[lightbox].alt ?? carName}
            className="max-h-[85vh] max-w-full rounded-r object-contain"
          />
        )}
      </Dialog>
    </div>
  );
}
