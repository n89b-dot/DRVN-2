"use client";

import Link from "next/link";
import { useState } from "react";

import {
  KeyValueTable,
  VehicleGallery,
  type GalleryImage,
} from "@/components/ui";

type ModGroup = { label: string; items: { brand: string | null; product: string | null; raw: string | null }[] };
type ActivityItem = { id: string; date: string; title: string; intro: string | null; gallery: GalleryImage[] };

/**
 * The public car sheet body — one continuous ruled page with a jumprow
 * (Livesheet's tab replacement), never pill tabs.
 */
export function CarTabs({
  about,
  gallery,
  modGroups,
  wheelRows,
  activity,
  carName,
  slug,
}: {
  about: string | null;
  gallery: GalleryImage[];
  modGroups: ModGroup[];
  wheelRows: { label: string; value: string }[];
  activity: ActivityItem[];
  carName: string;
  slug: string;
}) {
  const [lightbox, setLightbox] = useState<number | null>(null);

  const hasBuild = modGroups.length > 0 || wheelRows.length > 0;

  return (
    <div>
      <div className="jumprow">
        <span className="microlabel">On this sheet</span>
        {about && (
          <a className="jumplink" href="#about">
            About
          </a>
        )}
        {hasBuild && (
          <a className="jumplink" href="#build">
            The build
          </a>
        )}
        {gallery.length > 0 && (
          <a className="jumplink" href="#gallery">
            Gallery
          </a>
        )}
        <a className="jumplink" href="#activity">
          Activity
        </a>
      </div>

      {about && (
        <section id="about" className="mt-8">
          <p className="max-w-[62ch] text-[15px] leading-7">{about}</p>
        </section>
      )}

      {hasBuild && (
        <section id="build" className="mt-10">
          <div className="bsec">
            <span className="microlabel microlabel--ink">The build</span>
            <span className="microlabel">
              {modGroups.reduce((n, g) => n + g.items.length, 0) + wheelRows.length} entries
            </span>
          </div>
          {modGroups.map((group) => (
            <div key={group.label}>
              <div className="bsec">
                <span className="microlabel microlabel--live">{group.label}</span>
              </div>
              {group.items.map((mod, i) => (
                <div key={i} className="bline">
                  <span className="bline__label">{mod.brand ?? "Component"}</span>
                  <span className="bline__val">{mod.product ?? mod.raw}</span>
                  <span className="chip chip--ok">Fitted</span>
                </div>
              ))}
            </div>
          ))}
          {wheelRows.length > 0 && (
            <div>
              <div className="bsec">
                <span className="microlabel microlabel--live">Wheels &amp; Tires</span>
              </div>
              <KeyValueTable rows={wheelRows} />
            </div>
          )}
        </section>
      )}

      {gallery.length > 0 && (
        <section id="gallery" className="mt-10">
          <div className="bsec">
            <span className="microlabel microlabel--ink">Gallery</span>
            <span className="microlabel">{gallery.length} frames</span>
          </div>
          <div className="mt-2">
            <VehicleGallery images={gallery} onSelect={(i) => setLightbox(i)} />
          </div>
        </section>
      )}

      <section id="activity" className="mt-10">
        <div className="bsec">
          <span className="microlabel microlabel--ink">Activity — what this sheet saw</span>
        </div>
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
          <p className="py-2 font-mono text-[12.5px] uppercase tracking-[0.1em] text-dim">
            No entries — the section headings stay, the sheet never fakes a line.
          </p>
        )}
      </section>

      {!about && gallery.length === 0 && !hasBuild && activity.length === 0 && (
        <div className="undrawn mt-8">
          <span className="undrawn__mark" aria-hidden="true">
            ✎
          </span>
          <h3>A sheet with no build yet</h3>
          <p>The keeper hasn&apos;t logged entries. What gets fitted — and released — lands here.</p>
        </div>
      )}

      {lightbox !== null && gallery[lightbox] && (
        <div className="sheetwrap is-open !items-center" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={gallery[lightbox].url}
            alt={gallery[lightbox].alt ?? carName}
            className="max-h-[85vh] max-w-full rounded-r object-contain"
          />
        </div>
      )}
    </div>
  );
}
