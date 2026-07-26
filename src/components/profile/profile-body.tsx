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
          {car.colorLabel && <p className="mt-0.5 text-sm text-text-muted">{car.colorLabel}</p>}
          {car.gallery.length > 0 && (
            <div className="mt-4">
              <HorizontalGallery images={car.gallery.map((g) => g.url)} alt={car.name} />
            </div>
          )}
        </TimelineRow>
      ))}
      {view.vehicles.length === 0 && <p className="mt-5 text-sm text-text-muted">No cars yet.</p>}
    </div>
  );
}

function ActivityRows({ view }: { view: ProfileView }) {
  return (
    <div className="mt-5 grid gap-9">
      {view.activity.map((post) => (
        <TimelineRow key={post.id} date={post.date}>
          <LinkedTitle href={`/cars/${post.carSlug}/activity/${post.id}`} label={post.title} />
          {post.intro && <p className="mt-1 text-sm leading-6 text-text-secondary">{post.intro}</p>}
          {post.gallery.length > 0 && (
            <div className="mt-4">
              <HorizontalGallery large images={post.gallery.map((g) => g.url)} alt={post.title} />
            </div>
          )}
        </TimelineRow>
      ))}
      {view.activity.length === 0 && (
        <p className="mt-5 text-sm text-text-muted">No build updates yet.</p>
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
          {bio && <p className="text-sm leading-7 text-text-secondary">{bio}</p>}

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
              <div className="mt-5 grid gap-3">
                {contactLinks.map((link) => (
                  <div key={link.label} className="grid grid-cols-[110px_1fr] gap-4 text-sm">
                    <span className="capitalize text-text-muted">{link.label}</span>
                    <a
                      href={link.url.startsWith("http") ? link.url : `https://${link.url}`}
                      target="_blank"
                      rel="noreferrer"
                      className="group text-text-primary"
                    >
                      <span className="group-hover:underline">
                        {link.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                      </span>{" "}
                      <span className="text-xs text-text-muted">↗</span>
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

