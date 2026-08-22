import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { Foot } from "@/components/ui";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

import { AddCarForm } from "./add-car-form";
import { loadGarageSheets } from "./garage-data";
import { GarageSheetCard } from "./garage-sheet";

export const metadata = { title: "Garage - DRVN" };

/**
 * The garage is the owner's drawer of build sheets — one sheet per car,
 * each measured (updates, parts live, sold, earned, following) and each
 * carrying its open work orders. The page's job is "what's happening to
 * my cars and what do I do next", not "confirm I own a car".
 */
export default async function GaragePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const sheets = await loadGarageSheets(supabase, user!.id);

  // The garage's own tally — what the whole drawer has done.
  const totals = sheets.reduce(
    (t, s) => ({
      updates: t.updates + s.updates,
      live: t.live + s.partsLive,
      earned: t.earned + s.earnedCents,
      offers: t.offers + s.openOffers,
    }),
    { updates: 0, live: 0, earned: 0, offers: 0 }
  );
  const tally =
    sheets.length > 0
      ? [
          `${sheets.length} car${sheets.length === 1 ? "" : "s"}`,
          `${totals.updates} update${totals.updates === 1 ? "" : "s"}`,
          `${totals.live} part${totals.live === 1 ? "" : "s"} live`,
          totals.earned > 0 ? `${formatPrice(totals.earned)} earned off them` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead pagehead--task">
        <span className="microlabel">Garage{tally ? ` — ${tally}` : ""}</span>
        {/* Provenance stays a supporting fact (brand doc): the headline is
            the cars; the tally and the sheets carry what's happening. */}
        <h1>
          The cars you&apos;re <span className="live-word">building.</span>
        </h1>
        {sheets.length > 0 ? (
          <p className="sub">
            {totals.offers > 0
              ? `${totals.offers} offer${totals.offers === 1 ? "" : "s"} waiting on parts off your cars.`
              : "Each sheet shows what's happened to the car and what's next for it."}
          </p>
        ) : (
          <p className="sub">
            Add the car you&apos;re building. Photos, the mod list and every part you sell off it
            live on one build page.
          </p>
        )}
        {sheets.length > 0 && (
          <div className="mt-4">
            <AddCarForm quiet />
          </div>
        )}
      </Rv>

      <section className="gsheets">
        {sheets.length > 0 ? (
          sheets.map((sheet, i) => <GarageSheetCard key={sheet.id} sheet={sheet} stagger={i} />)
        ) : (
          <Rv className="undrawn undrawn--hero">
            <span className="undrawn__mark" aria-hidden="true">
              +
            </span>
            <h3>Your car goes here</h3>
            <p>
              Add the car you&apos;re building. Photos, the full mod list, and every part you sell
              off it all live on one build page.
            </p>
            <AddCarForm />
          </Rv>
        )}
      </section>

      <Foot
        left="DRVN — every part you list carries its car with it"
        right={<Link href="/home">← Home</Link>}
      />
    </div>
  );
}
