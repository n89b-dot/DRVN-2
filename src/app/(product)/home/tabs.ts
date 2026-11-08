/** H-1. One feed, three ways of asking for it. */
export type HomeTab = "following" | "foryou" | "local";

export const HOME_FEED_PAGE_SIZE = 12;

/**
 * H-1: Following · For you, plus the member's own place once they have said
 * where they are (H-2). Following comes first — it is Home's own tab.
 */
export function homeTabs(placeLabel?: string | null): { key: HomeTab; label: string }[] {
  return [
    { key: "following", label: "Following" },
    { key: "foryou", label: "For you" },
    ...(placeLabel ? [{ key: "local" as const, label: placeLabel }] : []),
  ];
}

/** The tab Home opens on when the address names none. */
export function defaultHomeTab(followsNothing: boolean): HomeTab {
  // Someone who follows nobody opens on For you: an empty Following tab is a
  // true answer and a useless first screen.
  return followsNothing ? "foryou" : "following";
}

/**
 * Which tab the address asks for. An explicit Following or For you is
 * honoured; Local only exists with a place; anything else is the default.
 */
export function resolveHomeTab(
  tabParam: string | undefined,
  { followsNothing, hasPlace }: { followsNothing: boolean; hasPlace: boolean }
): HomeTab {
  if (tabParam === "following" || tabParam === "foryou") return tabParam;
  if (tabParam === "local" && hasPlace) return "local";
  return defaultHomeTab(followsNothing);
}

/** The default tab needs no parameter, so a bare /home stays shareable. */
export function homeTabHref(key: HomeTab, followsNothing: boolean): string {
  return key === defaultHomeTab(followsNothing) ? "/home" : `/home?tab=${key}`;
}
