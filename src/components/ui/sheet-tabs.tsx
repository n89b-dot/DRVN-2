"use client";

import { useCallback, useRef, useState } from "react";

export type SheetTab = {
  key: string;
  label: string;
  /** Rendered as a mono suffix; `live` paints it in the signal colour. */
  count?: number | null;
  live?: boolean;
  panel: React.ReactNode;
};

/**
 * Real tabs — panel switching, not scroll anchoring.
 *
 * Why URL-backed (`?view=…`) rather than plain client state: these are public,
 * server-rendered pages whose whole purpose is to be linked to. "Look at the
 * activity on this car" has to survive being pasted into a message, linked from
 * a notification, or bookmarked, and the back button has to behave. The server
 * reads the same parameter and renders the right panel unhidden, so a deep link
 * is correct on first paint with no flash and no JS.
 *
 * Switching uses `history.replaceState`, which the App Router reads back
 * natively — `router.replace` would round-trip the server on every tab click
 * because the App Router has no shallow routing, and `router.push` would fill
 * the back stack with tab changes.
 *
 * Every panel is rendered into the HTML regardless of which is active, so
 * crawlers and in-page find see the whole sheet. Inactive panels use the
 * `hidden` attribute, which makes them properly inert for assistive tech.
 *
 * Note on the pre-tab `#about` / `#activity` anchors: a fragment is never sent
 * to the server, so it cannot select a panel during SSR, and reading it on the
 * client to correct the selection would mean a cascading re-render on every
 * mount. Those anchors were in-page jump links rather than shared URLs, so
 * callers should accept an alias on `?view=` instead (see the car sheet).
 */
export function SheetTabs({
  tabs,
  initialTab,
  paramName = "view",
  label,
}: {
  tabs: SheetTab[];
  initialTab?: string;
  paramName?: string;
  label: string;
}) {
  const keys = tabs.map((t) => t.key);
  const fallback = keys[0];
  const [active, setActive] = useState(() =>
    initialTab && keys.includes(initialTab) ? initialTab : fallback
  );
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = useCallback(
    (key: string, { focus = false }: { focus?: boolean } = {}) => {
      setActive(key);

      const url = new URL(window.location.href);
      if (key === fallback) url.searchParams.delete(paramName);
      else url.searchParams.set(paramName, key);
      url.hash = "";
      window.history.replaceState(null, "", url);

      const el = tabRefs.current[key];
      if (focus) el?.focus();
      // On a phone the strip is one scrolling line, so arrowing past the
      // visible edge would otherwise select a tab the user can't see. `nearest`
      // is a no-op when the tab is already in view — which is every click, and
      // every width wide enough not to scroll. Left at the default instant
      // behaviour deliberately: a motion-reduced user still needs the tab.
      el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
    [fallback, paramName]
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const index = keys.indexOf(active);
    let next: number | null = null;

    if (event.key === "ArrowRight") next = (index + 1) % keys.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + keys.length) % keys.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = keys.length - 1;
    else return;

    event.preventDefault();
    select(keys[next], { focus: true });
  }

  return (
    <>
      <div className="tabstrip" role="tablist" aria-label={label}>
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`tab-${tab.key}`}
              aria-controls={`panel-${tab.key}`}
              aria-selected={isActive}
              // Roving tabindex: the whole strip is one tab stop.
              tabIndex={isActive ? 0 : -1}
              ref={(el) => {
                tabRefs.current[tab.key] = el;
              }}
              onClick={() => select(tab.key)}
              onKeyDown={onKeyDown}
              className="fbtn"
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className={tab.live ? "n n--live" : "n"}>{tab.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`panel-${tab.key}`}
          aria-labelledby={`tab-${tab.key}`}
          tabIndex={0}
          hidden={tab.key !== active}
        >
          {tab.panel}
        </div>
      ))}
    </>
  );
}

/** Validates a `?view=` value server-side so the right panel renders on first paint. */
export function resolveTab(value: unknown, keys: string[]): string {
  return typeof value === "string" && keys.includes(value) ? value : keys[0];
}
