# Motion — the DRVN motion language

> HTML twin: `/docs/motion`. Source of truth for values:
> `src/lib/motion/index.ts` (Motion for React) and the `--spring` / `--t-*`
> tokens in `src/app/globals.css` (CSS). The two systems share one timing
> vocabulary — this page is the contract between them.

## 1. Philosophy

DRVN sells physical objects with histories. Motion exists to make objects,
state changes, hierarchy, provenance and navigation easier to understand —
never to decorate. Every animation should communicate at least one of:
hierarchy, continuity, causality, state, location, relationship, direct
manipulation, or progress. If it communicates none of them, it does not ship.

**Personality:** precise, mechanical, responsive, controlled, slightly
inertial. The interface should feel like well-engineered machinery — a
torque wrench clicking home, not a toy bouncing. Which means: no exaggerated
overshoot, no playful rubberiness, no gratuitous scaling, no constant
ambient movement, and nothing that slows a frequent workflow.

## 2. Architecture — one language, two renderers

```
DRVN Motion Language        (src/lib/motion — tokens, springs, recipes)
        ↓
Motion for React            primary behavioral engine
        ↓                   presence, layout, gestures, orchestration
Components / interactions / spatial transitions

CSS                         retained where it is simpler
                            hover color, focus rings, ambient loading,
                            pseudo-element decoration
```

**Motion for React owns** animation that represents application behavior:
entrance/exit (mount/unmount), dialog and sheet presence, expand/collapse,
list insertion/removal, layout reflow, staggered orchestration, gesture
feedback, spring settling, interruptible motion.

**CSS keeps** cosmetic transitions with no state machine behind them:
text/background/border hover, focus-visible rings, the skeleton shimmer,
pulsing live dots, tooltip reveals, the `.is-in` draw cascade
(`.dimline-h`, `.live-word` underline, gsheet dimension spines). A CSS
transition is not a second design system when it uses the same `--t-*` /
`--spring` vocabulary.

The app-level policy is `MotionPolicy` (mounted once in the root layout):
`MotionConfig reducedMotion="user"`, so every Motion-driven animation
respects the OS reduce-motion preference without per-component wiring.

## 3. Timing

| Token | CSS | Motion | Used for |
| --- | --- | --- | --- |
| fast | `--t-fast` 160ms | `durations.fast` 0.16 | color, press feedback, small opacity |
| standard | `--t-standard` 240ms | `durations.standard` 0.24 | default fades, small state swaps |
| move | `--t-move` 380ms | `durations.move` 0.38 | spatial movement, sheets, reveals |
| draw | `--t-draw` 650ms | `durations.draw` 0.65 | narrative drawing — rules, provenance |
| easing | `--spring` `cubic-bezier(0.32, 0.72, 0, 1)` | `ease` | every duration-based transition |

## 4. Springs

True physics for spatial/structural Motion animation — tuned mechanical:
high stiffness, damping at or near critical, nothing visibly oscillates.

| Preset | Config | Used for |
| --- | --- | --- |
| `springs.snappy` | 500 / 34 / 0.7 | press feedback, toggles, chips |
| `springs.responsive` | 380 / 32 / 0.9 | menus, small surfaces, result notes |
| `springs.spatial` | 260 / 30 / 1 | dialogs, sheets, layout reflow |
| `springs.gentle` | 170 / 26 / 1 | larger/narrative surfaces settling |

(stiffness / damping / mass.)

## 5. Distance

Travel stays short — motion suggests mechanism, not travel:
micro ~2px · small ~6px · medium ~12px · large ~24px
(`distances` in `src/lib/motion`). Reveals rise 12px; dialogs 16px;
bottom sheets 24px; microfeedback 2–6px.

## 6. Recipes

Shared variants in `src/lib/motion` — spread these, never re-type numbers:

- `reveal` — the Rv scroll reveal (rise + fade, `move` timing, optional
  per-index delay via `custom`).
- `surface` — dialog/popover-scale surfaces appearing in place.
- `listItem` — insertion/removal in lists and feeds.
- `expand` — height-auto disclosure (offer counter composer, ledger detail
  rows, the sell-form publish checklist).
- `press` — `whileTap` scale 0.97 with the snappy spring (engagement
  buttons, save/follow).
- `stagger(step)` — orchestration helper; default 70ms per index, capped in
  long lists.

One-off transition values in feature code are animation debt. If a value
recurs, promote it here.

## 7. Reduced motion

- `MotionPolicy` (`MotionConfig reducedMotion="user"`) disables
  Motion-driven transform/layout animation globally; opacity still
  transitions, so state changes stay communicated.
- `Rv` and `BuildEvolution` render settled immediately under reduce — no
  hidden frame, with a timing failsafe so content can never stay at
  `opacity: 0` if an observer never fires.
- CSS keeps its own `prefers-reduced-motion` guards for the transitions it
  still owns (draw cascade, pulses, shimmer, tooltips).
- Information keeps moving: countdowns tick, progress updates, loading
  states communicate — reduced motion removes decoration, never data.

## 8. When to use which

**Motion for React:** something mounts/unmounts, changes place or size, or
several elements need coordination. Dialog/BottomSheet presence, ResultNote,
Toast, expand/collapse, staggered reveals, gesture feedback.

**CSS:** a hover/focus/active style with no application state behind it, or
an infinite ambient effect (skeleton shimmer, live-dot pulse). No new client
boundary just to tint a link.

**Don't animate:** page-level navigation by default; frequent workflows
where motion adds latency (rapid filtering, typing); server-driven status
repaints with no client state change (e.g. `OrderPipeline` renders a new
page — nothing "changes" on screen); normal scrolling and reading.

## 9. Where motion ships today

- `Rv` (every pagehead/tile reveal) — Motion-driven, `is-in` cascade kept
  for the CSS draw effects.
- `Dialog` — real enter *and exit* via `AnimatePresence` (offer dialog,
  confirm dialogs, lightbox, auth intent).
- `BottomSheet` — spring rise/settle on the always-mounted panel (its
  children must stay in the parent form, so no `AnimatePresence`).
- `Toast`, `ResultNote` — feedback presence.
- `CardEngagement`, `SaveButton`, `FollowButton` — press + state pop.
- Offer counter composer, listings-ledger detail rows, sell-form publish
  checklist — `expand` disclosures.
- Checkout address ↔ payment review — crossfaded step swap.
- `BuildEvolution` — the provenance strip draws its rule (`draw` timing)
  and settles milestones oldest → newest.
- Pickup Pass / shipping-label success — action payoffs settle in.
