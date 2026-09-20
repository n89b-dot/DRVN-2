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

## The post row (2026-09 direction)

The block document is only half the model. Three things about the row it
lives in changed with the September 2026 direction, and each is enforced in
the database rather than in the composer.

| Column | Rule | Why |
| --- | --- | --- |
| `title` | **Nullable** (W-1, migration 194000) | A quick post is a photo and a caption. Generating "Update from the Silvia" would be writing DRVN's sentence on somebody's behalf. Every reader goes through `postHeadline()` (`src/lib/activity/headline.ts`), which falls back to the member's own first line and only then to a neutral label — never to a blank heading or "Untitled". |
| `car_id` | **Nullable** (W-5, migration 197000) | The car gives context; it is never a gate. A member between cars still has parts to sell and things to say. The replacement rule is a deferred constraint trigger, `guard_post_has_subject`: on publish a post must have a car, a tagged part, or both. Drafts are exempt — you start writing before you decide what it is about. |
| photos | **At least one on publish** (W-2) | Every post is about a car or a part, and both are physical things. Enforced for `publish` and `quick` only: drafts may have none, and `update` is exempt so a post published before the rule can still be edited. |

### Tagged parts

`activity_post_listings` (W-3) records up to three of the author's **own
active** listings per post, ordered. A post is a place to say "this is for
sale", not a place to advertise somebody else's stock, so
`sync_activity_post_listings` is SECURITY DEFINER and checks the author
itself — a direct call cannot tag parts onto another member's post.

### Write modes

`write_activity_post(p_mode, …)` has four:

- `draft` — one unpublished draft per car, autosaved.
- `publish` — converts that car's existing draft row into the published post.
- `update` — edits an already-published post.
- `quick` — **always inserts, and returns before the draft lookup.** This is
  the release-blocking contract: without that early return, somebody halfway
  through a long update who fires off a photo and a caption would find the
  long one gone and its text replaced. `supabase/tests/activity_quick_post_guard.sql`
  proves the draft is byte-identical afterwards. `quick` is also the only
  mode that accepts a null car, because the full editor is reached from a car
  sheet and its draft machinery is keyed by car.

All four are retry-safe through the same `publish_operation_id`: a lost
response replays rather than double-posting.

### Where a post lives

`postHref()` (`src/lib/activity/href.ts`) and its SQL twin `post_href()`
(migration 198000) are the only two places that answer this. A post with a
car keeps `/cars/{slug}/activity/{id}` — every link already in the world
still resolves — and one without falls back to `/posts/{id}`, which has its
own route and its own share card. Thirteen hand-built copies of that string
were thirteen chances to emit `/cars//activity/{id}` on the day somebody
posted without a car.
