# Agent surfaces (A3): the design to build to

These are the A3 agent screens, designed on 18 October 2026, before A3a is built. That timing is the agent plan's documentation gate ("Designed before A3a is built"). The plan is [`docs/plans/2026-10-agent-and-graph-plan.md`](../../plans/2026-10-agent-and-graph-plan.md). The rules come from [`docs/decisions/negotiation-v2.md`](../../decisions/negotiation-v2.md) and [`docs/decisions/agent-foundations.md`](../../decisions/agent-foundations.md).

**Layout is a requirement.** Build each screen to its PNG. That means the arrangement, the order of sections, which component sits where, and the copy. Then compare the built page with the PNG in the browser, at 390 and 1440, in Day and in Night, before calling it done. This is the lesson in memory `drvn-mock-fidelity-lesson`.

## Where the design lives

- **Figma:** the page **06 Agent (A3)** in the DRVN file: <https://www.figma.com/design/oTAzHAiKwj3J2zqr6lvmuS/DRVN?node-id=111-916>.
  - Each surface is a section with four frames, in this order: Day 390, Day 1440, Night 390, Night 1440.
  - The Night frames are the Day frames with the Livesheet variable mode set to Night. Every colour is bound to a Livesheet variable, so the two can't drift apart.
  - **99 Ledger** (frame `100:2`, section 08 "06 Agent (A3)", node `127:2`) lists every frame ID.
- **PNGs in this folder:** Day only, at 1×, one for each surface and width. For Night, open the frame in Figma.
- **How it was built:**
  - Each frame is composed from the file's existing Livesheet components: instances, Livesheet variables and the file's text styles.
  - Screens that already exist were cloned from pages 03 and 04 and then changed: the offer page, the edit-listing page, notifications, the listing page and Home. That keeps the shell, gutters and type the same as the live product.
  - Type is IBM Plex throughout. Mono is used only for labels and data at 12px or under. Spacing follows the 4/8/12/16/20/24 scale (`--space-N`).

## The PNGs

| PNG | Figma, Day 390 / 1440 (Night 390 / 1440) | Plan section | Composes |
| --- | --- | --- | --- |
| `01-bottom-bar-390-day.png` | `114:83` / `114:186` (`125:2904` / `125:2976`) | UX › Mobile bottom bar; A3a step 1 | `BottomNav` (built in PR #37) over `/home`: Explore · Marketplace · Home · Garage · Agent, with Home current. The Agent tab carries the rail's dot when Needs you isn't empty. A 34px safe area sits below the bar. |
| `01-bottom-bar-1440-day.png` | as above | same | At 1081px and wider the bar isn't drawn (`.bnav` is `display: none`). The rail gains an **Agent** `RailRow` after Garage, with the proposed glyph and the dot. The rest of `/home` is unchanged. |
| `02-agent-screen-390-day.png` | `115:912` / `116:1081` (`125:3065` / `125:3098`) | UX › The agent screen (items 1–6); A3a step 1, with the thread from A3c | `/agent` full screen, top to bottom: `LivesheetBar` (mobile), then the agent header (H1 "Agent", a Beta `Chip`, a settings icon, a one-line status), then **Needs you · Working · Done** as `SheetTab`s, with Needs you first and its count in `--live-text`. Below that come the Needs you rows (`ObjectRow` with its one action), then the thread: `ThreadDivider`, `MessageRun`/`MessageBubble` (You, Agent), the result cards, quiet `ThreadEvent` rows ("Countered $241 on APR intake · why") and one Live `ThreadEvent` for the task that needs you. Then the starter chips (`FilterButton`, wrapping), `ChatComposer`, and `BottomNav` with Agent current. |
| `02-agent-panel-1440-day.png` | as above | same; "Desktop: … non-modal right-hand panel" | A **SidePanel**, 400px wide, beside `/offers/[id]`. The page stays fully usable and the rail shows Agent current. The panel holds: the header (Panel variant, with Close), the segments pinned above the thread, the thread scrolled to its newest message at the bottom, then starters and a composer with the context chip ("About: APR intake, your listing ×"). **Needs you is empty here, so it's hidden**, and the segments start at Working. |
| `03-handle-offers-390-day.png` | `119:1347` / `119:1609` (`125:3176` / `125:3336`) | First release › Seller agent; UX › Sell form and listing manage page | `/listings/[id]/edit`, section 05 "Price, shipping & location". Sections 01–04 are unchanged and hidden in the frame. A new block (`--tile-2`, `--r-ctl`, `--rule-mid`) holds: a `Checkbox` "Let DRVN handle offers" with a Beta `Chip`; a one-paragraph explainer; `TextField` (prefix) **Minimum — your walk-away price** $230 and **Target** $245; `Checkbox` **Show my minimum on the listing** (off); **Style** as `Radio` Firm / **Balanced** / Flexible with a hint; and, under a hairline, the **one-time binding acknowledgement** (`Checkbox`). The same block goes on `/sell`. |
| `03-handle-offers-1440-day.png` | as above | same | The same block. Minimum and Target share a row (`field--row`). |
| `04-offer-history-390-day.png` | `114:10729` / `114:10873` (`125:3520` / `125:3553`) | UX › Offer history; The agent label on offers | `/offers/[id]`, the seller's view after a negotiation with agents on both sides. The subject tile has `StatusChip` accepted, "Order 7F3A21C0 →", and **Cancel before checkout** (`Button` destructive) with its hint. The History tile has one **OfferRound** row per move: **Buyer's agent**, **Your agent**, **Buyer**, **You**. Each row has a timestamp line ending in a muted "· via agent" on agent turns, and a one-line reason under **your own agent's** turns only. The Conversation tile says agents never message the other side. |
| `04-offer-history-1440-day.png` | as above | same | Same, with the Row layout: who acted on the left (plus the reason), "$241 · 17 Oct, 13:40 · via agent" on the right. |
| `05-confirm-card-390-day.png` | `120:1624` / `120:1786` (`125:3609` / `125:3631`) | UX › Confirmation and limits; Garage and listing jobs › Update my build (A3c) | `/agent`. The member's message, with a photo, reads "Just fitted KW V3s…". The agent answers with the **confirm card** (AgentResultCard, Confirm variant): "Add KW V3 to your Mk8 Golf R; mark APR Roll-Control removed". It has + and − change rows, the note "Saved through the mods editor. Nothing changes until you confirm.", **Confirm** (live) and **Edit** (ghost). A follow-up chip "List the old one?" sits below. The task is also in Needs you. |
| `05-confirm-card-1440-day.png` | as above | same | The same card in the SidePanel over `/home`. To fit the viewport, the member's message is text only here. |
| `06-notifications-390-day.png` | `122:2407` / `122:2558` (`125:3738` / `125:3843`) | UX › Notifications; Code › notification kinds | `/notifications`, Marketplace group. Four new rows built on the existing notification `TimelineRow`, **with no agent badge or icon**: **Recommends accept** (`[ Accept $239 ]` and Counter), **Deal reached** (**Cancel before checkout** and View order →), seller **out of rounds** (the gap, and Open offer history →), and buyer **out of rounds** (the gap, Accept $460, and Open offer history →). |
| `06-notifications-1440-day.png` | as above | same | Same, at the wide layout. |
| `07-negotiate-for-me-390-day.png` | `124:2581` / `124:2732` (`125:3968` / `125:4066`) | First release › Buyer agent; UX › Listing offer box (A3b) | The listing's offer `Dialog`, which renders as a bottom sheet on a phone. It opens with **Make an offer \| Negotiate for me** (`FilterLink` pair) and a Beta `Chip`. Then: the ceiling as `Radio` **Item** / **Item + shipping ($95)**; **Your max — private** (`TextField`, $ prefix, hint "the seller never sees it"); **Style** (`Radio`); an `Alert` that spells out the accept rule ("A counter at $1,300 or less is accepted. You then pay by hand within 24 hours."); a binding `Checkbox`; and Cancel with `[ START NEGOTIATING ]`. |
| `07-negotiate-for-me-1440-day.png` | as above | same | The same contents in the centred dialog (560px) over `/listings/[id]`, with the full explainer ("…the seller sees normal offers marked 'via agent', never your max"). |
| `08-first-visit-390-day.png` | `120:2436` / `120:2550` (`125:4182` / `125:4213`) | UX › Confirmation and limits › First visit | `/agent` before anything has run. The status reads "Nothing running yet", and the segments are hidden because all three are empty. An intro tile ("Your agent works for you, inside limits you set.") has three groups, **Selling**, **Buying** and **Garage**, each with one line and its starter chips. The footnote reads "Nothing to set up first." The composer sits below. |
| `08-first-visit-1440-day.png` | as above | same | The same intro in the SidePanel over `/selling`. |

### What ships in which step

The frames show the full design. Build only what each step owns:

- **A3a (seller negotiation, no chat):**
  - Build: the bottom bar and the rail Agent row (01); `/agent` with its header, the segments, Needs you rows, Working and Done rows, and the quiet event rows with "why" (02); the handle-offers block (03); offer history with rounds, "via agent" and reasons (04); the three seller notifications (06).
  - Leave out the composer, the starter chips, the member and agent messages and the result cards. They arrive in A3c.
- **A3b (buyer negotiation):** "Negotiate for me" (07), the buyer's out-of-rounds notification (06), and buyer rows in Working.
- **A3c (chat):** the thread with messages, result cards, the confirm card (05), starters, the composer with its context chip, the SidePanel on desktop, and the first-visit intro (08).

## Components: reuse, new, and needed

Reused unchanged: `AppShell` rail rows, `LivesheetBar`, `PageHead`, `SheetTabs`/`SheetTab`, `ObjectRow`, `MessageThread`, `MessageRun`, `MessageBubble`, `ThreadEvent`, `ThreadDivider`, `ChatComposer`, `FilterButton`, `FilterLink`, `Button`, `ButtonLink`, `Jumplink`, `Alert`, `Chip`, `StatusChip`, `DataRow`, `TextField`, `Checkbox`, `Radio`, `Dialog`, `TimelineRow`, the notification row, and `Feedback/Alert`.

These are on the Figma page (section `111:918`). Each needs a matching component or recipe in code:

| Figma | Status | Code (per CLAUDE.md: registry entry, barrel export, `docs:components`, specimen, CSS recipe in its family file) |
| --- | --- | --- |
| `Navigation/BottomNav` `111:1085` | **Built** in PR #37 | Matches the build: a 56px row, 20px stroke icons, Plex Sans 500 12/16 labels, a 2px `--live` tick on the current tab's top edge, a `--tile` ground and a `--rule-mid` hairline. Needs an `agent` route in `BOTTOM_NAV` once `AGENTS_BETA` is on, and the dot fed by the Needs you count. New Figma text style: `Label/Bottom nav`. |
| `Icon/agent` `111:924` | **Proposed** | Add `agent` to `IconName` in `src/components/ui/icons.tsx`. The glyph is a steering wheel, on the same 24 grid and 1.6 stroke as the other icons: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.2"/><path d="M3.2 12h6.6M14.2 12h6.6M12 14.2V21"/>`. |
| SidePanel (frames in 02/05/08) | **New, needed (A3c)** | `SidePanel` in `@/components/ui`. It is non-modal: no focus trap, no scrim, and the page stays interactive. It is 400px wide on a `--paper` ground with a `--rule-mid` left hairline, and it is full height beside `shell__body`, which narrows to fit. From top to bottom: header, pinned segments, a thread that scrolls (newest at the bottom), then the composer. The plan says "styled like BottomSheet". The ground is paper rather than BottomSheet's tile, because the thread's cards are tiles. |
| `Agent/Header` `112:77` | **New, composed** | Used on `/agent` (Screen) and in the panel (Panel), so it becomes an `AgentHeader` in `@/components/commerce`. It is composed from `Chip`, `Icon` and `Button` (quiet "Close" in the panel). |
| `Agent/AgentResultCard` `112:159` | **New (A3c)** | `AgentResultCard` in `@/components/commerce`. It's used in the thread, the panel and Needs you, which is more than two places, so it qualifies as a component. It has four kinds: **Negotiation** (opens `/offers/[id]`), **Offer set-up** (the mandate card from chat, with Confirm and Edit), **Confirm** (the confirm card for writes, with Confirm and Edit), and **Draft listing** (opens `SellForm` prefilled). It is composed from `ObjectRow` anatomy, `DataRow`, `Button` and `Jumplink`. A card only opens a real page; it never holds a form. The plan names the confirm card as "`ObjectRow` + `ConfirmDialog`". The design keeps it inline in the thread instead, and leaves `ConfirmDialog` for destructive confirms. |
| `Commerce/OfferRound` `112:177` | **New, changed `OfferCard` and offer page (A3a)** | One row per round. The **Row** layout is for widths of 640px and up, **Stacked** for phones. The props are who acted, the amount and time, `viaAgent` and `reason`. The "· via agent" text is the **CSS recipe** (`.viaagent`) that negotiation-v2 §6.3 planned: same face and colour as the timestamp line (`--dim`), with no badge and no icon. A reason shows only on the viewer's own agent's rounds. |
| Agent offers block (03) | Plain JSX in `SellForm` | This is not a component. It is a group inside `FormSection` step 5, composed from `Checkbox`, `Chip`, `TextField`, `Radio` and the form hints. While the agent is on, the existing "Lowest offer you'd read" field and its "Show this minimum" toggle move into the block, relabelled "Minimum — your walk-away price". They keep the same `offer_floor_cents` and `show_offer_floor` columns. |
| Offer-mode switch (07) | Plain JSX in `purchase-actions.tsx` | A `FilterLink` pair at the top of the existing offer `Dialog`. |
| `StatusChip` agent task states | **Not designed** | Plan line "`StatusChip`: agent task states". The Working rows carry their state in text ("Round 2 of 3 · …") for now. |

## Open design questions for Neil

1. **The Agent glyph.** It is proposed as a steering wheel: you stay the driver, with no robot and no sparkle. Keep it, or pick another?
2. **The composer and the bottom bar on `/agent`.** PR #37's `.bnav` stands down whenever a `.chatbox` is on the page. That rule would hide the bar on the Agent tab's own root once chat arrives in A3c. The designs keep the bar under the composer on `/agent` and hide it only while the keyboard is up, which `BottomNav` already does. That needs a `.bnav` exception for `/agent`. Alternatively, accept that the bar disappears there.
3. **Who-acted labels.** The plan says You, Your agent, Buyer, Buyer's agent, and the designs use those. Today's history uses names ("Imani Okafor countered"). Roles, names, or "Kaito's agent"?
4. **How quiet "via agent" is.** It is drawn as plain `--dim` text in the timestamp line's own face. Is that quiet enough, or should it be quieter, for example 12px mono?
5. **One minimum, not two.** With the agent on, the existing floor field and its toggle move into the agent block, as above. Confirm.
6. **A buyer acknowledgement.** The plan specifies the one-time binding acknowledgement for sellers. The designs add the buyer's version: "an accepted counter is a purchase I'll pay for within 24 hours". Confirm.
7. **The buyer's style words.** The designs reuse Firm / Balanced / Flexible ("how hard it opens"). Does the buyer side need its own words?
8. **The panel.** It is 400px wide on a `--paper` ground, not BottomSheet's `--tile`, with the segments pinned above the thread. OK?
9. **Duplicate actions.** When a task is in Needs you, its card in the thread drops its buttons, so Accept appears once on screen. Confirm.
10. **Notifications grouping.** Agent kinds sit in the Marketplace group, with no "Agent" group and no badge. Confirm.
11. **Not drawn here:** the new mobile top bar from plan A3a (avatar, Messages), Settings → Agent, the "Agent" status on Selling and Offers rows, the inline Alert prompt on a second below-asking offer, the signed-out bar (Explore · Marketplace · Join), and the disabled "Negotiate for me" state on DRVN Shipping listings. Copy for that last one: "Shipping is priced at checkout, so DRVN can't negotiate a total here." Design these next, or build them from the patterns above?
