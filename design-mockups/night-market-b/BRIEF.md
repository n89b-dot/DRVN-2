# Night Market B

DRVN at about 75% First Light (night) and 25% DRVN. It covers the same eight pages, people, listings, prices and posts as Night Market (`../night-market/`), so the two can be compared side by side. It's dark only, with no Dawn toggle.

| Page | Shell | What it is |
|---|---|---|
| `index.html` | signed out | Landing, the front door |
| `explore.html` | signed out | Builds, updates, parts and builders in one feed |
| `marketplace.html` | signed out | Parts with vehicle fit, category, price, condition and pickup filters, plus sort |
| `listing.html` | signed out | The big brake kit; `?id=` opens any of the 14 |
| `home.html` | signed in | Marisol's feed, composer and rail |
| `garage.html` | signed in | Her garage: car switcher, then Overview / Mods / Parts / Media |
| `profile.html` | signed in | Her public page; the Parts tab is her store |
| `settings.html` | signed in | All eight sections, with working controls |

"Sign in" anywhere goes to Home and is remembered in localStorage (wrapped in try/catch, and applied before paint). "Log out" in the account menu or in Settings clears it.

## What is First Light (the 75%)
- **Night palette and depth.** The canvas is #0E131B, surfaces #151C26, ink #E6EAF0, moon-silver secondary text. Sections are separated by space and tone, not boxes. Apricot is the only accent, kept for primary actions, fit badges and the mark's sun.
- **The scroll-time device.** Every page runs 04:20 → 05:10 as you scroll. The palette moves from night to pre-dawn, the nav clock and its phase (night, moonlight, first glow) tick forward, and each section label stamps the time at which you reach it. Explore has First Light's big rail clock.
- **The hero.** The night film under First Light's raw-WebGL fog shader: moonlit fog, headlamp beams, a twinkling star field, fog that parts under the pointer, and a headline that condenses out of it. Reduced motion shows a still poster with one static fog frame.
- **Composition.** Editorial, asymmetric layouts with the serif headline at left, wide margins and long vertical rhythm:
  - car tiles beside "What do you drive?"
  - staggered seller cars
  - the Lucille cut-out against the shelf of parts off her
  - the garage hero, a 16:10 photo with the car's name set huge beside it
- **The card.** First Light's tall frame, photo first, with the facts below. Image-less parts are typographic plates whose light warms along the grid.
- **Photo treatment.** DRVN's real phone photos are dimmed and cooled with the night filter token plus a soft-light wash, so they sit in one world.
- **Fog-dissolve reveals,** a seeded star field, moon-silver mist and the grain.

## What is DRVN (the 25%)
- **Content.** Night Market's data, copied unchanged: Marisol Vega (@apexmarisol, Austin) with Lucille and Nimbus, the 11 real listings plus 3 image-less ones, the posts, sellers, avatars and prices.
- **Every buyer fact on every card:** price, shipping line, condition · location, seller, "Off my <car>".
- **Listing facts:**
  - price breakdown (item, shipping, protection, before-tax total)
  - condition grade with its definition, specs
  - compatibility check against your vehicle
  - public Q&A with posting
  - buyer protection: covered cases, a 30-day report window, 3 days for the seller to respond
  - dispatch within 3 working days
  - offer sheet, report sheet, protection sheet, lightbox, cart drawer grouped by seller
- **Settings:** DRVN's eight sections with its labels, the notification events table, payouts (10% on sale, paid two days after delivery), shipping carriers, shop and vacation mode, export and a guarded delete.

**Less on screen at once.** Night Market boxes each of these as its own card. Here they're grouped and disclosed progressively instead:
- the price breakdown is a disclosure under the price
- protection is one numbered list beside the description, and the full dispute steps live in a sheet
- garage Overview is three quiet columns of rows, not five panels

## Type decision
- **Instrument Serif** stays the voice for page headlines, hero lines, section titles, the car names in the garage, feed post titles and the big rail clock.
- **IBM Plex Sans** carries everything that's UI or data: listing titles, prices (tabular), shipping and meta lines, rows, buttons, tabs, filters, forms and settings. I picked it over Instrument Sans because it's the quiet nod to DRVN, and its tabular numerals read better in the price column.
- **IBM Plex Mono** is used only for labels at 11px (eyebrows, counts, time stamps).

## App-shell decision
**First Light's top nav with the avatar, not a sidebar.** The signed-in nav adds Home and Garage to the links, keeps search, the clock, Post and the cart, and the avatar opens an account menu: public profile, Garage, Selling, Messages (1), Agent, Settings, Log out. A sidebar would have made the signed-in pages DRVN's layout in First Light colours, which is the 80% version this is being compared against. Keeping one horizon-led nav means the editorial page compositions don't change between signed out and signed in.

## Responsive
At 920px and below, the nav collapses to a Menu sheet and the filters move behind a toggle. Splits stack. On the listing, a buy bar appears once the main actions scroll away. At 390px there's no horizontal scroll on any page, cards are two-up with every fact still shown, and the settings section nav becomes a swipe row.

## Known gap
The bare folder URL (`/night-market-b` without `index.html`) needs a redirect in `serve.json`, which this build isn't allowed to edit. `/night-market-b/index.html` works.
