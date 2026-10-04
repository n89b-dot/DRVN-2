/**
 * Where a public profile — or one of its tabs — lives.
 *
 * The profile route reads `?view=`. The listing page's seller link was
 * hand-built as `?tab=parts`, which the route never read, so a personal
 * seller's store opened on Overview (R2-06). One builder, so the key can't
 * drift again; the route also accepts `?tab=` as a legacy alias, because
 * those links are already out in the world.
 */
export const PROFILE_VIEWS = ["overview", "garage", "updates", "parts", "reviews"] as const;

export type ProfileView = (typeof PROFILE_VIEWS)[number];

/**
 * The old tab keys still work (P-3). Links to `?view=forsale` are out in the
 * world — in messages, in bookmarks — and renaming a tab is not a good
 * enough reason to break them. Nothing in SQL reads these; the only other
 * consumer is profile-body's own tab list.
 */
const VIEW_ALIASES: Record<string, ProfileView> = {
  about: "overview",
  forsale: "parts",
  activity: "updates",
};

function asView(raw: string | undefined): ProfileView | undefined {
  if (!raw) return undefined;
  const key = VIEW_ALIASES[raw] ?? raw;
  return (PROFILE_VIEWS as readonly string[]).includes(key) ? (key as ProfileView) : undefined;
}

/**
 * The tab a profile URL asks for. `view` is canonical; `tab` is read only
 * when `view` is absent. Unknown values resolve to undefined (the route picks
 * the default — Overview, or Parts for a shop).
 */
export function resolveProfileView(view: string | undefined, legacyTab?: string): ProfileView | undefined {
  return view ? asView(view) : asView(legacyTab);
}

/** `/u/{username}`, or `/u/{username}?view={view}`. Overview is the bare URL. */
export function profileHref(username: string, view?: ProfileView): string {
  const base = `/u/${encodeURIComponent(username)}`;
  return view && view !== "overview" ? `${base}?view=${view}` : base;
}
