"use client";

import Link from "next/link";

import { ListingRow } from "@/components/commerce";
import {
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
          <LinkedTitle href={`/cars/${post.carSlug}/activity/${post.id}`} label={post.title} />
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
 * Profile body: About / For sale / Reviews / Activity.
 *
 * Now on SheetTabs, so tab state is real and URL-backed (`?view=`) — linking
 * someone to a seller's listings or reviews is a thing people do, and the
 * previous client-only state made it impossible.
 */
export function ProfileBody({
  bio,
  view,
  contactLinks,
  initialTab,
  basePath,
}: {
  bio: string | null;
  view: ProfileView;
  contactLinks: ProfileLink[];
  initialTab?: string;
  /** Profile URL ("/u/handle") — "Show more" links are built off this. */
  basePath: string;
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

  const tabs: SheetTab[] = [
    { key: "about", label: "About", panel: aboutPanel },
    {
      key: "forsale",
      label: "For sale",
      count: view.listings.filter((l) => l.status === "active").length || null,
      live: true,
      panel: <ListingRows view={view} basePath={basePath} />,
    },
    {
      key: "reviews",
      label: "Reviews",
      count: view.reviewCount || null,
      panel: <ReviewRows view={view} basePath={basePath} />,
    },
    {
      key: "activity",
      label: "Activity",
      count: view.activity.length || null,
      panel: <ActivityRows view={view} />,
    },
  ];

  return (
    <div className="mt-8">
      <SheetTabs tabs={tabs} initialTab={initialTab} label="Profile sections" />
    </div>
  );
}
