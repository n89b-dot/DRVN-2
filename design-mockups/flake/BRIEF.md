# Flake

**Thesis.** The paint is the interface. Family: *material*. Automotive paint is a three-layer material (base coat, metallic flake, clear coat) and every surface on this page behaves like it: the hero is a painted door skin lit by your pointer, cards sparkle where the light falls, and the page's accent is never fixed, it is the paint of the car you are looking at. Pick a paint and the shader, the chip, the builds grid, the parts rail and the sell preview all take the colour.

**Precedents.** Paint-configurator surfaces in manufacturer car builders (the colour swatch rail that re-tints the car); Porsche's "Paint to Sample" and Nissan's Midnight Purple code culture (LP2, 02C, NH-0 and 46V are real maker codes); Lexus and Mazda paint-technology pages where a macro of flake under raking light does the selling. Grounded by direct reference rather than Mobbin this session.

**Showpiece.** The paint panel (`flake.js`, `initPaint`). A displaced plane with a swage line and a lower crease, analytic normals, and a fragment shader that layers base coat with Fresnel colour shift, cell-hashed flake micro-normals gated so only some cells sparkle, a clear-coat Fresnel term reflecting a procedural studio (dark surround, one long overhead softbox), and a pointer-following key light with idle drift. Paint changes are tweened over 700ms. No-WebGL fallback is a CSS gradient panel in the same tokens; reduced motion removes the idle drift.

**Motion.** No commissioned video; motion is the shader itself, the paint tween, the flake sparkle on build cards (pointer-tracked masked gradient) and the reveal fades.

**Interactions.** Paint swatches, paint-code lookup (type LP2 / 02C / NH-0 / 46V or a paint name), builds grid re-ordering by active paint, parts rail per build, buy sheet with a done state, live sell preview that re-tints when you change the car, small-screen menu.

**Flaw hunt.** Found: the builds grid shared the id `builds` with its section, so the cards were rendering into the section and the grid was `display: block`. Fixed by renaming the grid to `buildGrid`. Found: the first shader pass read grey because the environment term swamped the base coat; darkened the surround, raised the base term and added a soft metallic sheen so flake reads as a field, not dots. Found: hero headline ran to four lines at 1440; reduced the clamp.

**Style-emulation prompt.** Light primer-grey canvas (#DEDEDA) with near-black ink, Archivo set wide (wdth 112) for display and normal width for UI, no mono. One accent, but it is a *variable*: the product's own colour (here, a car's paint) drives buttons, underlines, dots and the hero material, and switching it tweens the whole page. Surfaces are matte; the only gloss is a real-time painted panel in the hero. Pills for controls, 14px radii for cards, pointer-tracked sparkle on hover. Motion is slow and physical (400–700ms, cubic-bezier(.2,.7,.1,1)).
