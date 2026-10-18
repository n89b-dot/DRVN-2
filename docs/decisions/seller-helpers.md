# Seller helpers: shot lists and "What came off"

Status: built 18 Oct 2026. Wording to review after the fact (Neil asked for the plan to be finished without stopping for sign-offs). Plan: `docs/plans/2026-10-agent-and-graph-plan.md`, "Alongside A3c–A3d — two seller helpers (no AI)".

## Photo shot lists

- **Where:** the sell form's Photos step (step 1), under the drop zone. Each list has a small label: "Good first shots" before a part type is chosen, then "Shots buyers look for".
- **What:**
  - 3–5 short shots for each of the 30 marketplace subcategories, listed in full in `src/lib/marketplace/photo-guide.ts`.
  - A generic list until the part type is known: the whole part · labels and part numbers · any damage, close up.
- **Finer splits from the title,** only where one subcategory hides very different parts:
  - coilovers vs springs (Coilovers & Springs);
  - sway bars vs arms (Sway Bars & Arms);
  - clutch, diff and driveshaft (Drivetrain & Clutch);
  - harnesses (Seats & Harnesses).
- **Never required:** one photo still publishes (M-5, W-2). It isn't proof of condition and isn't checked.

## What came off

- **When:** under a new build-sheet line, once it has a name. It asks once per line. It doesn't ask again after you answer, dismiss or save. A line made by Replace never asks, because what came off there is the part it replaced.
- **The question:** "Did stock parts come off?" Tick boxes list at most three stock parts. Then **Add to Came off**, or **Nothing came off**.
- **If the name says nothing:** "Did it replace stock parts? What is it?" A pick list follows: Coilovers · Springs · Exhaust · Intake · Wheels · Big brake kit · Seats.
- **What a tick creates:**
  - a removed line, marked stock (`mod_items.origin = 'stock'`), named for example "Stock springs ×4";
  - the car maker as its brand;
  - the same group as the mod, and the mod type's build-sheet category.
- **What it offers:**
  - Stock parts already on the sheet aren't offered twice.
  - In Came off this car, the line reads "Stock · Off since …" and has List it.
  - Listing it pre-fills the title, brand, category and the source car's fitment.
- **Left out on purpose:**
  - steering wheels, because the stock wheel carries the airbag, which shouldn't be listed;
  - tunes, because they're software and nothing comes off;
  - bolt-on aero, which goes where nothing was.

## To review

1. The shot wording in `photo-guide.ts`.
2. The mod-type keywords and stock-part lists in `src/lib/mods/stock-parts.ts`, especially the counts. For example, "Stock shocks ×4" assumes four corners.
3. Whether "Stock" should also show on the public build sheet. It currently shows only in the editor.
