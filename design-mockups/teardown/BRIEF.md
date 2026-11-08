# Teardown

**Thesis.** Pull the car apart; everything that comes off is for sale. Family: *interaction*. The ritual of a teardown is the product: scrolling is disassembly, and a listing is simply a part that has come off. The page's whole first act is a car coming apart under your thumb, with prices appearing as parts detach, ending in a knolled layout that is also the marketplace.

**Precedents.** Apple's exploded-view product films and the "knolling" photography grammar (Todd McLellan's *Things Come Apart*); iFixit teardown pages where each step reveals a component with its own part listing; Bring a Trailer's photo-first auction listings for the drawer. Grounded by direct reference rather than Mobbin this session.

**Showpiece.** The stage (`teardown.js`, `buildStage`). Three.js planes with background-removed Higgsfield cutouts; each part has a home position inside the car, an exploded vector and a grid slot, and its own window on the scroll timeline so they come off one at a time. Parts fade in as they detach (they do not exist until they are off), tags are projected from world space, the car ghosts back, and from 62% to 95% everything settles into a 4×2 (or 2×4) grid. Pointer tilt, raycast hover with tag highlight, click to drawer. Reduced motion jumps straight to the laid-out grid; no WebGL shows the car still.

**3D.** `teardown-wheel.glb` is a textured PBR mesh generated with Higgsfield's image-to-3D from the concept's own wheel photo, shown in a RoomEnvironment-lit viewer with drag-to-turn and inertia.

**Motion.** No commissioned video; the scroll stage and the 3D viewer are the motion.

**Interactions.** Scroll disassembly with live "parts off" count and running total, hover/click parts, reserve drawer with a 24-hour done state, teardowns-in-progress cards, 3D viewer drag, start-a-teardown form, small-screen menu.

**Flaw hunt.** Found: parts were drawn on top of the car before they had come off (both transparent, parts had higher render order). Fixed by fading parts in with their own timeline window and dropping their render order until they detach. Found: the first exploded layout put the wheel and exhaust under the headline; moved the exploded vectors right and up so the bottom-left stays clear for the title beats.

**Style-emulation prompt.** Cool pale studio grey (#E6E8EA) like a seamless cyclorama, near-black ink, Geist for everything with Geist Mono only for 11px labels. One accent (cobalt #1F3FFF) that only ever means money or live. Corners are crisp (3px, 8px on cards), depth comes from soft contact shadows under photographic cutouts rather than borders. Motion is scroll-owned: objects move because you scrolled, never on a loop. Tags are small translucent cards projected next to the thing they price.
