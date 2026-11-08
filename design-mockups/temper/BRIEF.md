# 17 · Temper

**Family:** material. **Thesis:** every surface is heat-tinted titanium, so colour only appears where energy has been. At rest the site has no colour at all: graphite, raw titanium grey, bone type, and photographs in greyscale. Colour comes from one source only, a thin-film interference model of titanium oxide (air / TiO₂ / Ti, 10 wavelengths, s+p polarisation, optical path 2·n·d·cosθt, CIE 1931 to sRGB). The WebGL shader and the DOM run the same function. Heat sets the oxide thickness, and thickness sets the colour, which moves raw → straw → gold → bronze → plum → violet → cobalt → light blue. Hover, focus and press heat an element in about 120 ms; it then cools by Newtonian decay (τ 0.42 s, gone in about 1.3 s). The afterglow passes back down the whole spectrum, so the interface briefly remembers where you have been. Demand is a resting heat floor: watched listings sit visibly tempered. Live states run hot: a fitment match, a chosen car, a draft just saved.

**Precedents:** Apple product pages, where a scroll-driven hero object sits in black negative space (web) · Akrapovič product pages, where titanium heat tint is the product photography (web) · Lusion and Active Theory, for WebGL that is lit like a product shoot rather than like a demo (web) · Porsche Design product pages, for wide, quiet type next to a single object (web).

**Showpiece:** a real-time Three.js titanium exhaust, built procedurally. A double-wall rolled-lip tip (rounded LatheGeometry profile with a dark, occluded gas side) is joined to a mid-pipe (TubeGeometry along a CatmullRomCurve3) by a stacked-dime weld bead (a displaced torus). A custom ShaderMaterial does the rest:
- brushed titanium: periodic streak noise along the pipe's axis, anti-aliased with fwidth, plus anisotropic 7-tap reflections of an achromatic procedural studio;
- the thin-film oxide term, which shifts colour with view angle;
- a heat field made of three parts: a weld-hot base gradient with mottling and a hotter gas side; a cursor torch, which raycasts onto low-poly proxy meshes and lays down 24 gaussian deposits that spread with √t and cool over about 1 s, leaving a faint residue for about 9 s; and scroll, which adds heat to the whole pipe.

Other behaviour:
- An unattended torch pass runs on load and again whenever the hero sits idle.
- Fallbacks: without WebGL, `c17-hero-exhaust.jpg` shows as a poster with a scrim. Under reduced motion, one static frame renders with no torch.
- Performance: device pixel ratio is capped at 1.75, and rendering pauses when the hero is off screen or the tab is hidden.

**Motion:** c17-motion-shimmer.mp4 is used in the index sell section, as a contained 16:10 band that heats from grey to colour while in view and fades at the loop point. It is also the "Still hot" view in the part.html gallery.

**Responsive at 390px:** the nav collapses to Wordmark · Cart · Menu, and Menu opens a full-screen sheet with search (Esc closes it). The hero object moves to the top third, with the copy below and the facts row dropped. The hot grid goes to one column, and the market and store grids go to two. Filters fold behind a toggle. The part buy box stacks under the gallery. Garage stats go to 2×2 and build rows stack. No horizontal scroll (checked: scrollWidth 390).

**Deviations, logged:**
- The tips are renamed from "slash-cut" to "double-wall burnt tips". The photograph and the 3D model are both straight rolled-lip tips, and an enthusiast would spot the mismatch.
- Scroll reveals never hide content; an unreached block is only slightly lowered. Full-page captures showed opacity reveals leaving sections blank.
- The thin-film model uses 10 wavelengths rather than about 3, because three samples gave crude, garish hue jumps.

**Flaw hunt (found → fixed):**
- The first shader read as smooth chrome with colour only in highlights. Fixed with a broad studio dome, a right-side fill, visible streaks, slight tube waviness and a tighter heat gradient, so the tip is raw grey toward the lip and colour sits near the weld.
- The pipe bent up into the nav and showed its open end. Fixed with a longer, gentler curve on a diagonal.
- The headline wrapped to three lines and hit the tip. Fixed the scale and placement.
- On mobile, the headline sat on top of the object. The object now sits in the top third.
- "Ink." and its label sat on the car body. They now sit on the wet floor below the car.
- Typographic cards repeated their own title. The card title is now screen-reader only.
- The filter rail clipped "Used, good" at 900px tall. The rail is no longer sticky.
- Lazy images were blank in "More from".
- Esc failed after paying, because focus was lost on re-render.
- `?q=turbo` found nothing. Category keywords added.
- The no-WebGL poster put the headline on the bright tip. Scrim added.

**Style-emulation prompt:** Design on near-black graphite (#0C0D0F) with flat tonal surfaces: no shadows, no glass, no outlines, 2–4 px radii. Set display type in Archivo at width 125, weight 200–260, very large and quiet. Set UI in Archivo at width 100, weight 400–550. Use Martian Mono only for labels of 12px and under. Keep everything achromatic at rest and show photography in greyscale. Colour may appear only as the physically computed interference colour of titanium oxide, driven by a per-element heat value. Heat rises fast when something is attended to, a live state or demand. It cools slowly back through gold and straw to grey, and the colour is drawn from the point where energy entered. Show it as a hairline "heat-affected zone" band, a tempered border, a colour spot in the photograph, or a faint radial wash. Copy is short, specific and garage-literate.
