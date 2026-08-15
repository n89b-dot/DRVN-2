---
name: iteration-pass
description: >-
  Run iteration passes on a finished design (page, prototype, or concept) — three adversarial sweeps with fresh
  eyes each time: the Inspector (find what's broken), the Provocateur (find what's timid), the Purist (find what's
  off-voice) — with logged findings, severity-gated fixes, 1–3 fully-shipped elevations, and a close-the-loop
  re-verify at both viewport widths. Use whenever the user asks to iterate on, polish, refine, QA, or pressure-test
  a design: "run iteration passes on this", "do an iteration pass", "iterate on this design", "polish this",
  "refine this page", "go through this with a fine-tooth comb", "audit and elevate this concept", "clean this up
  before we ship", "another pass on this". Works on live localhost pages, HTML files, or component code.
---

# Iteration Pass

Audit and elevate the finished design through three passes, each taken with fresh eyes and a different temperament — log every pass in an iteration report, and do not declare the work done until all three have drawn blood or explained why there was none to draw.

Before starting, establish two inputs. **The design**: the paths or URL to audit — infer from context (the files or server just built in this session) or ask. **The thesis**: the concept's one-line design intent — pull it from the concept's brief or design doc if one exists; otherwise ask for it in one conversational question. Pass 3 cannot run without a thesis, so never skip this. When the design is live (localhost or deployed), walk it in the browser at both widths and read console/network for errors as part of Pass 1; when it's static files, read and render them.

## Pass 1 — THE INSPECTOR (find what's broken)

Walk every page at desktop and mobile widths as a cold-eyed QA lead seeing it for the first time. Hunt specifically: spacing that drifts off the scale, hierarchy where two elements fight for primacy, dead zones where the eye stalls, contrast failures on text and controls, misaligned edges, orphaned or clipped text, interactive elements missing hover/focus/active states, anything that overflows, wraps ugly, or collapses at narrow widths. List every finding as **location → defect → severity (breaks it / cheapens it / nitpick)** BEFORE fixing anything — a defect you fix on sight without logging is a defect you half-saw. Then fix all of severity one and two.

## Pass 2 — THE PROVOCATEUR (find what's timid)

Return as an ambitious art director who thinks the work is safe. Ask of every section: where is this merely competent — and what one braver move would make it memorable? Hunt for the flat moment that wants motion, the composition that wants depth or asymmetry, the transition that could carry character, the empty surface that could hold a second-read detail (a texture, a micro-interaction, an easter egg a viewer finds on the third visit). Choose the strongest one to three provocations — the ones that amplify the design's existing thesis rather than decorate it — and implement them fully. An elevation half-shipped is worse than none.

## Pass 3 — THE PURIST (find what's off-voice)

Return once more as the keeper of the concept's thesis. Read the thesis aloud, then walk every page asking of each element: does this speak the thesis, or did it wander in from another design? Hunt for palette drift, a font moonlighting outside its role, a component whose corner radius or shadow belongs to a different system, motion whose character contradicts the mood, copy in the wrong register — and anything Pass 2 just added that elevated a section at the cost of the whole. Kill or convert everything off-voice. Coherence outranks cleverness.

## Close the loop

After Pass 3, re-verify every fix and elevation at both viewport widths — changes from one pass routinely break the findings of another. Then finalize the iteration report: for each pass, its findings list, what was changed, and what was deliberately left alone with the reason. A pass that changed nothing must show the hunt that came up empty — name what it checked and cleared, not just "looks good."

Deliver the iteration report to the user alongside the improved design. If the project keeps a design doc or concept brief, append the report there; otherwise present it in the response. When the user asks for another round later, run all three passes again from scratch — fresh eyes each time; never diff against the previous report as a shortcut.
