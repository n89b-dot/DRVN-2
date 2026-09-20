"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { ListingRow } from "@/components/commerce";
import {
  DataRow,
  EmptyState,
  HorizontalGallery,
  LinkedTitle,
  RatingStars,
  SectionHeading,
  SheetTabs,
  TimelineRow,
  type SheetTab,
} from "@/components/ui";
import type { ProfileView } from "@/lib/profile-data";
import { postHref } from "@/lib/activity/href";

type ProfileLink = { label: string; url: string };

function VehicleRows({ view }: { view: ProfileView }) {
  return (
    <div className="mt-5 grid gap-9">
      {view.vehicles.map((car) => (
        <TimelineRow key={car.id} date={car.year}>
          <LinkedTitle href={`/cars/${car.slug}`} label={car.name} />
          {car.colorLabel && <p className="order__meta mt-0.5">{car.colorLabel}</p>}
          {car.gallery.length > 0 && (
            <div className="mt-4">
              <HorizontalGallery images={car.gallery.map((g) => g.url)} alt={car.name} />
            </div>
          )}
        </TimelineRow>
      ))}
      {view.vehicles.length === 0 && (
        <p className="mt-5 font-mono text-micro uppercase tracking-[0.1em] text-dim">
          No cars yet
        </p>
      )}
    </div>
  );
}

function ActivityRows({ view }: { view: ProfileView }) {
  return (
    <div className="mt-5 grid gap-9">
      {view.activity.map((post) => (
        <TimelineRow key={post.id} date={post.date}>
          <LinkedTitle href={postHref({ id: post.id, carSlug: post.carSlug })} label={post.title} />
          {post.intro && <p className="mt-1 max-w-[62ch] text-sm leading-6">{post.intro}</p>}
          {post.gallery.length > 0 && (
            <div className="mt-4">
              <HorizontalGallery large images={post.gallery.map((g) => g.url)} alt={post.title} />
            </div>
          )}
        </TimelineRow>
      ))}
      {view.activity.length === 0 && (
        <p className="mt-5 font-mono text-micro uppercase tracking-[0.1em] text-dim">
          No entries
        </p>
      )}
    </div>
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
  const aboutPanel = (
    <div className="mt-8 grid gap-12">
      {bio && <p className="max-w-[62ch] text-body leading-7">{bio}</p>}

      <section>
        <SectionHeading>Cars &amp; builds</SectionHeading>
        <VehicleRows view={view} />
      </section>

      {contactLinks.length > 0 && (
        <section>
          <SectionHeading>Contact</SectionHeading>
          <div className="mt-2">
            {contactLinks.map((link) => (
              <div key={link.label} className="bline">
                <span className="bline__label">{link.label}</span>
                <a
                  href={link.url.startsWith("http") ? link.url : `https://${link.url}`}
                  target="_blank"
                  rel="noreferrer"
                  className="bline__val !text-body transition-colors hover:text-live"
                >
                  {link.url.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗
                </a>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );

  const overviewPanel = (
    <div className="mt-8 grid gap-12">
      {bio && <p className="max-w-[62ch] text-body leading-7">{bio}</p>}
      <section>
        {/* P-4: the car they lead with, then what they've been doing to it,
            then what's for sale. The order is the product's own argument. */}
        <SectionHeading>The garage</SectionHeading>
        <VehicleRows view={view} />
      </section>
      {view.activity.length > 0 && (
        <section>
          <SectionHeading>Latest updates</SectionHeading>
          <ActivityRows view={{ ...view, activity: view.activity.slice(0, 3) }} />
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
          <VehicleRows view={view} />
        </div>
      ),
    },
    {
      key: "updates",
      label: "Updates",
      count: view.activity.length || null,
      panel: <ActivityRows view={view} />,
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
  void aboutPanel;

  return (
    <div className="mt-8">
      <SheetTabs tabs={tabs} initialTab={initialTab} label="Profile sections" />
    </div>
  );
}
