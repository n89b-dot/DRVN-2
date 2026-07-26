"use client";

import { useState } from "react";

import {
  HorizontalGallery,
  LinkedTitle,
  SectionHeading,
  TabNav,
  TimelineRow,
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
        <p className="mt-5 font-mono text-[12.5px] uppercase tracking-[0.1em] text-dim">No cars yet</p>
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
        <p className="mt-5 font-mono text-[12.5px] uppercase tracking-[0.1em] text-dim">No entries</p>
      )}
    </div>
  );
}

/**
 * Profile page body per the Figma reference (346:5190): About | Activity tabs;
 * About = bio → Vehicles timeline (square thumbs, color line) → Activity
 * timeline (wide thumbs) → Contact label/value rows. Activity tab = full log.
 */
export function ProfileBody({
  bio,
  view,
  contactLinks,
}: {
  bio: string | null;
  view: ProfileView;
  contactLinks: ProfileLink[];
}) {
  const [tab, setTab] = useState("About");

  return (
    <div>
      <div className="mt-8">
        <TabNav tabs={["About", "Activity"]} active={tab} onChange={setTab} />
      </div>

      {tab === "About" ? (
        <div className="mt-8 grid gap-12">
          {bio && <p className="max-w-[62ch] text-[15px] leading-7">{bio}</p>}

          <section>
            <SectionHeading>Vehicles</SectionHeading>
            <VehicleRows view={view} />
          </section>

          {view.activity.length > 0 && (
            <section>
              <SectionHeading>Activity</SectionHeading>
              <ActivityRows view={view} />
            </section>
          )}

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
                      className="bline__val !text-[15px] transition-colors hover:text-live"
                    >
                      {link.url.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗
                    </a>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="mt-8">
          <ActivityRows view={view} />
        </div>
      )}
    </div>
  );
}

