# GLANCE — Concept 15

**Thesis:** "Selling parts should feel like checking your phone." Family: era-media (smartphone home/lock-screen grammar ported to the web marketplace). Pure-black OLED void; separation by surface tone only (no borders, no shadows); one signal red (#FF2D1A) reserved for live/urgent chips and dots; giant tight grotesque numerals beside tiny mono microtext; bracketed mono buttons; cosmic imagery inside widgets under scrims; iOS status-bar furniture as texture.

**Pages:** index (home-screen glance deck) · market (app grid + listing widget rows, live filter) · listing (widget stack + 2-step confirm sheet) · car (client scope addition: public car profile as a phone home screen for one machine — hero tile, live-activity watchers capsule, giant-numeral stats, working follow toggle, for-sale app tiles) · alerts (notification center as commerce surface).

**Precedents:** eBay iOS notification center (SELLER OFFER cards with countdowns + inline accept/counter) https://mobbin.com/screens/69597ed5-af63-40fc-b8bc-c78ab87a14e6 · Tinder "Boost in progress" live-activity capsule with big timer https://mobbin.com/screens/4a0eba7a-671c-4c68-a266-1b4ff74cac0b · Citizen dark notification stack https://mobbin.com/screens/466c0bbd-4593-4ca8-a116-68e2f29d7381.

**Showpiece:** the index home-screen deck — drifting orbital Earth video under spring-staggered live widgets (scale-from-0.96 entrance), with a working LIVE! offer capsule ticking down in real time.

**Motion:** `../assets/c15-motion-hero.mp4` (10s orbital Earth loop) as index backdrop, poster `c15-hero-earth.png`; prefers-reduced-motion pauses the video to poster and disables all entrance/spring animation. Video absent at build time — poster fallback verified.

**Flaw-hunt pass:** caught and fixed an invalid inline style on the index footer (`flex-wrap:gap` typo); `c15-part-wheel.png` was not yet rendered, so both references carry `onerror` fallbacks (tile tone / mono glyph); confirmed the alerts accept/counter handlers rewrite the correct card only, and that the confirm sheet's offer path swaps both the mode label and the final confirmation line. Known compromise: countdowns are session-local (reset on reload) — right for a prototype, noted for production.

**Style emulation:** Void-black page, tiles at #0A0A0B/#101012 separated only by black space, radius 24px (999px capsules). Inter 700–800 at -0.04em tracking for display lines and giant numerals; JetBrains Mono 11px uppercase +0.08em for every label, key-value row, and [ BRACKETED ] button. Red #FF2D1A appears only as chips, alert dots, and a single live day-pill — never as a fill or headline. Imagery sits inside widgets under a bottom scrim. Motion is iOS-physics: cubic-bezier(.32,.72,0,1), 300–450ms, widgets entering at scale .96 with ~55ms stagger; a top-center dynamic-island nav expands on hover/scroll-up. Copy is editorial-brutal, short imperative lines ("Your move. Buyers are watching.").
