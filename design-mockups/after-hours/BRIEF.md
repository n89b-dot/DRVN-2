# Concept 03 — AFTER HOURS

**Thesis:** *"Buy the part. Keep the night."* The marketplace as cinema — the feeling of a 1am parking-garage meet, sodium light and haze, rendered as scroll-driven film. Every page is a scene; parts are props with a past.

## Pages
`index.html` (letterboxed landing) → `meet.html` (TONIGHT'S LOT feed) → `car.html` (MIDNIGHT ROTOR build file) → `listing.html` (RE-Amemiya titanium exhaust). Fully cross-linked; the Buy button opens an in-page confirm overlay with a purchased state.

## Reference lineage
Wong Kar-wai / *Collateral*-era night cinematography (sodium-vapor orange against teal); Wangan and kanjo street culture; film-slate metadata and end-credit typography; Fontshare-era display type at full-viewport scale (Clash Display); scroll-driven storytelling in the lineage of Apple product films and Awwwards SOTD longform sites; Japanese signage as texture (深夜 — "late night").

## Why it serves DRVN's trust-and-context mission
The four trust answers are staged as a **film-credits block** on the listing — SOURCE CAR / SELLER / FITMENT / RAN WITH — so provenance reads as the part's screen credits. Fitment is explicitly "seller notes — verify for your chassis," never platform-asserted. Emotion does the acquisition work: the car page sells the *story* of the build, and "released from this build" ties every part back to the night it lived through — context as feeling, backed by the same four questions.

## Visual language
Deep night `#0A0D13` with teal-black shadow gradients, warm white `#F5EFE6`, cool dim `#8A93A6`, and one hot accent — sodium orange `#FF7A1F` — used as light, not paint: radial blooms, text-shadow glow, blurred auras. Clash Display at cinematic scale with mixed weights and outline strokes inside a single headline; Satoshi body. Letterbox bars open on load; a haze layer drifts continuously; scroll drives parallax type, scaling/brightening scenes, and timestamps/slates in the corners of every "cut."

## Iteration pass log
- **Pass 1 — flaws:** The fixed nav collided with the hero scene's top film-slate labels on all subpages (clock overlapping "LISTED 01:52 AM", logo overlapping the breadcrumb slate). Fixed — hero slates now drop below the nav whenever it is visible, with a cinematic ease.
- **Pass 2 — elevation:** Hero sub-copy sat directly on the brightest part of the car imagery and lost contrast. Added a feathered radial scrim behind scene copy that reads as pooled darkness/haze rather than a UI panel — legibility now holds while deepening the cinematography.
- **Pass 3 — coherence:** Audited all four pages: scene numbering, slates, timestamps, katakana accents, and the credits-block trust framing hold from landing through purchase overlay (even the buy CTA stays in voice: "Buy it before sunrise"). No off-voice elements; no change.

## Style-emulation prompt (portable)
> Design this product as a film shot at 1am. Deep night base (#0A0D13) graded with teal-black shadows (#0E1720), warm off-white text (#F5EFE6), cool dim secondary (#8A93A6), and exactly one hot accent — sodium-vapor orange (#FF7A1F) — treated as light rather than paint: radial glows, blurred auras behind key elements, text-shadow bloom on hot words. Display type is a modernist display sans (Clash Display) at cinematic, full-viewport scale with tight leading and mixed weights inside a single headline (solid, outline-stroke, and hot-glow words interleaved); body is a quiet geometric sans (Satoshi). Pages are stacked full-bleed scenes cut like film: background imagery scales and brightens as it enters, type layers move at different parallax speeds, letterbox bars open on first load, and a soft haze layer drifts continuously. Every scene carries film-slate metadata in its corners — scene numbers, timestamps ("01:47 AM"), location stamps — with occasional small katakana labels as texture. Structured information is staged as end credits: right-aligned label/value pairs revealed on scroll. Motion easing is long and smooth (600–900ms, cubic-bezier(.16,1,.3,1)); interactive elements bloom with orange glow on hover; the nav appears only after the first scroll. The voice is late-night and cinematic — short declarative lines, present tense, a little romantic about machines.

## The thesis as a design system

"Buy the part. Keep the night." scales into a token system whose defining discipline is that **sodium is light, not paint**. The single hot accent (`accent #FF7A1F`) appears only as glow, edge, and text — plus exactly one filled CTA per view — and never as a large flat fill. Everything else is night: `surface #0A0D13`, `surface-2 #0B0E14` for raised scenes, and `shadow-teal #0E1720` as the cool floor of every shadow, with warm white (`on-surface #F5EFE6`) and cool grey (`on-surface-dim #8A93A6`) carrying text.

Type is a **two-role cinematic system**. Clash Display carries every cinematic statement — the `display-giant` full-viewport words, `display`/`h2` headings, and even `price` — often mixing solid, outline-stroke, and glowing weights inside one headline. Satoshi carries everything read calmly: `body`, `label`, `kicker`, and the `slate` metadata. The `kicker` (`0.34em`) and `slate` (`0.3em`) tokens set the film-slate voice — scene numbers, timestamps, location stamps — so the framing reads as a film cut on any new page.

Shape stays soft but restrained: `rounded.sm (2px)` and `rounded.card (4px)` on rectangles, `rounded.pill (90px)` for spec chips, `rounded.circle` for avatars and dots — warmth without turning bubbly, because the drama comes from light and type. Elevation is the system's boldest move: **glow and haze replace shadow**. A blurred sodium aura behind an element is its elevation, a drifting haze layer adds atmosphere, hot words carry a `text-shadow` bloom, and copy over bright imagery gets a feathered radial scrim that reads as pooled darkness rather than a panel. The reusable structural patterns are the `slate` (corner metadata on every scene), the `kicker` (sodium eyebrow with a glowing rule), the pill `chip-spec`, the `scene-card` that stages provenance as film credits, and the `button-sodium` bloom. Motion is one governed rule — long and cinematic, 600–900ms on `cubic-bezier(.16,1,.3,1)` — so nothing on a new surface snaps or eases short. Every value is a token, keeping the whole night swappable from the `.md`.

## design.md — Google's open standard

[Google's open `design.md` format](https://github.com/google-labs-code/design.md) captures a design system as a single machine-readable file: a YAML token block (colors, typography, rounded, spacing, components) that a coding agent implements from exactly, followed by human prose (Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's & Don'ts) explaining the *why*. It is the source of truth, mirrored by a live `design.html` style guide so agent and human read the same system. This fits DRVN's "everything is a token / swappable design system" principle — the tokens below could drop into the real product without rewriting a page.

This concept ships a complete one. An excerpt of the actual token block:

```yaml
colors:
  surface: "#0A0D13"
  surface-2: "#0B0E14"
  shadow-teal: "#0E1720"
  on-surface: "#F5EFE6"
  accent: "#FF7A1F"     # used as light — glow / edge / text, never a large flat fill
  on-accent: "#0A0D13"

components:
  button-sodium:        # the one place sodium fills a solid area
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "18px 36px"
```

Full system: **[design.md](design.md)** (source of truth) · **[design.html](design.html)** (live style guide, rendered in After Hours' own language).
