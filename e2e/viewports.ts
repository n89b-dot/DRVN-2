/**
 * The production mobile verification matrix — the named device profiles
 * every mobile contract runs against (SYS-01). Specs import these instead
 * of scattering ad-hoc `{ width, height }` literals.
 *
 * `compactShort` is the stress profile (constrained height); `phone` is the
 * primary production reference; `phoneLarge` guards against compact anatomy
 * turning sparse. 375×812 remains in the older specs deliberately —
 * transitional coverage, not a fourth target.
 */
export const VIEWPORTS = {
  compactShort: { width: 320, height: 568 },
  phone: { width: 390, height: 844 },
  phoneLarge: { width: 430, height: 932 },
  tabletPortrait: { width: 768, height: 1024 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

/** Phone-tier profiles — the three the acceptance criteria name. */
export const PHONE_TIERS = ["compactShort", "phone", "phoneLarge"] as const;

/**
 * Widths either side of every documented anatomy transition (see
 * docs/site/material.md §2): compact 640, handheld/tabstrip 760/768, PDP
 * split + buybar 980/981, wide buybar 1023/1024, register rail 1080/1081.
 */
export const TRANSITION_PROBES = [639, 640, 641, 759, 760, 761, 767, 768, 769, 979, 980, 981, 1023, 1024, 1025, 1079, 1080, 1081] as const;
