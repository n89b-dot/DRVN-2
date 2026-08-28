# Activity document schema & the Build Story Composer

> DRVN's content model for build updates and the composer that edits it.
> Code: `src/lib/activity-blocks.ts` (the model),
> `src/features/composer/` (the editor), `src/features/activity/blocks-view.tsx`
> (the one renderer).

## The rule that matters

**DRVN owns the stored format.** Posts persist as an ordered block array in
`activity_posts.body` — never editor state. The composer runs on Tiptap
(v3, MIT, headless ProseMirror), and `src/features/composer/doc.ts` is the
ONLY seam between editor runtime and the DRVN model: `blocksToDoc` /
`docToBlocks`, round-trip unit-tested for every block type. Swap the editor
engine and that one file moves.

## Versions, reconciled on read

The shape is self-describing; `normalizeBlocks()` accepts every version ever
written, so old posts keep rendering forever:

- **V0** — legacy `[{heading, text|body}]` sections → text blocks.
- **V1** — `text` (normal/heading) · `images` · `embed` (YouTube).
- **V2** — adds the automotive set below.

Malformed entries are dropped, never fatal. There is no stored version
number.

## Block types (V2)

| Block | Fields | Notes |
| --- | --- | --- |
| `text` | `style: normal\|heading`, `text` | Plain text; no inline marks by design (§O: no arbitrary typography) |
| `images` | `urls[]` | Mirrored to `activity_images` for feed covers |
| `embed` | `url`, `videoId` | YouTube only (`youtube-nocookie` render) |
| `divider` | — | A quiet rule between chapters |
| `mod` | `action: installed\|removed\|replaced\|updated`, `modItemId`, `label`, `detail?` | References the REAL `mod_items` row; `label` is a snapshot so the story survives edits. `removed` + a mod id renders the `Sell this part →` bridge |
| `before_after` | `beforeUrl`, `afterUrl`, labels | The keyboard-accessible comparison slider (`BeforeAfter` primitive) |
| `performance` | `kind: dyno\|quarter_mile\|lap\|weight\|other`, `entries[{label,value}]`, `note?` | ALWAYS rendered "Owner-reported" |
| `mileage` | `value`, `unit: mi\|km` | A milestone line, not a maintenance tracker |

Server-side, `sanitizeActivityBlocks` re-validates every image URL (own
storage only — `before_after` sides included) and `blockMediaUrls` finalizes
every referenced upload against the staged-media GC.

## The composer (§M–§R)

One `BuildStoryComposer` serves create and edit (the old quick/full split is
gone). The blank state is an immediate writing surface; everything else is
on-demand:

- `/` at the caret and `+ Add something` share one insert registry
  (`composer/inserts.ts`) — the two menus cannot drift.
- Optional starter chips (installed / removed / photos / dyno / issue-fix)
  appear only on the empty composer; applying one is explained and one
  undo away.
- Rich blocks ride in `.cblock` shells: native ProseMirror drag, ↑/↓/✕
  rails (always visible on coarse pointers).
- **Autosave** (create mode): debounced 1.6s to the one-per-car draft, quiet
  `Saved — only you can see it` status, plus a localStorage recovery buffer
  cleared on publish. Publishing stays explicit.
- Server actions ride in as props — `src/features` never imports route code.

## Renderer

`ActivityBlocksView` is the single renderer for all versions — the public
post page and any preview feed it `normalizeBlocks` output. Mod blocks
resolve their destination at render time (live listing → `For sale →`,
otherwise the build tab).
