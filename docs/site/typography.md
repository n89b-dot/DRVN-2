# Typography

Two families, loaded via `next/font` in `src/app/layout.tsx`:

| Stack | Family | Weights | Token |
| --- | --- | --- | --- |
| Sans | IBM Plex Sans | 400, 500, 600, 700 | `--sans` / `--font-sans` |
| Mono | IBM Plex Mono | 400, 500 | `--mono` / `--font-mono` |

The split is semantic, not decorative: **sans carries prose and values; mono
carries labels, navigation, data and money.** Every number that ticks is mono
with `tabular-nums`.

## Scale

| Tier | Face | Spec | Where |
| --- | --- | --- | --- |
| Display | Sans 650 | `clamp(28px, 4vw, 44px)` / 1.05 / -0.02em | `.pagehead h1` — the only display type |
| Num-giant | Sans 650 | `clamp(40px, 5.4vw, 64px)` / 0.95 / -0.03em, tabular | `.num-giant` KPI numerals |
| Section head | Sans 650 | 18px / 1.3 / -0.01em, sentence case | `.tile__head > .microlabel--ink`, `.bsec > .microlabel--ink` — promoted from label to heading; always larger than the section's buttons |
| H2 | Sans 650 | 18–21px / 1.4 / -0.01em | tile heads (18px), prose h2 (21px) |
| H3 | Sans 650 | 15–17px / 1.4 | drop/alert/mail headings, prose h3 |
| Value | Sans 600 | 17.5px / 1.35 / -0.01em | `.bline__val` — ruled-row values |
| Body | Sans 400 | 17px / 1.55 | `<body>` default |
| Body-sm | Sans 400 | 15–16px / 1.55 | feed items, reviews, spec cells, row notes |
| Body-prose | Sans 400 | 17px / 1.7 | `.prose` legal/long-form |
| Label (microlabel) | Mono 500 | 12px / 0.14em tracking / uppercase / dim | `.microlabel` — the connective tissue |
| Label-row | Mono 400 | 12px / 0.12–0.13em / uppercase / dim | `.bline__label`, `.msg__who` |
| Label-nav | Mono 400 | 11.5–12.5px / 0.10–0.12em / uppercase | `.bar__link`, `.jumplink`, `.fbtn` |
| Label-btn | Mono 400 | 12px / 0.10em / uppercase | `.btn` |
| Mono-data | Mono 500 | 12.5–14px, tabular | `.livedim .val`, `.spec` values, `.capsule` |
| Mono-meta | Mono 400 | 11–12.5px / dim | order meta, feed times, mail footers |

## Rules

- One display heading per page (`.pagehead h1`), carrying exactly one
  `.live-word`.
- Microlabels are 2–6 words, always uppercase mono — they label regions of
  the sheet, never full sentences. In heading position (leading a
  `.tile__head` or `.bsec` row, ink variant) they promote to Section head
  scale: sans, sentence case, 18px — the headline must outweigh every button
  in its section.
- `tabular-nums` on anything that counts, ticks or aligns in columns.
- No additional families, no italics as a system voice, no faux weights.
- Letter-spacing tightens as size grows (display -0.02em) and opens on small
  mono labels (up to 0.14em).
