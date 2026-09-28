"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { ListingRow } from "@/components/commerce";
import {
  DataRow,
  EmptyState,
  Media,
  Mosaic,
  MosaicCell,
  ObjectRow,
  RatingStars,
  SectionHeading,
  SheetTabs,
  TileHead,
  type SheetTab,
} from "@/components/ui";
import type { ProfileView } from "@/lib/profile-data";
import { postHref } from "@/lib/activity/href";

type ProfileLink = { label: string; url: string };

/** The garage as cards — the same cell the Explore wall uses for a build. */
function VehicleCards({ view }: { view: ProfileView }) {
  if (view.vehicles.length === 0) {
    return (
      <EmptyState mark="◇" title="No cars yet" className="mt-5">
        Cars added to the garage show up here.
      </EmptyState>
    );
  }
  return (
    <Mosaic uniform label="Cars in the garage">
      {view.vehicles.map((car, index) => (
        <MosaicCell
          key={car.id}
          href={`/cars/${car.slug}`}
          size="sq"
          src={car.cover}
          alt={car.name}
          eyebrow={index === 0 && view.vehicles.length > 1 ? "Main car" : "Build"}
          kind="car"
          headline={car.name}
          sub={car.platform || null}
          meta={car.colorLabel}
          eager={index < 3}
        />
      ))}
    </Mosaic>
  );
}

/** Updates as photo cards — the car chip, the date, the title, the first line. */
function ActivityCards({ view, limit }: { view: ProfileView; limit?: number }) {
  const posts = limit ? view.activity.slice(0, limit) : view.activity;
  if (posts.length === 0) {
    return (
      <EmptyState mark="✎" title="No updates yet" className="mt-5">
        Build updates show up here as they are posted.
      </EmptyState>
    );
  }
  return (
    <Mosaic uniform label="Build updates">
      {posts.map((post, index) => {
        // A post without photos (older ones predate the rule that every post
        // has one) borrows its car's cover rather than showing a tall blank.
        const src = post.gallery[0]?.url ?? post.carCover;
        return (
          <MosaicCell
            key={post.id}
            href={postHref({ id: post.id, carSlug: post.carSlug })}
            size="sq"
            src={src}
            alt={post.title}
            eyebrow="Update"
            kind="update"
            corner={post.date}
            headline={post.title}
            lede={post.intro ?? undefined}
            sub={post.carName}
            tone={src ? "photo" : "deep"}
            eager={index < 3}
          />
        );
      })}
    </Mosaic>
  );
}

/** The car they lead with (P-4, P-5): one big cover, the name on a scrim. */
function FeaturedBuild({ view }: { view: ProfileView }) {
  const car = view.vehicles[0];
  if (!car) return null;
  return (
    <Link href={`/cars/${car.slug}`} className={car.cover ? "featbuild featbuild--photo" : "featbuild"}>
      <span className="featbuild__img">
        {car.cover && <Media src={car.cover} alt={car.name} className="h-full w-full" role="hero" />}
      </span>
      <span className="featbuild__cap">
        <span className="min-w-0">
          <span className="featbuild__name block">{car.name}</span>
          {/* On a photo the caption's own light-dim colour applies; the
              `text-dim` utility would out-rank it and put grey on the car. */}
          {car.platform && (
            <span className={car.cover ? "kv mt-1 block" : "kv mt-1 block text-dim"}>{car.platform}</span>
          )}
        </span>
        <span className="jumplink">View build →</span>
      </span>
    </Link>
  );
}

/** The shopfront. A seller profile without this can't answer "what else have you got?". */
function ListingRows({ view, basePath }: { view: ProfileView; basePath: string }) {
  if (view.listings.length === 0) {
    return (
      <EmptyState mark="⌕" title="Nothing for sale right now" className="mt-5">
        Parts listed off these cars show up here.
      </EmptyState>
    );
  }

  return (
    <div className="rowlist mt-4">
      {view.listings.map((listing) => (
        <ListingRow key={listing.id} listing={listing} />
      ))}
      {view.listingsHasMore && (
        <div className="pt-2">
          <Link
            href={`${basePath}?view=forsale&listingsPage=${view.listingsPage + 1}`}
            className="jumplink"
          >
            Show more listings →
          </Link>
        </div>
      )}
    </div>
  );
}

/** Reviews were written and displayed nowhere but a single average number. */
function ReviewRows({ view, basePath }: { view: ProfileView; basePath: string }) {
  if (view.reviews.length === 0) {
    return (
      <EmptyState mark="✎" title="No reviews yet" className="mt-5">
        Reviews appear once a sale completes and the buyer confirms delivery.
      </EmptyState>
    );
  }

  return (
    <div className="mt-4">
      {view.reviews.map((review) => (
        <article key={review.id} className="review">
          <div className="review__head">
            <RatingStars rating={review.rating} />
            <span className="microlabel">
              {review.reviewerUsername ? (
                <Link href={`/u/${review.reviewerUsername}`} className="hover:text-live">
                  {review.reviewerName}
                </Link>
              ) : (
                review.reviewerName
              )}{" "}
              · {review.date}
            </span>
          </div>
          {review.body && <p className="mt-1 max-w-[62ch] text-body leading-7">{review.body}</p>}
        </article>
      ))}
      {view.reviewsHasMore && (
        <div className="pt-2">
          <Link
            href={`${basePath}?view=reviews&reviewsPage=${view.reviewsPage + 1}`}
            className="jumplink"
          >
            Show more reviews →
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * Profile body: Overview · Garage · Updates · Parts · Reviews (P-3).
 *
 * The old shape was About / For sale / Reviews / Activity, which read as a
 * seller's page with some cars attached. The new one reads as a person with
 * a garage, whose parts happen to be for sale — same content, opposite
 * emphasis, and it matches how the rest of the product is now organised.
 *
 * The About tab is gone (P-1): a bio is one paragraph, and giving it a whole
 * tab meant the first thing you saw on somebody's profile was prose rather
 * than their cars. It moves into the header and the Overview.
 *
 * Tab state stays URL-backed (`?view=`), and the OLD keys still resolve —
 * links to `?view=forsale` are out in the world, and breaking them to rename
 * a tab would be a poor trade.
 */
export function ProfileBody({
  bio,
  view,
  contactLinks,
  initialTab,
  basePath,
  partsPanel,
  partsCount,
  storeNote,
}: {
  bio: string | null;
  view: ProfileView;
  contactLinks: ProfileLink[];
  initialTab?: string;
  /** Profile URL ("/u/handle") — "Show more" links are built off this. */
  basePath: string;
  /** The store grid (P-6) — rendered by the route, which can query. */
  partsPanel?: ReactNode;
  partsCount?: number | null;
  /** One short line above the grid (P-8). */
  storeNote?: string | null;
}) {
  // The rail shows a slice of what the Garage and Parts tabs show in full,
  // so it steps aside on those tabs — on Parts the store takes the whole
  // width instead of sitting two cards wide beside its own summary.
  const [tab, setTab] = useState(initialTab ?? "overview");
  const forSale = view.listings.filter((l) => l.status === "active").slice(0, 3);
  const railGarage = view.vehicles.length > 0 && tab !== "garage";
  const railParts = forSale.length > 0 && tab !== "parts";
  const showRail = tab !== "parts" && (railGarage || railParts);

  const overviewPanel = (
    <div className="mt-8 grid gap-10">
      {/* P-4: the car they lead with, then what they've been doing to it.
          What's for sale is in the rail beside this, and one tab away. */}
      {view.vehicles.length > 0 && (
        <section className="grid gap-4">
          <SectionHeading>Featured build</SectionHeading>
          <FeaturedBuild view={view} />
        </section>
      )}
      {/* The bio follows the car: with the header's headline above, a second
          paragraph first meant the Overview opened on prose, not a car. */}
      {bio && <p className="max-w-[62ch] text-body leading-7">{bio}</p>}
      {/* Phones have no rail, and the rail used to follow the whole panel —
          a visitor who came to buy scrolled past every update first. Below
          1024px the parts come straight after the featured build instead. */}
      {forSale.length > 0 && (
        <section className="deck--aside__inline tile">
          <TileHead
            label={`Parts for sale · ${partsCount ?? forSale.length}`}
            end={
              <Link href={`${basePath}?view=parts`} className="jumplink">
                Store →
              </Link>
            }
          />
          <div className="rowlist">
            {forSale.slice(0, 2).map((listing) => (
              <ListingRow key={listing.id} listing={listing} />
            ))}
          </div>
        </section>
      )}
      {view.activity.length > 0 && (
        <section className="profupdates grid gap-4">
          <div className="flex items-baseline justify-between gap-3">
            <SectionHeading>Latest updates</SectionHeading>
            <Link href={`${basePath}?view=updates`} className="jumplink">
              View all →
            </Link>
          </div>
          <ActivityCards view={view} limit={3} />
        </section>
      )}
      {contactLinks.length > 0 && (
        <section>
          <SectionHeading>Contact</SectionHeading>
          <div className="mt-2">
            {contactLinks.map((link) => (
              <DataRow
                key={link.label}
                label={link.label}
                value={
                  <a
                    href={link.url.startsWith("http") ? link.url : `https://${link.url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="transition-colors hover:text-live"
                  >
                    {link.url.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗
                  </a>
                }
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );

  const parts = partsPanel ?? <ListingRows view={view} basePath={basePath} />;

  const tabs: SheetTab[] = [
    { key: "overview", label: "Overview", panel: overviewPanel },
    {
      key: "garage",
      label: "Garage",
      count: view.vehicles.length || null,
      panel: (
        <div className="mt-8">
          <VehicleCards view={view} />
        </div>
      ),
    },
    {
      key: "updates",
      label: "Updates",
      count: view.activityTotal || null,
      panel: (
        <div className="mt-8">
          <ActivityCards view={view} />
          {view.activityHasMore && (
            <div className="pt-4">
              <Link
                href={`${basePath}?view=updates&updatesPage=${view.activityPage + 1}`}
                className="jumplink"
                scroll={false}
              >
                Show more updates →
              </Link>
            </div>
          )}
        </div>
      ),
    },
    {
      key: "parts",
      label: "Parts",
      count: partsCount ?? view.listings.filter((l) => l.status === "active").length ?? null,
      live: true,
      panel: (
        <div className="mt-8">
          {storeNote && <p className="storenote">{storeNote}</p>}
          {parts}
        </div>
      ),
    },
    {
      key: "reviews",
      label: "Reviews",
      count: view.reviewCount || null,
      panel: <ReviewRows view={view} basePath={basePath} />,
    },
  ];
  return (
    <div className={showRail ? "deck deck--aside mt-8" : "deck deck--aside deck--aside--solo mt-8"}>
      <div>
        <SheetTabs tabs={tabs} initialTab={initialTab} label="Profile sections" onChange={setTab} />
      </div>
      {/* P-4's rail: the garage, then a few parts — desktop only (phones get
          the parts inline on the Overview). Empty tiles don't render. */}
      {showRail && (
        <aside className="deck--aside__rail" aria-label="Garage and parts for sale">
          {railGarage && (
            <section className="tile">
              <TileHead
                label={`Garage · ${view.vehicles.length}`}
                end={
                  <Link href={`${basePath}?view=garage`} className="jumplink">
                    View all →
                  </Link>
                }
              />
              <div className="rowlist">
                {view.vehicles.slice(0, 4).map((car) => (
                  <ObjectRow
                    key={car.id}
                    href={`/cars/${car.slug}`}
                    media={{ src: car.cover ?? undefined, alt: car.name }}
                    title={<span className="block truncate">{car.name}</span>}
                    meta={<span className="block truncate">{car.platform || car.colorLabel}</span>}
                  />
                ))}
              </div>
            </section>
          )}
          {railParts && (
            <section className="tile">
              <TileHead
                label="Parts for sale"
                end={
                  <Link href={`${basePath}?view=parts`} className="jumplink">
                    View all →
                  </Link>
                }
              />
              <div className="rowlist">
                {forSale.map((listing) => (
                  <ListingRow key={listing.id} listing={listing} />
                ))}
              </div>
            </section>
          )}
        </aside>
      )}
    </div>
  );
}
