# Night Market

DRVN in First Light's night palette, carrying everything the live app shows. It's static and dark only, with eight pages:

| Page | Shell | What it is |
|---|---|---|
| `index.html` | signed out | Landing, the front door: First Light's night film and story, DRVN's message |
| `explore.html` | signed out* | Builds, updates, parts and builders feed |
| `marketplace.html` | signed out* | Parts marketplace (was `index.html`) |
| `listing.html` | signed out* | One part. `?id=` opens any of the 14; no id opens the big brake kit |
| `home.html` | signed in | Marisol's feed |
| `garage.html` | signed in | Marisol's own garage, Nimbus and Lucille |
| `profile.html` | signed in | Her public profile and store (the Parts tab) |
| `settings.html` | signed in | All eight sections |

\* "Sign in" anywhere goes to Home and sets a signed-in flag in localStorage, wrapped in try/catch. After that, the public pages show the member shell too. "Log out" in Settings clears it.

## From First Light (night)
- The canvas and surfaces: `#0E131B` canvas, `#151C26`/`#1A2330` surfaces. Sections are separated by space and tone. The only hairlines are in rows, specs and the cart.
- The spacing, the photo-first cards with the text below, and the typographic plate for image-less parts.
- The soft glowing fit panel, quiet label/value rows, the seller row and the "came off" car card.
- Apricot is the only accent, used for primary actions, and the wordmark's full stop now ends each page title too ("Settings.", "See what everyone's building."). Secondary text is moon-silver.
- A faint star field behind the head of every page.

## From DRVN
- IBM Plex Sans for everything. Plex Mono only for labels and data at 12px or smaller. Prices are tabular.
- DRVN's two shells:
  - **Signed out:** a top header.
  - **Signed in:** a left sidebar (Home, Explore, Marketplace, Garage, Agent, Selling, Messages with its unread count, Profile, Settings, List a part, and the member chip). There is also a slim top bar with search, Post, cart, notifications and saved.
  - **Below 1024px:** DRVN's mobile bottom bar (Explore · Marketplace · Home · Garage · Agent) plus a menu drawer.
- Every field from the live landing, explore, home, garage, profile and settings captures, with DRVN's copy. Settings labels and the notification events come from `src/app/(product)/settings` and `src/lib/notification-prefs.ts`.

## How density was handled

### Marketplace and listing (unchanged from round one)
1. **The card has tone tiers instead of dividers:** title and price, then shipping, then brand · condition · location, then the "Off my <car>" byline.
2. **Save and Add to cart sit on the photo.** They appear on hover or focus, are always visible on touch, and stay visible once used.
3. **Fit status appears only once you choose a vehicle.** The listing splits into decide (right) and inspect (left).

### Landing, round two
Round one restyled DRVN's section stack. Neil preferred First Light's landing, so this version is First Light's story structure carrying DRVN's message and facts.

- **From First Light:**
  - The full-bleed night film with the fog shader. Both are ported into `night-market.js`: two copies of `img/hero-night.mp4` crossfade at the loop point, and the shader draws moon-rim fog, headlamp beams and sparse stars. The pointer clears the fog, and the fog thins as you scroll. The film pauses offscreen. With reduced motion the poster and a still fog frame show; without WebGL a CSS haze replaces the fog.
  - The headline emerging from the fog.
  - The sentence picker, "I drive a [M3 (E46) ▾]".
  - The asymmetric photo-and-text compositions, with photos bleeding off the page edge.
  - The offset community stories.
  - The "We hold the money. You open the box." statement, with four moments (First / Then / When it lands / Two days after delivery).
  - The emotional sell close, "What comes off the car shouldn't sit in the garage."
- **From DRVN:**
  - The message: the eyebrow, the H1 "The parts marketplace for modified cars.", the subline, and Shop parts for my car / Sell my parts.
  - The live listing strip along the hero's bottom edge: four real listings, each "Off a <car>".
  - "Listed tonight", using the marketplace card.
  - The selling and buying steps as two numbered sequences beside the RX-7 flat-lay, including "Free to list, 10% when it sells" and "Get paid two days after it's delivered".
  - "Every part comes with its car". Each story pairs a real post, its owner and car, and the part that came off it: Lucille's dyno day with the brake kit, Kaito's S15 before/after slider, and Felix's GT3 with its seats and wheels.
  - All the trust facts: payments by Stripe, seller paid two days after delivery, the 30-day problem window, condition recorded at sale, no account needed to buy, and a buyer protection link.
  - "What's on the shelf in your garage?" with the three sold take-offs.
- **Density:**
  - The picker's button states the answer ("Show 3 parts for the M3 (E46)"), and the photo swaps to match the chosen car.
  - The six car tiles became one line of cars with counts.
  - DRVN's four trust tiles plus a strip became one statement with four moments, with the facts as a single mono line.
  - The take-offs ledger moved into the sell close, where it supports the argument.

### Explore
- **One card anatomy for three kinds of thing.** Builds, updates and for-sale parts are the marketplace card with a glass type badge ("Build", "Update", "For sale"). Builds and updates add a foot row for likes, comments and time. Price, grade and car are never dropped.
- **Before/after updates share one frame with a draggable divider** (a real range input, keyboard operable) instead of taking two photos' worth of space.
- **Interjections are full-width bands, and only in the unfiltered "All" view.** Once you filter, you get exactly what you asked for.
- The type tabs, search, make/sort filters, Load more, likes and follows all really work.

### Home
- **One column of large posts, with the rail doing the summarising.** The rail is your garage (update and follower counts in mono), parts people are watching (price right-aligned), and builders to follow.
- **The composer stays compact until you use it.** Photo thumbnails and the tag-a-part picker appear only when needed. "Every post needs a photo" is enforced, not just hinted.
- **Following and For you are real.** Following starts empty (Marisol follows no one), and following someone in the rail or on Explore fills it immediately.

### Garage
- **The car is the page.** The switcher (All cars / Nimbus / Lucille) changes the hero. The hero holds the year/model label, the name, one stats line (updates · followers · parts for sale) and the three actions.
- **Tabs split the depth: Overview, Mods, Parts, Media.** Overview shows a capped preview of each (recent updates, mods, parts or the "Nothing listed off this car · List a part" empty state, two photos), and each preview's "View all" opens its tab.
- **The public view is a separate `profile.html`, linked from the garage.** That keeps "my workshop" and "what buyers see" distinct. The garage has a "Your public page" panel explaining the link.

### Profile
- **The header carries identity and stats; the tabs carry the rest.** Stats are three numbers with mono labels. The Overview tab holds the featured build, the about paragraph and the latest three updates. The right rail repeats the garage and the store as compact rows, so a buyer never has to open a tab to see what's for sale.
- **Store opens the Parts tab:** the PRD's "a member's store is the Parts tab on their profile".

### Settings
- **One section at a time, numbered 01–08,** like DRVN, so a long settings page never becomes a wall of fields.
- **Inside a section, groups sit on hairlines.**
  - Notifications is a table, events by channel (in-app / email). That turns 18 toggles into one scannable grid.
  - Payments separates "how you pay" (Visa ending 4242, test mode) from "how you're paid" (Stripe Connect, paid two days after delivery, free to list and 10% when it sells, and the balance).
- **Saving is explicit.** A dirty-state bar appears only when something differs from what's saved, with Discard and Save, and saved values persist. Email and password have their own buttons, because they need confirmation.
- **The danger zone is the only place error-red appears.** Deleting is a built-in confirmation step: type the username and tick the box, then the button enables, then Undo.

## Data and photos
- Members, cars and posts come from DRVN's seed and live captures: Anjali, Felix, Imani, Dario, Marisol, Viz Check, Dana, Kaito, Ryo, Lena, Jade, Marcus and Tommy.
- Car names, models, post titles and excerpts are as in DRVN. Captions were written after looking at each photo.
- `img/cars/unknown-a.jpg` is a blue Mk8 Golf R, used for the Golf R tile. `unknown-b.jpg` is a white saloon with a rally number. DRVN labels it an Evo IX, but it doesn't clearly look like one, so it isn't used.
- `img/car-lucille.webp` is a cut-out of the studio E46 M3 from `assets/c19-src-e46.jpg`, used on the listing's "came off" card.

## Dropped, and why
- **First Light's Instrument Serif and Sans, the scroll-is-time device and the Dawn/Night toggle:** Neil ruled on the fonts, and the page is dark only.
- **DRVN's red accent, square bracket buttons, grid-paper background and the "Test mode" Stripe banner:** apricot and tone do that job here. "Test mode" survives as a pill on the saved card in Settings.
- **Pages outside the mockup** (agent, selling, messages, checkout, sell flow, other members' build pages) answer with a short toast instead of a dead link.
