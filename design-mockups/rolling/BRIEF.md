# Rolling

**Thesis.** Built to be driven. Family: *emotion*. The feeling is release: the first drive after the build. Every other car site photographs cars parked; this one is a rolling shot, where the car stays sharp and the world streaks past, and your scroll is the throttle. Parts are framed as things that came off cars that get used, with the miles on them.

**Precedents.** Rolling-shot photography (Larry Chen, Speedhunters) where a slow shutter from a chase car blurs everything but the subject; manufacturer configurator "drive mode" videos; Strava-style weekly totals for the "driven this week" cards. Grounded by direct reference rather than Mobbin this session.

**Showpiece.** The shot (`rolling.js`, `buildShot`). A background plane with a 14-tap directional blur shader whose strength follows smoothed scroll velocity and is stronger near the ground, panning continuously (mirrored repeat) so the car is always moving; a Supra cutout that squats a few degrees under acceleration; and the Higgsfield image-to-3D wheel mesh instanced on both hubs, axle auto-detected from its bounding box and spun by distance travelled over wheel radius. Three Higgsfield road plates (mountain, estate, coast) crossfade on a pill switch. Idle cruise reads about 28 mph on the live speedo; scrolling hard passes 100. Reduced motion stops the pan and the blur and hides the speedo; no WebGL shows the plate and the car still.

**Motion.** No commissioned video; the velocity shader, wheel spin and plate crossfade are the motion.

**Interactions.** Scroll-velocity throttle with live speedo, plate switch, driven-this-week cards with a panning hover, parts rail with buy sheet, sell form with done state, small-screen menu.

**Flaw hunt.** Found: the headline sat over the car's rear wheel at 1440; moved the copy to the top-left like a spread and the speedo and plate switch to the bottom corners so the car owns the lower half. Checked: the GLB's thin axis is detected rather than assumed, so a differently oriented mesh still faces the camera.

**Style-emulation prompt.** Daylight sky-grey canvas (#EDEFF0), tarmac near-black, Familjen Grotesk with italics used for words and numbers that move. One accent, road-marking yellow (#F7C948), reserved for speed and the primary action. Corners crisp (4px), cards white on grey, hover states pan photographs sideways like a camera following a car. The hero is always moving even when idle; the rest of the page is still. Section reveals slide in from the left, the direction of travel.
