# Vehicle identity & fitment

> The vehicle catalog, the Add Car flows, and how fitment stays lightweight.
> Code: `src/lib/vehicles/`, `supabase/migrations/0041`, `0025`, `20261020100000` (generations).

## The canonical model

`catalog_makes` / `catalog_models` (0041) are DRVN-owned identity: DRVN
primary keys, with *references* to the sources that populated them. External
ids are never primary keys, so a new source is a column, not a migration of
everything.

Cars carry both:

- **References** — `cars.catalog_make_id` / `catalog_model_id` /
  `identity_source` (`picker` | `vin` | `manual`).
- **Display snapshots** — `cars.make/model/year` stay frozen strings, so an
  upstream catalog rename can never rewrite what a build page has always said.

Cars that predate the catalog, or were typed by hand, were given references
by `20260928181000`: make by case-insensitive exact name; model by exact
name, else the longest catalog model the car's model starts with ("M4
Competition" → M4). No model match leaves the car make-only. Only cars with
no make reference were touched, so an id a member picked is never
overridden. Marketplace's "Parts for my …" and the vehicle picker need these
references; with no main car set, the shortcut offers the newest car.

## Generations (B1)

One level below the model, and no further: `vehicle_generations`
(`20261020100000`) holds each generation of a catalog model — what
enthusiasts call it (`Mk8`, `E46`, `R34`, `ND`), the maker's platform code
(`CD`, `992`), and the years it covers. No trims, engines or variants; a
fitment that needs them says so with configuration constraints on the
product fitment instead.

- **Resolved, never guessed.** `cars.generation_id` comes from
  `catalog_model_id` + `year`: exactly one generation of the model covering
  the year, or nothing (`resolve_vehicle_generation`). A car without a year
  resolves only when its model has a single generation.
- **Changeover years are asked, not guessed.** Year ranges are the union of
  production years and main-market model years, so a 2020 Golf R covers both
  the Mk7 and the Mk8 and resolves to nothing. That is where the owner is
  asked (UI not built yet; the column takes their answer today).
- **The owner's choice stands** while it still fits the car's model and year
  (`generation_source = 'owner'`); change the year past it and the car
  resolves again. A client can't claim a choice by writing
  `generation_source` — the trigger decides.
- **The catalog moves, cars follow.** Adding, widening or removing a
  generation re-resolves that model's cars (owners' choices that still fit
  are kept). Nothing in vehicle fit or search watches these columns.
- **Curated seed.** No open source carries generations (VehiclesDB stops at
  the model), so the migration seeds ~200 enthusiast generations by hand,
  joined to the catalog by make and model name. A model the catalog doesn't
  hold is skipped; re-running the migration after a catalog import fills it
  in. Corrections are data changes, not code.

## Data sources

| Source | Role | License |
| --- | --- | --- |
| NHTSA vPIC (`src/lib/vehicles/vpic.ts`) | VIN decoding; US make/model cache (`vehicle_makes`/`vehicle_models`, feeding the sell fitment datalists) | US public data, keyless API |
| [VehiclesDB](https://vehiclesdb.com) (`scripts/import-vehiclesdb.mjs`) | Global make/model breadth (277 car makes / ~4,900 models from 14 countries' registers), aliases ("Rabbit" ↔ Golf), popularity deciles | CC-BY 4.0 — **attribution required**: "Vehicle data by VehiclesDB" with a link, shown in the Add Car dialog foot and here |

Make ranking is model-weighted (how many broadly popular models a make has) —
computed at import; "best single model decile" made one-hit small-market
marques outrank Volkswagen.

Refresh: re-run the import script (pure upserts, safe anytime). The catalog
APIs (`/api/vehicles/catalog/makes`, `/catalog/models?make=`) are public,
ranked, and cached for an hour.

## Add Car (brief §E)

1. **Picker (primary)** — year → searchable make → searchable model
   (`ComboField`, aliases matched as keywords). The car lands as a recognized
   vehicle.
2. **VIN (secondary)** — `Enter VIN instead`. One vPIC decode prefills
   identity plus trim/engine/drivetrain. The VIN stays private; wording is
   always **"VIN decoded"**, never "verified". When vPIC itself is down
   (`decodeVinResult` → `unavailable`), the dialog says lookup is unavailable
   and points at the list — a correct VIN is never called wrong because the
   service didn't answer.
3. **Manual (always)** — `Can't find your vehicle? Enter it manually.` Kit
   cars, imports, gray-market and one-offs are first-class. Manual words that
   happen to name a catalog vehicle quietly gain the reference. A blank
   manual form asks for at least a make or a name rather than creating
   "My car".

A personal name is optional everywhere — unnamed, the car is called what it
is ("2024 Volkswagen Golf").

## Fitment (brief §G)

Structured claims live in `listing_fitments` (make, model, optional year
range) — **seller-stated, never platform-verified**, and the UI always says
so. The default seller experience stays lightweight:

- A part released off a build (`?car=` links) starts with its fitment row
  inferred from the source car.
- Choosing a source car in the sell form offers a one-tap `+ Fits {car}` chip
  — passive, never applied without the tap.
- "Fits my garage" matches exact case-insensitive make+model, erring open on
  missing years (`src/lib/marketplace/fitment.ts`).

Deliberately **not** built: manual trim/engine/drivetrain qualifier entry
(bloats the form for data the catalog/VIN can eventually auto-fill) and any
user-facing fitment-confidence percentage.
