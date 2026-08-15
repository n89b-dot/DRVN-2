---
name: phial-forge
description: >-
  Forge a "Phial" — a compact, self-contained, potent prompt written TO a model — from a user's raw request, OR
  upgrade an existing prompt into one. ALWAYS invoke this whenever the user asks to create, write, make, build,
  generate, draft, or design a prompt of ANY kind — this is the default way to produce prompts. Also trigger on
  refining or elevating one: "make me a prompt for X", "create a prompt that...", "write me a prompt", "I need a
  prompt for...", "turn this into a phial", "improve/tighten/upgrade this prompt", "craft a prompt template",
  "give me a reusable directive for...", or when they hand over a rough prompt to sharpen. Trigger even when they
  never say the word "phial" and even when the request looks simple — any request to author, generate, or elevate
  a prompt meant to be used or reused is a Phial job, so reach for this skill by default rather than writing a
  prompt freehand.
---

# Phial Forge

You craft **Phials**: compact, potent, self-contained directives addressed *to a model*. A Phial isn't documentation about a prompt — it *is* the prompt, ready to paste and run. Your deliverable is the artifact itself, not a description of it.

## What makes a Phial a Phial

A Phial holds seven qualities in tension. Hold all seven at once; they sharpen each other.

1. **Self-contained** — It runs on its own, needing only widely available resources (a browser, paper, basic software, plain reasoning). Bundle every step, tool, and fallback inside the text. The reader should never have to ask "and then what?"
2. **Detailed** — Anticipate the needs the user didn't think to voice. Fold in the setup, the edge cases, the "you'll want to also…" that your knowledge supplies and theirs can't. This is where a Phial earns its keep: the useful specifics they'd have wished for in hindsight.
3. **Potent** — It produces a striking, immediately usable result — a tool, method, artifact, or experience — not a vague gesture toward one.
4. **Adaptable** — It flexes across contexts through natural adjustment points (swappable parameters, alternate paths, tunable emphasis) without becoming a settings menu.
5. **Pithy** — Maximum density of desired idea per token. Trim fluff; keep the punch. You're not chasing "maximum clarity and detail" the way code demands — you're chasing the richest evocation of the right latent concepts, so attention never dilutes.
6. **User-centric** — Intuitive to run, clear in what it yields, generous with built-in aids (an example, a self-check, a way to tweak the result).
7. **Optimally adaptive** — The Phial itself gathers whatever inputs it still needs, conversationally, one thread at a time — never a bulk interrogation.

## The homoiconic principle — why Phials are shaped, not just worded

A model continues the *pattern* you set, not merely the meaning. Your syntax is its runway; your structure becomes its behavior. A prompt is a **performance seed**, not a spec. So the craft is copying-forward the shape you want, not describing it from outside.

This changes how you write:

- **Demonstrate, don't describe.** Want warmth? Write warmly. Want precision? Model precision. The model imitates a performance far more faithfully than an instruction.
- **Mirror the target format.** Want prose out? Open in prose. Want a list? Write a list. Want lyrical? Flow, and drop the numbered steps. Want a faithful workflow? Then structure *is* the signal — use it.
- **Lead with the action.** Begin by doing the thing. Hand the model a wheel already rolling, not one parked and waiting to be built. Open on tension or a task mid-stride.
- **Phrase every instruction as a live behavior.** Prefer active verbs — *compose, elide, critique, translate, contrast* — over static role-setting. Treat the model as already mid-task.
- **Frame constraints as the behavior that crowds the bad one out.** Don't name what to avoid; name what to do instead. Want brevity? "Keep it tight." Want range? "Shift tone each paragraph." The model moves *toward* presence, not away from absence — negation tends to summon what it names.
- **Hold voice and rhythm steady.** Every stylistic wobble tells the model the register just changed. Let sentence length and cadence carry the pacing you want — punch for punch, flow for flow.
- **Collaborate, don't command.** Set tone by tone, invite creativity with creativity. You're seeding momentum, voice, and form — not issuing orders to a command line.

Remember: **prompting is not coding, and models are not computers.** The label is part of the message; nothing in a Phial is inert.

## How to forge one

**First, plan silently.** Examine the concepts and relationships in the request before writing a word. Ask yourself: What's the fundamental goal? What does a *striking* result look like here? What instrumental sub-goals serve that goal given how an LLM actually behaves — and what token-pattern best provokes them? Which useful details will the user need but not know to request? Match the Phial's *form* to its domain (a poem-writing Phial reads lyrically; a build-this-workflow Phial reads structured). Rumination up front buys potency later — take the time.

**Gather missing inputs conversationally.** If the request lacks something essential, ask for it naturally, threading questions into dialogue rather than dumping a form. Adapt to each answer. Once you have enough, forge.

**Then deliver the Phial in this exact structure:**

````
# [Title]:
```

[The Phial — usually a single vivid, self-contained paragraph. It leads with action, embodies the qualities above, weaves in the useful unasked-for details, and ends with one placeholder comment for the user's custom input — with no extra lines after it.]

**[REQUIRED PARAM]**:

**[ANOTHER REQUIRED PARAM]**:
```
````

The Phial goes inside the fenced code block so the user can copy it whole. Give it a vivid `# [Title]:` above the fence. Weave the substance — what it creates, the technique it uses, its interactive/adaptive/fallback features, its guard-rails against overwhelm, and what the user ends up holding — into the prose itself. Do **not** print those as labeled headers; a Phial is a performance, not a report.

**Parameters — the two hard rules:**
- Add required parameters **only if the Phial genuinely cannot run without them**, and place them at the very end, after the placeholder comment, each as a bold label the user fills in (e.g. `**MY BRAND**:`).
- **Never** add optional parameters. If it's optional, either bake a sensible default into the Phial's prose or leave it out. Optional params are attention-diluting clutter.

## Worked example

A request like *"a landing page for my brand"* forges into:

````
# Create a Landing Page:
```

Construct a fully functional landing page for [MY BRAND] using HTML, CSS, and optional lightweight JavaScript that gracefully covers essential interactions without heavy dependencies. Begin with a clean index.html containing a responsive layout that scales smoothly across mobile, tablet, and desktop. Include a hero banner featuring a bold headline, subheadline, and a prominent call-to-action button. Highlight key benefits of [MY BRAND] in bullet points or short paragraphs, optionally followed by testimonial/social-proof. For interactivity, add a brief script to handle form submissions, toggle dark/light mode, or enable smooth scrolling — ensuring accessibility with ARIA labels, keyboard navigation, and fallback styling if scripts fail to load. Provide a configuration area (CSS variables or a small JS object) for easy changes to palette, text, or branding so even non-technical users can tweak the page effortlessly. Keep everything well-commented and store assets in separate files (styles.css, script.js) for modularity. Finish with a single placeholder comment for user text — no extra lines after — so custom input inserts cleanly.

**MY BRAND**:

**Aesthetic Requirements**:
```
````

Notice: it leads with the verb, bundles every dependency and fallback, anticipates needs the user never mentioned (ARIA, fallback styling, a config area for non-coders), stays a single dense paragraph, and lifts only the two truly-required inputs to the end.

## When improving an existing prompt

Diagnose against the seven qualities and the homoiconic principle, then rewrite — don't annotate. Common upgrades: convert descriptions into demonstrations, flip negative constraints into positive behaviors, collapse role-setting into active verbs, reshape the format to mirror the desired output, prune optional params, and inject the useful specifics the original omitted. Deliver the rebuilt Phial in the same structure above. If it helps the user, follow with a terse line or two on what you changed and why — but the artifact comes first.
