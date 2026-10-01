import Link from "next/link";

import { LiveDim } from "@/components/livesheet";
import { ButtonLink, Media, SheetTabs, type SheetTab } from "@/components/ui";

import type { GarageSheet } from "./garage-data";

/**
 * G-2…G-5 — one car, in focus.
 *
 * The cover carries a gradient scrim (G-2) so the car's name reads on any
 * photo, in direct sun or at night, without ever drawing text into the image
 * itself. The stat strip (G-3) is built only from data the car actually has:
 * a tile with no value doesn't render, and fewer than three tiles means no
 * strip at all, because two numbers in a row reads as a mistake rather than
 * a summary.
 */
export function FocusedCar({
  sheet,
  panels,
  initialTab,
}: {
  sheet: GarageSheet;
  /** The tab panels — mounted by the route, which can query. */
  panels: {
    overview: React.ReactNode;
    mods: React.ReactNode;
    parts: React.ReactNode;
    media: React.ReactNode;
  };
  initialTab?: string;
}) {
  const stats = [
    sheet.engine ? { label: "Engine", value: sheet.engine } : null,
    sheet.drivetrain ? { label: "Drivetrain", value: sheet.drivetrain } : null,
    sheet.trim ? { label: "Trim", value: sheet.trim } : null,
    sheet.mods > 0 ? { label: "Mods", value: String(sheet.mods) } : null,
    sheet.updates > 0 ? { label: "Updates", value: String(sheet.updates) } : null,
    sheet.partsLive > 0 ? { label: "Parts live", value: String(sheet.partsLive) } : null,
    sheet.partsHeld > 0 ? { label: "In checkout", value: String(sheet.partsHeld) } : null,
    sheet.partsSold > 0 ? { label: "Sold", value: String(sheet.partsSold) } : null,
    sheet.followers > 0 ? { label: "Followers", value: String(sheet.followers) } : null,
  ].filter((s): s is { label: string; value: string } => s !== null);

  const tabs: SheetTab[] = [
    { key: "overview", label: "Overview", panel: panels.overview },
    { key: "mods", label: "Mods", count: sheet.mods || null, panel: panels.mods },
    {
      key: "parts",
      label: "Parts",
      count: sheet.partsLive || null,
      live: sheet.partsLive > 0,
      panel: panels.parts,
    },
    { key: "media", label: "Media", count: sheet.photos || null, panel: panels.media },
  ];

  return (
    <>
      <section className={sheet.cover_image_url ? "carfocus carfocus--photo" : "carfocus"}>
        <span className="carfocus__cover">
          <Media src={sheet.cover_image_url ?? undefined} alt="" className="h-full w-full" role="hero" />
        </span>
        <div className="carfocus__body">
          <span className="microlabel">
            {[sheet.year, sheet.make, sheet.model].filter(Boolean).join(" ") || "Your car"}
            {!sheet.is_public && " · Private"}
          </span>
          <h1 className="carfocus__name">{sheet.name}</h1>
          <div className="carfocus__actions">
            <ButtonLink href={`/garage/${sheet.id}/update/new`} variant="live">
              Post update
            </ButtonLink>
            <ButtonLink href={`/garage/${sheet.id}/edit`} variant="ghost">
              Edit the car
            </ButtonLink>
            {sheet.is_public && (
              <Link href={`/cars/${sheet.slug}`} className="jumplink">
                View the build page →
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* G-3: fewer than three real values and there is no strip. */}
      {stats.length >= 3 && (
        <section className="carstats" aria-label="This car at a glance">
          {stats.map((stat) => (
            <LiveDim key={stat.label} label={stat.label} value={stat.value} />
          ))}
        </section>
      )}

      <div className="mt-6">
        <SheetTabs tabs={tabs} initialTab={initialTab} label="Car sections" />
      </div>
    </>
  );
}
