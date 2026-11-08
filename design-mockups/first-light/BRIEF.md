# 18 · First Light

**Family:** emotion. **Thesis:** "Scroll is sunrise." Every page is set in the hour before a drive. A single scroll-driven `--t` (0→1) maps 05:12 to 06:40. The palette mixes from cold mist tokens to warm apricot ones in oklab, the nav clock and its phase label tick forward (blue hour, first light, sunrise, morning), the mark's small sun rises over its horizon line, ambient mist thins, and a low sun glow climbs the viewport. Section labels print the time at which they reach the reading line. The car stays a supporting detail ("Off Theo’s 1991 964"); the parts lead.

**Precedents:** Aesop and Kinfolk editorial pacing, long rhythm with few boxes (web) · Petrolicious films and their pre-dawn colour (web) · Porsche Newsroom photography, where the car sits low in the frame with sky above (web) · Lusion and Igloo Inc atmospheric WebGL, where light is the subject rather than the geometry (web).

**Showpiece:** index hero. The `c18-motion-dawn.mp4` film runs under a raw-WebGL fog in three passes. (1) Domain-warped, horizontally stretched fbm drifts right to left at quarter resolution, with a near layer that moves faster than the far one. (2) A ping-pong breath trail decays where the pointer has been and pushes the fog aside along its gradient. (3) A light pass gives silver-lined edges facing the sun, forward scattering, and 12-tap light shafts marched toward the sun on the ridge, mapped through object-fit. Density falls on load and again with scroll as the sun burns it off. The film brightens, and the headline condenses word by word from blur to sharp as the density drops. DPR is capped at 1.5 and the pass runs at ×0.75. Rendering pauses offscreen (IntersectionObserver) and when the tab is hidden. With no WebGL the film or poster shows under a CSS haze. With reduced motion you get the poster plus one static fog frame and the palette held at 06:10.

**Motion:** `c18-motion-dawn.mp4` is used in the index hero, as two stacked video elements crossfading over 1.4 s at the loop point because the clip isn't seamless. Elsewhere, reveals are fog dissolves (blur and opacity to sharp, 900 ms, ease-out-quint). Market listings resolve out of a canvas-coloured mist veil, and gallery swaps mist out and back in.

**Responsive (390px):** at 920px and below, the nav collapses to a Menu sheet holding the links and search; the clock and bag stay visible. Grids go 4→3→2 columns. The hero top-aligns its copy with the film framed at 28% so the car stays in shot. Split sections stack with photos full-bleed. Market filters sit behind a Filters toggle. The drawer goes full width, and add-to-bag becomes a compact "+".

**Deviations logged:** raw WebGL instead of Three.js (less weight, full control of the three passes). I added a fifth page, `sell.html`, because the nav's Sell link needed a real flow (live payout maths, publish state). Reduced motion holds mid-morning at t = .65 and still draws one static fog frame rather than none.

**Flaw hunt (found → fixed):**
- The headline wrapped to three lines and its CTAs sat on the car. Fixed with wider measure, smaller display size and top-aligned copy.
- The first fog pass curled like rising smoke. Fixed with anisotropic sheets, gentler warp and a valley density band.
- At mid-scroll the hero CTAs slid under the transparent nav. The copy now lifts and dissolves with the burn.
- The bench photo appeared twice in a row. Photos reassigned: the covered car beside "What do you drive?", the bench beside "What comes off the car".
- On the sell page, text-field styles hijacked the checkboxes.
- On mobile, add-to-bag covered the typographic titles.
- Fast flings skipped IntersectionObserver frames and left sections blurred. A scroll-settle fallback now catches them.
- Tall viewports overflowed max texture size. The hero height and the canvas are now clamped.
- "1 part that fit" now reads "1 part that fits".
- I dropped the grain blend mode and quantized `--t` writes to cut repaint cost.

**Style-emulation prompt:** Design a calm, atmospheric commerce site set in the hour before sunrise. The page colours are two token sets, dawn mist (#DCE2E6 canvas, #1E2630 ink) and warm sun (#F3EEE6, #231D18), mixed in oklab by a scroll-position variable, so the page warms from blue hour to apricot morning as you read. The one accent is apricot #E8955A, used only for primary actions, the sun and small marks, never as body text. Pair Instrument Serif at display sizes (tall, airy, italic for the emotional half of a line) with Instrument Sans for UI. Use tracked uppercase only for labels of 12px or less, with tabular figures. Compose around horizons: wide margins, slow vertical rhythm, photographs full-bleed or in tall 3:4 and 4:5 frames, and separation by space and light rather than borders or shadows. Motion is unhurried, 600–900 ms ease-out-quint: things resolve out of fog through blur and opacity, and nothing bounces. Copy is spare, specific and enthusiast-literate, with early-morning timestamps. No cartoon suns, no colour-blocking, no hard outlines.

## Pass 2 · Explore, Home, Garage (Oct 25)

**What's new.**
- **explore.html (Explore):** the signed-out front door to the community. It's one feed in the order things happened this morning (05:14 → 06:38), so the device carries straight into the feed. Posts run forward in time as the page warms, and a large serif clock in the left rail keeps pace. Build updates come in two layouts: portrait photos sit beside the words, landscape photos sit above them. Listed parts appear as soft-lit feed cards that link to part.html. "People to follow" and "Trending this week" sit between posts. Filters (All · Builds · Parts · Near me) work on the data and update a live count. A Saturday 5:30 club meet card with an RSVP toggle sits in the right rail.
- **home.html (Home):** Theo, signed in. A greeting names this morning's two jobs and links to them. The quick-post box needs a photo (pick one from this morning or upload), the car or part it's about, and some words. Posting adds the update to the top of Following, stamped with the current scroll-clock time. Following · For you · Local are real ARIA tabs with keyboard support. The side column holds his store this morning (three figures, an offer to accept or counter, an order to mark shipped), his garage (three cars, compact), and parts for his cars.
- **garage.html (Garage):** now Theo's profile. The convoy banner dissolves into the page, followed by his identity, the 5:30 club, stats and a Follow button. Cars and Parts are real tabs. The 964 is featured; the daily Golf R and the project MX-5 are offset cards, each with update, parts-fitted and for-sale counts, plus a short parts list.
- **car.html:** the former single-car 964 page, unchanged in behaviour. Every link that means "the 964" now points here; links that mean "Theo" or "his store" go to garage.html (#p-parts).

**Nav** across the site is now Explore · Marketplace · Garage · Sell, plus search, the clock, the bag and Theo's avatar, which links to home.html. index.html stays signed out and shows "Sign in" instead; at phone width that moves into the menu. The data gained a Golf R (Mk7) fitment, Theo's IS20 turbo (marked "Off Theo's 2015 Golf R" through a per-listing override), two Mk7 parts, and a sold pair of lid struts behind Home's order to ship. Follow state is per person and shared between garage.html and car.html. New styles live in the commented "Pass 2" section of first-light.css.

**Flaw hunt, Pass 2 (found → fixed):**
- Every Theo listing said it came off the 964, including the Golf's turbo. Fixed with a per-listing override.
- One shared follow flag would have followed Theo whenever you followed anyone. Follow state is now stored per person.
- The profile label sat on the busiest part of the convoy banner. Shorter overlap, longer fade.
- At phone width, "Sign in" pushed the nav past 390px. It now lives in the menu.
- Home's order to ship referenced a part that was still for sale. It now uses a sold listing.

## Pass 3 · Night (Oct 25)

**Thesis kept, not inverted.** Dawn mode is 05:12 → 06:40. Night mode is the hour before it, the 4 a.m. start: as you scroll, the page moves from deep night (04:20, stars, moonlit fog) to pre-dawn (05:10, a faint cold glow on the ridge). The nav clock and its phase follow: night → moonlight → first glow. Section time-stamps, the Explore rail clock and post times all switch with it. The palette is moonlight silver over deep ink-blue, with no sodium orange and no neon, so it stays clear of After Hours. Apricot stays the only accent, now rarer: the primary action, the mark's rising disc, and a faint glow on the horizon.

**Tokens.** The two dawn/sun sets now feed a theme layer (`--lo-*` / `--hi-*`). Night swaps those pointers to a night set (canvas #0E131B, surface #151C26, ink #E6EAF0, ink-2 #9AA6B4, hair #253040) and a pre-dawn set (#18202B / #202A36 / #EEF0F2 / #A9B3BF / #303C4C). Every raw hex still lives in `:root`; the dark blocks only remap with `var()`. Large apricot areas use a dusk variant (#4E3C32); accent text uses #F2B98F. Contrast: ink-2 on canvas is 7.5:1 at night and 7.7:1 at pre-dawn, and accent text is 9.5:1 or better. Photos go through a `--photo-dim` filter token and a cooler soft-light wash, so light images lose their glare.

**Switching.** The page follows `prefers-color-scheme: dark` unless `<html data-theme>` says otherwise; the attribute wins in both directions (`:root:not([data-theme="light"])` inside the media query, plus `:root[data-theme="dark"]`). A MutationObserver means a theme set by the artifact viewer takes effect live. The Dawn / Night switch in the nav (in the menu at phone width) is a real button with aria-pressed and a remembered choice (localStorage, wrapped in try/catch). An inline pre-paint script sets the attribute before the body exists, so there's no flash. A switch triggers an 800 ms crossfade, which reduced motion skips.

**Hero at night.** **Motion:** `c18-motion-night.mp4` is the night hero film (poster `c18-hero-night.jpg`). Like the dawn film it isn't seamless, so it runs as two stacked videos crossfading over 1.4 s at the loop point. Switching theme crossfades the dawn and night media sets live, and only the active film plays (the other pauses; both are preload="none"). The fog shader keeps its passes and retunes for night:
- moonlit silver fog, rim-lit toward the moon in the still
- two soft headlamp beams pushed through the fog from the 964's lamps along the road
- a sparse twinkling star field in the clear sky that fades as you scroll, while a cold first glow rises on the right ridge
- the pointer still parts the fog

On a live switch the light source fades out at the sun and back in at the moon rather than sliding across the sky. Elsewhere at night, a seeded star field (an SVG mask over a `--star` token) sits behind every page and fades toward pre-dawn, the mist turns moon-silver, and wherever the 964 appears in the dawn hero photo it swaps to the night still.

**Flaw hunt, Pass 3 (found → fixed):**
- The pre-paint script never matched because storage holds JSON (`"dark"` with quotes). It now strips quotes; verified by reloading with the JS held back for 3 s.
- Under a slow renderer, the theme-fade class came off before the fade had properly started. It now stays on for 1.4 s.
- The first CSS star field repeated on a visible grid. Replaced with a 1600×1100 seeded SVG mask.
- Mid-switch, the light slid across the sky and left a halo on the ridge. It now fades out and back in at the midpoint.
- Apricot hover on the primary button lost contrast at night. Hover now mixes toward a fixed light apricot.
- Avatar initials were light text on a light apricot gradient. Large apricot areas now use the dusk variant.
