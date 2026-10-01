import Link from "next/link";

import { LiveDim, Rv } from "@/components/livesheet";
import { Media } from "@/components/ui";

import type { GarageSheet } from "./garage-data";
import { PlateSwiper } from "./plate-swiper";
import { SheetActions } from "./sheet-actions";
import { SheetDetails } from "./sheet-details";
import { vehicleSubline } from "@/lib/vehicles/label";

const DAY = 864e5;

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));
}

/** "today" / "3d ago" / "2w ago" / "4mo ago" — a sheet date is a feel. */
function ago(iso: string): string {
  const d = daysSince(iso);
  if (d === 0) return "today";
  if (d < 7) return `${d}d ago`;
  if (d < 35) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

/** "in the garage 3 months" — how long this car has been on the sheet. */
function tenure(iso: string): string {
  const d = daysSince(iso);
  if (d < 1) return "added today";
  if (d < 14) return `${d} day${d === 1 ? "" : "s"} in the garage`;
  if (d < 60) return `${Math.floor(d / 7)} weeks in the garage`;
  if (d < 365) return `${Math.floor(d / 30)} months in the garage`;
  const y = Math.floor(d / 365);
  return `${y} year${y === 1 ? "" : "s"} in the garage`;
}

type WorkOrder = { label: string; href: string; live?: boolean };

/**
 * What's next for this car — the sheet's open work orders, in the order a
 * workshop would take them: money waiting beats housekeeping, and the
 * build page's gaps come before a reminder to post. Stops at three so the
 * list is a plan, not a backlog. Empty when the sheet is in good order.
 */
export function workOrders(s: GarageSheet): WorkOrder[] {
  const out: WorkOrder[] = [];
  if (s.openOffers > 0)
    out.push({
      label: `${s.openOffers} open offer${s.openOffers === 1 ? "" : "s"} on parts off this car`,
      href: "/offers",
      live: true,
    });
  if (!s.cover_image_url)
    out.push({ label: "No cover photo yet", href: `/garage/${s.id}/edit` });
  if (s.mods === 0)
    out.push({ label: "Mod list is empty", href: `/garage/${s.id}/edit` });
  if (!s.is_public)
    out.push({ label: "Build page is private", href: `/garage/${s.id}/edit` });
  if (s.updates === 0)
    out.push({
      label: "No updates posted yet",
      href: `/garage/${s.id}/update/new`,
    });
  else if (s.latestUpdate && daysSince(s.latestUpdate.published_at) > 30)
    out.push({
      label: `Quiet for ${ago(s.latestUpdate.published_at).replace(" ago", "")} — post an update`,
      href: `/garage/${s.id}/update/new`,
    });
  if (s.partsLive === 0 && s.partsHeld === 0 && s.mods > 0)
    out.push({ label: "Nothing listed off it yet", href: `/sell?car=${s.id}` });
  return out.slice(0, 3);
}

export function GarageSheetCard({
  sheet,
  stagger,
}: {
  sheet: GarageSheet;
  stagger: number;
}) {
  const s = sheet;
  const meta = vehicleSubline(s.name, s);
  const orders = workOrders(s);
  const dims = [
    { label: "Updates", value: s.updates },
    { label: "Parts live", value: s.partsLive, live: s.openOffers > 0 },
    { label: "In checkout", value: s.partsHeld },
    { label: "Sold", value: s.partsSold },
    { label: "Followers", value: s.followers },
  ].filter((d) => d.value > 0);
  const sheetNo = String(s.index).padStart(2, "0");

  return (
    <Rv
      as="article"
      className="gsheet"
      stagger={stagger}
      aria-labelledby={`gsheet-${s.id}`}
    >
      {/* The plate: swipe through the car's photos in place (PlateSwiper);
          the plate itself still opens the build page. */}
      <PlateSwiper photos={s.photoUrls} href={`/cars/${s.slug}`} name={s.name} sheetNo={sheetNo} />

      <div className="gsheet__body">
        <header className="gsheet__head">
          <span className="microlabel">
            {tenure(s.created_at)}
            {!s.is_public && <span className="chip gsheet__flag">Private</span>}
          </span>
          <h2 id={`gsheet-${s.id}`} className="gsheet__name">
            <Link href={`/cars/${s.slug}`} className="gsheet__namelink">
              {s.name}
              <span className="gsheet__go" aria-hidden="true">
                →
              </span>
            </Link>
          </h2>
          <p className="gsheet__meta vref vref--lg">{meta || "No details yet"}</p>
        </header>

        {/* The measured half folds behind this digest — closed by default on
            phones, open on desktop, toggleable everywhere; the tool rail
            stays out when it's folded. */}
        <SheetDetails
          digest={[
            `${s.updates} update${s.updates === 1 ? "" : "s"}`,
            `${s.partsLive} live`,
            s.partsSold > 0 ? `${s.partsSold} sold` : null,
            orders.length ? `${orders.length} to do` : "in order",
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          {/* The measured car — only the dimensions it has. Zeroes were
              drawn as blank spines under a digest line that had just said
              the same numbers, so a new car showed four empty measures. */}
          {dims.length > 0 && (
            <div className="gsheet__dims">
              {dims.map((d) => (
                <LiveDim key={d.label} label={d.label} value={d.value} live={d.live} />
              ))}
            </div>
          )}

          <div className="gsheet__notes">
            {/* Latest — the last thing that happened to this car. */}
            <div className="gsheet__note">
              <span className="microlabel microlabel--ink">Latest</span>
              {s.latestUpdate ? (
                <Link
                  href={`/cars/${s.slug}/activity/${s.latestUpdate.id}`}
                  className="gsheet__latest"
                >
                  {s.latestUpdate.cover_url && (
                    <span className="gsheet__thumb" aria-hidden="true">
                      <Media
                        src={s.latestUpdate.cover_url}
                        alt=""
                        className="h-full w-full"
                        role="row"
                      />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="gsheet__latesttitle">
                      &ldquo;{s.latestUpdate.title}&rdquo;
                    </span>
                    <span className="gsheet__latestwhen">
                      {ago(s.latestUpdate.published_at)}
                    </span>
                  </span>
                </Link>
              ) : (
                <p className="gsheet__empty">
                  Nothing posted yet. The first update starts the log.
                </p>
              )}
            </div>

            {/* Next — open work orders, or the all-clear. */}
            <div className="gsheet__note">
              <span className="microlabel microlabel--ink">Next</span>
              {orders.length ? (
                <ul className="gsheet__orders">
                  {orders.map((o) => (
                    <li key={o.label}>
                      <Link
                        href={o.href}
                        className={`gsheet__order${o.live ? " gsheet__order--live" : ""}`}
                      >
                        {/* A derived state that links to its fix — not a
                            task to tick, so no checkbox. */}
                        {o.label}
                        <span className="gsheet__ordergo" aria-hidden="true">
                          →
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="gsheet__empty">
                  Sheet is in order. Nothing waiting on you.
                </p>
              )}
            </div>
          </div>
        </SheetDetails>

        <SheetActions carId={s.id} />
      </div>
    </Rv>
  );
}
