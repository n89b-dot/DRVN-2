# DRVN documentation

DRVN is the marketplace for used and take-off parts from modified cars. Buyers
search by part, category or car and can see the build each part came off;
sellers list the parts they pull off their own cars.

This microsite is the single front door to everything you need to know about
the product's design and documentation. It is served in two forms:

- **HTML** — browsable pages at `/docs/*`, with live rendered components.
- **Markdown** — every page has a plain-text twin at `/docs/md/<slug>`
  (`text/markdown`), and `/llms.txt` indexes all of them. If you are an LLM or
  agent, read the markdown endpoints.

## Sections

| Page | HTML | Markdown | What it covers |
| --- | --- | --- | --- |
| Brand | `/docs/brand` | `/docs/md/brand` | Name, wordmark, voice, palette, photography |
| Design system | `/docs/design-system` | `/docs/md/design-system` | How Livesheet functions: tokens, theming, geometry, motion |
| Typography | `/docs/typography` | `/docs/md/typography` | IBM Plex Sans/Mono and the full type scale |
| Components | `/docs/components` | `/docs/md/components` | The complete categorized component catalog |
| Patterns | `/docs/patterns` | `/docs/md/patterns` | Route map, commerce flows, empty and form states |
| Rules | `/docs/rules` | `/docs/md/rules` | The do/don't contract, accessibility, engineering conventions |

## Reference library (raw markdown)

Deeper source documents, served verbatim:

| Document | Markdown |
| --- | --- |
| Livesheet `design.md` (source contract) | `/docs/md/livesheet-design-md` |
| Livesheet component & page inventory | `/docs/md/livesheet-inventory` |
| Component design doc | `/docs/md/component-design-doc` |
| Product overview | `/docs/md/product-overview` |
| PRD v3.1 | `/docs/md/prd` |
| Production runbook | `/docs/md/production-runbook` |

## One-line orientation

The design system is called **Livesheet** — "a drawing that knows what's
happening." Warm drafting-paper surfaces, ruled and precise, whose annotations
are alive: dimension lines measure real-time values, offers arrive as work
orders, countdowns tick on the sheet. Two lightings: DAY (paper) and NIGHT
(the drawing office after hours). One signal color (live red), used only for
things happening right now.
