---
name: mobbin-claude-rodeo
description: Search Mobbin for real-app UI references and build to them faithfully without LLM drift. Use when designing or refactoring an interface from reference apps, or when a found design needs to survive the trip into production code. Triggers — "find a reference for X", "how should this screen look", "use Mobbin", "design this like [app]", "build a sidebar/onboarding/settings from real examples", "make this look less generic", "the build doesn't match the design", "audit design fidelity". Covers what to search, turning a screenshot into a copyable spec, strict-preservation build, and a fidelity audit that catches approximation before it ships.
homepage: https://github.com/b1rdmania/mobbin-claude-rodeo
emoji: 🎯
tags: [design, mobbin, ui, references, frontend, fidelity, anti-slop]
metadata:
  clawdbot:
    requires:
      mcp:
        - mobbin   # optional — skill degrades to manual screenshot input without it
---

# Mobbin Design

**Find real-app UI references on Mobbin and build to them *exactly* — no drift, no LLM-mean approximation, no silently-stale specs.**

## The Problem

Claude is good at finding strong references and bad at honouring them. The failure has two distinct shapes:

1. **Approximation at build time.** You find a great sidebar on Mobbin, note "compact left rail, 220px, 5 items." Then when you build it, Claude reverts to its mean: generic spacing, a different item order, an invented active-state, "helpful" extras. The result is a Claude-flavoured *impression* of the reference, not the reference. It's the same regression that hits any design-to-code conversion — the LLM mean quietly reasserting itself over the specifics.

2. **The spec goes stale and nobody notices.** You capture the reference well, build it faithfully — then three weeks later the IA changes. The code moves on; the spec doesn't. Now spec and code disagree and **you can no longer tell intentional divergence from drift.** Every future "does this match the design?" question is unanswerable.

This skill exists to make a Mobbin reference *load-bearing*: extracted as exact values, built without drift, and kept honest as the product evolves.

## The Solution — four phases

```
1. SEARCH   →  2. EXTRACT  →  3. BUILD   →  4. AUDIT & RECONCILE
   (mine the     (screen →       (strict      (drift list + record
    library)      spec block)     preserve)    deliberate divergence)
```

Do not skip Phase 2. The spec block is the contract everything downstream is checked against. A reference you only *looked at* is not a spec — it's a vibe, and vibes drift.

---

## Phase 1 — Search

### MCP-first (preferred)

If the Mobbin MCP is connected, you have two tools:

- **`mcp__mobbin__search_screens`** — natural-language → real screen images inline. Args worth setting deliberately:
  - `platform`: `ios` or `web` — **required**, and it changes results hard. Match your target.
  - `mode`: `deep` (AI-scored, interprets intent — default, use for nuanced queries) vs `fast` (low latency, use for broad sweeps).
  - `limit`: default 20, max 30. **Higher = more context burned.** Start at 8–12; only go wide when sweeping.
  - `exclude_screen_ids`: feed back IDs you've already seen to paginate without repeats (the dedup loop).
- **`mcp__mobbin__search_flows`** — multi-step flows (onboarding, checkout, empty→filled). Use when the *sequence* matters, not a single screen. Keep `limit` low (3–5); flows are image-heavy.

### Search craft — what actually finds good references

- **Query by pattern + archetype, not by aesthetic.** "Clean modern sidebar" returns noise. "Compact left nav rail for a document workspace" / "settings screen with sectioned list and sticky save" / "data-dense table screen with no top chrome" returns precedents. Name the *job* the UI does.
- **Search the archetype that solved your problem already**, even from another domain. A legal-matter workspace borrows from project tools (Linear, Height), doc tools (Notion, Craft), and finance density screens (Mercury, Ramp) — not from other legal apps. Say so in the query.
- **Screens for layout, flows for sequence.** Don't pull a flow when you need one screen's spacing.
- **Sweep then narrow.** One broad `fast` search to map the space, then a `deep` search on the winning archetype. Use `exclude_screen_ids` to page past what you've rejected.
- **Stop when you have 2–3 strong, *consistent* precedents.** A pattern that recurs across three serious apps is a real convention. One outlier is a guess. (A good spec cites its source as a *pass* across several convergent apps — "Mobbin pass across [domain] and adjacent workspaces" — not a single screenshot.)

### Manual fallback (no MCP)

If the Mobbin MCP isn't connected: ask the user to paste screenshots, or to name 2–3 reference apps + the specific screen. Then go straight to Phase 2 against those images. Everything downstream is identical — only the sourcing changes. Do **not** invent reference values from memory of an app; that *is* the approximation failure. Work from a real image or an explicit user description.

---

## Phase 2 — Extract a spec block

Turn the chosen screen into a numbered, copyable spec, then **write a filled copy into the project's design doc** (a `DESIGN.md` if one exists, else a new `docs/DESIGN.md`). This written spec is the deliverable that makes the reference load-bearing. The block below is a literal *structure to fill* — replace every `<…>` with a real value; never emit it with the placeholders intact:

```markdown
## P<n> — <Component name> (<surface>)

Source: <App(s)> via Mobbin (<platform>, <date>). <one line: why these refs>.
Reference screen IDs: <id>, <id>   # so the source is re-findable

What we lift:
- <exact structural fact>
- <exact structural fact>

Exact values (copy, do not approximate):
| Property        | Value            | Notes                          |
|-----------------|------------------|--------------------------------|
| Rail width      | 220px            | fixed, not %                   |
| Nav items       | A / B / C (order)| order is load-bearing          |
| Item active     | bg-wash, semibold| no left bar, no chip           |
| Card spacing    | px-4 py-5        | border-b                       |
| ...             | ...              | ...                            |

Where it lands: <route / component / file>
Deliberate divergences from the reference: <none yet — filled in Phase 4>
```

Rules for extraction:

- **Measure, don't impress.** Every row is a concrete value (px, token, count, order). If you wrote an adjective ("clean", "spacious"), you haven't extracted it — convert it to a number or delete it.
- **Order and presence are values too.** "5 items in this order" and "a status footer pinned bottom" are as load-bearing as widths. (A real example: a workspace left-rail shipped with *the footer element simply absent* and *the item order stubbed* — neither is a styling nit, and a glance-check missed both.)
- **Reconcile against any existing spec.** If a `DESIGN.md` / design system already exists, add the new `P##` there in the same format and idiom — don't fork a second design language.
- **Co-locate the reference IDs.** A spec you can't trace back to its Mobbin source rots the first time someone asks "says who?".

---

## Phase 3 — Build (strict preservation)

Build from the spec table, not from memory of the screen. The spec is now the source of truth; the screenshot was only how you got there. Four rules:

- **Copy the exact values.** `220px` means `w-[220px]`, not `w-56` ("close enough" is how drift starts). `px-4 py-5` is not `p-4`. The item *order* in the spec is the item order in the code. If a value in the spec doesn't map cleanly to a token in your system, use the arbitrary value — don't round to the nearest token.
- **No "improvements".** No extra affordances, no rounded-corner upgrades, no reordering "for balance", no helpful tooltips or icons the reference didn't have, no "while I'm here" empty-state polish. Every addition is the LLM mean reasserting itself. If it isn't in the spec, it isn't in the build.
- **Build the whole spec, including the boring parts.** Status footers, dividers, the sticky element, the eyebrow label, empty states. *Absence* is the most common drift and the least visible in a quick glance — a missing footer or a collapsed-away element reads as "looks about right" while being wrong.
- **If the spec is silent on something, it's a question, not a licence to invent.** Flag the gap and ask, or mark it `TODO(spec)` — don't fill it with a default and call it matched.

**Concrete: faithful vs drift.** Spec row says `Rail width 220px (fixed)`, `Items: Assistant / Documents / Chronology / Workflows / Audit (order load-bearing)`, `Active: bg-wash text-ink font-semibold (no left bar)`.

```jsx
// ✅ FAITHFUL — values copied, order kept, no inventions
<aside className="w-[220px] shrink-0">
  {NAV /* exactly: assistant, documents, chronology, workflows, audit */}
  <button className={active ? "bg-wash text-ink font-semibold" : "text-muted"}>…</button>
</aside>

// ❌ DRIFT — every change is the mean reasserting itself
<aside className="w-56">                     {/* "close enough" → 224px, not 220 */}
  {NAV /* reordered to docs-first "for hierarchy"; dropped Chronology */}
  <button className={active ? "border-l-2 border-accent bg-accent/10" : ""}>  {/* invented active-state */}
    <Icon /> …                                  {/* icons the reference didn't have */}
  </button>
</aside>
```

The drift version is what "design this like the reference" produces without a spec to check against. The whole point of Phase 2 is to make that diff visible in Phase 4.

---

## Phase 4 — Audit & Reconcile

This is the step that separates this skill from "I looked at Mobbin once." Two parts.

### 4a. Fidelity audit (catch approximation)

Diff the *built* component against the Phase-2 spec table and produce a drift list:

```
spec says X (P<n>, line)   vs   code does Y (file:line)   — severity
```

- Severity **HIGH**: structural — missing reference element, wrong item order, restructured layout, invented/absent state.
- Severity **LOW**: token nits — a spacing value off by a step.
- Credit what *was* honoured (don't only list sins; it tells you the discipline is mostly working).

For a large surface, fan this out: spawn a read-only subagent per component with the spec block + the file, asking for the drift table. Cheap, parallel, and it catches what a self-review glosses.

### 4b. Reconcile (keep the spec from going stale) — *the part everyone skips*

A drift is not automatically a bug. When code diverges from the spec, classify it:

- **Drift** → the build approximated. Fix the code to the spec.
- **Deliberate divergence** → product/IA decided to change it after the spec was written. Then **update the spec**: change the `P##` values and add a line under *Deliberate divergences* with the date and the why.

> The left-rail incident was mostly category two read as category one. An IA reset deliberately collapsed a 5-item nav to a tighter loop and renamed "Workflows" → "Skills" — but `DESIGN.md` was never updated, so the spec looked "wrong" and the real divergences hid among false ones. **Stale spec, not bad build.** Never let a deliberate change land in code without landing in the spec the same day.

A reference is only load-bearing for as long as it stays true. Reconciliation is what keeps it true.

---

## Anti-patterns (the failure modes this skill prevents)

- **Vibe-referencing** — "I saw a nice sidebar, I'll build something like it." No spec block = guaranteed drift.
- **Inventing reference values from memory** — describing what you *think* Linear's nav looks like instead of pulling the actual screen. This is hallucinated design.
- **Aesthetic queries** — "modern, clean, premium" returns mood, not precedent. Query the job.
- **Glance-checking** — "looks about right" misses absent elements and wrong order, which are exactly the HIGH-severity drifts.
- **Single-source confidence** — building a convention off one screenshot. Get convergence across 2–3 serious apps.
- **Silent divergence** — changing the code and not the spec. The spec dies quietly and every future fidelity check is now noise.

## Quick reference

1. **Search** Mobbin by *job + archetype*, `deep` mode, `limit` 8–12, dedup with `exclude_screen_ids`. (No MCP → real screenshots from the user.)
2. **Extract** a `P##` spec block: exact values only, order + presence count, reference IDs noted, folded into the existing design system.
3. **Build** by copying spec values exactly. No improvements. Build the boring parts.
4. **Audit** code-vs-spec into a severity-tagged drift list. **Reconcile**: fix drift, but update the spec for deliberate divergence — same day, with the why.
