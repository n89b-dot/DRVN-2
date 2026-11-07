import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { Foot } from "@/components/ui";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { getPageClient as createClient, getViewer } from "@/lib/supabase/page-context";
import { requiredRead } from "@/lib/supabase/required-read";

import { AddCarForm } from "./add-car-form";
import { loadGarageCars, measureGarageSheets } from "./garage-data";
import { GarageSheetCard } from "./garage-sheet";
import { GarageSwitcher } from "./garage-switcher";
import { FocusedCar } from "./focused-car";
import { GarageCarOverview, GarageCarParts } from "./focused-panels";
import { GalleryManager } from "./[id]/edit/gallery-manager";
import { ModsEditor } from "./[id]/edit/mods-editor";

export const metadata = { title: "Garage - DRVN" };

/**
 * The garage is the owner's drawer of build sheets — one sheet per car,
 * each measured (updates, parts live, sold, earned, following) and each
 * carrying its open work orders. The page's job is "what's happening to
 * my cars and what do I do next", not "confirm I own a car".
 */
export default async function GaragePage({
  searchParams,
}: {
  searchParams: Promise<{ car?: string; view?: string; add?: string }>;
}) {
  const { car: carParam, view } = await searchParams;
  const supabase = await createClient();
  const user = await getViewer();

  const cars = await loadGarageCars(supabase, user!.id);
  // G-1: `?car=` focuses one car; without it the garage is the list it has
  // always been. An unknown id falls back to the list rather than a 404 —
  // a stale link from a deleted car should land somewhere useful.
  // The garage opens on the main car (cars arrive main-first). "All cars"
  // is `?car=all` — a destination you choose, not the default.
  const focusedId = carParam === "all" ? undefined : (cars.find((c) => c.id === carParam) ?? cars[0])?.id;

  // G-3: the focused car's mods and photos are edited here, in place — the
  // same editors the full car page mounts, given the same rows. Loaded only
  // when a car is focused (the list view needs none of it), and beside the
  // sheets' measuring rather than after it.
  const [sheets, [focusedCarResult, focusedImagesResult, focusedModsResult]] = await Promise.all([
    measureGarageSheets(supabase, cars),
    focusedId
      ? Promise.all([
          supabase
            .from("cars")
            .select("id, cover_image_url, cover_focal_x, cover_focal_y")
            .eq("id", focusedId)
            .eq("owner_id", user!.id)
            .maybeSingle(),
          supabase.from("car_images").select("*").eq("car_id", focusedId).order("position"),
          supabase
            .from("mod_items")
            .select("*, linked_listing:listings!mod_items_linked_listing_id_fkey(status)")
            .eq("car_id", focusedId)
            .order("position"),
        ])
      : Promise.resolve([
          { data: null, error: null },
          { data: null, error: null },
          { data: null, error: null },
        ] as const),
  ]);
  // RR-11: the editors below are mounted with these rows, and the mod
  // editor's save replaces the car's whole list. A failed read must never
  // reach them as an empty list.
  const focusedCar = requiredRead(focusedCarResult, "this car");
  const focusedImages = requiredRead(focusedImagesResult, "this car's photos");
  const focusedMods = requiredRead(focusedModsResult, "this car's mod list");
  const focused = focusedId ? sheets.find((s) => s.id === focusedId) : undefined;

  // The garage's own tally — what the whole drawer has done.
  const totals = sheets.reduce(
    (t, s) => ({
      updates: t.updates + s.updates,
      live: t.live + s.partsLive,
      sales: t.sales + s.salesCents,
      offers: t.offers + s.openOffers,
    }),
    { updates: 0, live: 0, sales: 0, offers: 0 }
  );
  const tally =
    sheets.length > 0
      ? [
          `${sheets.length} car${sheets.length === 1 ? "" : "s"}`,
          `${totals.updates} update${totals.updates === 1 ? "" : "s"}`,
          `${totals.live} live`,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead pagehead--task garagehead">
        <div className="pagehead__row">
          <div>
            <span className="microlabel">
              {/* On a phone the tally alone fits one line; "Garage" is the
                  page's name in the nav already. */}
              <span className="max-sm:hidden">Garage{tally ? " — " : ""}</span>
              {tally}
              {totals.sales > 0 && (
                <span className="max-sm:hidden"> · {formatPrice(totals.sales)} in sales off them</span>
              )}
            </span>
            {/* Provenance stays a supporting fact (brand doc): the headline is
                the cars; the tally and the sheets carry what's happening. */}
            <h1>
              The cars you&apos;re <span className="live-word">building.</span>
            </h1>
          </div>
          {/* G-1: Add vehicle exists once — here, where it is visible on a
              phone, rather than as the last chip of a strip that scrolls it
              off-screen. */}
          {sheets.length > 0 && (
            <span id="add-car" className="scroll-mt-24">
              <AddCarForm quiet />
            </span>
          )}
        </div>
        {sheets.length > 0 ? (
          totals.offers > 0 && (
            <p className="sub">
              {`${totals.offers} offer${totals.offers === 1 ? "" : "s"} waiting on parts off your cars.`}
            </p>
          )
        ) : (
          <p className="sub">
            Add the car you&apos;re building. Photos, the mod list and every part you sell off it
            live on one build page.
          </p>
        )}
      </Rv>

      <GarageSwitcher sheets={sheets} currentCarId={focused?.id} />

      {focused ? (
        <FocusedCar
          sheet={focused}
          initialTab={view}
          panels={{
            overview: <GarageCarOverview sheet={focused} mods={focusedMods ?? []} />,
            mods: (
              <div className="mt-6">
                <ModsEditor carId={focused.id} carMake={focused.make} initialMods={focusedMods ?? []} />
              </div>
            ),
            parts: <GarageCarParts sheet={focused} />,
            media: (
              <div className="mt-6 grid gap-4">
                <GalleryManager
                  carId={focused.id}
                  userId={user!.id}
                  images={focusedImages ?? []}
                  coverImageUrl={focusedCar?.cover_image_url ?? null}
                  coverFocal={{
                    x: focusedCar?.cover_focal_x ?? null,
                    y: focusedCar?.cover_focal_y ?? null,
                  }}
                />
                {/* Details, the showcase and deleting the car stay on the
                    full page (G-5 keeps it) — they are occasional, and this
                    view is for what changes week to week. */}
                <Link href={`/garage/${focused.id}/edit`} className="jumplink justify-self-start">
                  Car details, showcase and more →
                </Link>
              </div>
            ),
          }}
        />
      ) : (
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
      )}

      <Foot
        left="DRVN — link a car to a part and buyers see where it came off"
        right={<Link href="/home">← Home</Link>}
      />
    </div>
  );
}
