"use client";

import { useState } from "react";

import {
  HorizontalGallery,
  KeyValueTable,
  LinkedTitle,
  SectionLabel,
  TabNav,
  VehicleGallery,
  type GalleryImage,
} from "@/components/ui";

type ModGroup = { label: string; items: { brand: string | null; product: string | null; raw: string | null }[] };
type ActivityItem = { id: string; date: string; title: string; intro: string | null; gallery: GalleryImage[] };

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
  const [tab, setTab] = useState("About");
  const [lightbox, setLightbox] = useState<number | null>(null);

  return (
    <div>
      <TabNav tabs={["About", "Activity"]} active={tab} onChange={setTab} />

      {tab === "About" ? (
        <div className="mt-8 grid gap-12">
          {about && <p className="text-sm leading-7 text-text-secondary">{about}</p>}

          {gallery.length > 0 && (
            <section>
              <SectionLabel>Gallery</SectionLabel>
              <div className="mt-5">
                <VehicleGallery images={gallery} onSelect={(i) => setLightbox(i)} />
              </div>
            </section>
          )}

          {modGroups.length > 0 && (
            <section>
              <SectionLabel>Modifications</SectionLabel>
              <div className="mt-5 grid gap-5">
                {modGroups.map((group) => (
                  <div key={group.label}>
                    <p className="text-sm font-medium text-text-primary">{group.label}</p>
                    <ul className="mt-2 grid gap-1.5">
                      {group.items.map((mod, i) => (
                        <li key={i} className="text-sm leading-6 text-text-secondary">
                          {mod.brand && <span className="font-medium text-text-primary">{mod.brand} </span>}
                          {mod.product ?? mod.raw}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {wheelRows.length > 0 && (
            <section>
              <SectionLabel>Wheels &amp; Tires</SectionLabel>
              <div className="mt-5">
                <KeyValueTable rows={wheelRows} />
              </div>
            </section>
          )}

          {!about && gallery.length === 0 && modGroups.length === 0 && wheelRows.length === 0 && (
            <p className="text-sm text-text-muted">Nothing here yet.</p>
          )}
        </div>
      ) : (
        <div className="mt-8 grid gap-8">
          {activity.map((post) => (
            <div key={post.id} className="grid grid-cols-[52px_1fr] gap-4">
              <span className="pt-0.5 text-right text-xs text-text-muted">{post.date}</span>
              <div>
                <LinkedTitle href={`/cars/${slug}/activity/${post.id}`} label={post.title} />
                {post.intro && <p className="mt-1 text-sm leading-6 text-text-secondary">{post.intro}</p>}
                {post.gallery.length > 0 && (
                  <div className="mt-3">
                    <HorizontalGallery images={post.gallery.map((g) => g.url)} alt={post.title} />
                  </div>
                )}
              </div>
            </div>
          ))}
          {activity.length === 0 && <p className="text-sm text-text-muted">No build updates yet.</p>}
        </div>
      )}

      {lightbox !== null && gallery[lightbox] && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={gallery[lightbox].url}
            alt={gallery[lightbox].alt ?? carName}
            className="max-h-[85vh] max-w-full rounded-card object-contain"
          />
        </div>
      )}
    </div>
  );
}
