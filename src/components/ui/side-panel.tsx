"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { cx } from "@/lib/format";

/**
 * A right-hand panel beside the page on desktop (A3c): the BottomSheet's tile
 * plate turned on its side, but non-modal. No scrim, no focus trap; the page
 * stays interactive beside it, so you can ask about what you're looking at.
 * Esc closes it from inside, and focus goes back to whatever opened it.
 *
 * One panel at a time, by key. The open key is a cookie (`ls-panel`) like the
 * rail's, so the panel is still open after a navigation that remounts the
 * shell and renders open on the server with no flash. Below 1081px there is
 * no panel: callers send the reader to the full page instead
 * (`useSidePanel().available`).
 */

type PanelState = {
  /** The open panel's key, or null. */
  openKey: string | null;
  /** What the opener passed (for the agent: what you're asking about). */
  payload: unknown;
  open: (key: string, payload?: unknown) => void;
  close: () => void;
  toggle: (key: string) => void;
  /** Whether a panel with this key is on the page and the screen is wide enough. */
  available: (key: string) => boolean;
  register: (key: string) => () => void;
};

const PanelContext = createContext<PanelState | null>(null);

/** The desktop boundary: the rail and the panel exist only at or above it. */
const DESKTOP_QUERY = "(min-width: 1081px)";

function subscribeDesktop(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function remember(key: string | null) {
  document.cookie = key ? `ls-panel=${key}; path=/; max-age=86400; SameSite=Lax` : "ls-panel=; path=/; max-age=0; SameSite=Lax";
}

export function SidePanelProvider({ initialOpen = null, children }: { initialOpen?: string | null; children: ReactNode }) {
  const [openKey, setOpenKey] = useState<string | null>(initialOpen);
  const [payload, setPayload] = useState<unknown>(null);
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set());
  const opener = useRef<HTMLElement | null>(null);

  const open = useCallback((key: string, next?: unknown) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpenKey(key);
    setPayload(next ?? null);
    remember(key);
  }, []);
  const close = useCallback(() => {
    setOpenKey(null);
    setPayload(null);
    remember(null);
    opener.current?.focus();
    opener.current = null;
  }, []);
  const toggle = useCallback((key: string) => (openKey === key ? close() : open(key)), [openKey, open, close]);
  const available = useCallback(
    (key: string) => keys.has(key) && typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches,
    [keys],
  );
  const register = useCallback((key: string) => {
    setKeys((current) => new Set(current).add(key));
    return () =>
      setKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
  }, []);

  const value = useMemo(() => ({ openKey, payload, open, close, toggle, available, register }), [openKey, payload, open, close, toggle, available, register]);
  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}

/** The shell's panel controls; a harmless no-op outside a provider. */
export function useSidePanel(): PanelState {
  return (
    useContext(PanelContext) ?? {
      openKey: null,
      payload: null,
      open: () => {},
      close: () => {},
      toggle: () => {},
      available: () => false,
      register: () => () => {},
    }
  );
}

export function SidePanel({
  panelKey,
  label,
  title,
  actions,
  className,
  children,
}: {
  panelKey: string;
  /** Accessible name for the panel region. */
  label: string;
  /** The panel's heading. */
  title: ReactNode;
  /** Beside the heading, before Close: a link to the full page, say. */
  actions?: ReactNode;
  className?: string;
  /** Mounted on first open and kept while closed, so a conversation in it
   *  keeps its place. */
  children: ReactNode;
}) {
  const { openKey, close, register } = useSidePanel();
  const isOpen = openKey === panelKey;
  // Mounted once it's open on a screen wide enough to show it: a phone that
  // carries the cookie over never builds a panel it can't see.
  const wide = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP_QUERY).matches, () => false);
  const [seen, setSeen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  if (isOpen && wide && !seen) setSeen(true);

  useEffect(() => register(panelKey), [panelKey, register]);
  // Focus moves in when someone opens it, not when a page loads with it
  // already open (that would steal focus from the page on every visit).
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    if (isOpen && !wasOpen.current) heading.current?.focus({ preventScroll: true });
    wasOpen.current = isOpen;
  }, [isOpen]);

  return (
    <aside
      className={cx("sidepanel", className)}
      aria-label={label}
      hidden={!isOpen}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className="sidepanel__head">
        <h2 ref={heading} tabIndex={-1} className="sidepanel__title">
          {title}
        </h2>
        {actions}
        <button type="button" className="sidepanel__close" onClick={close}>
          Close
        </button>
      </div>
      <div className="sidepanel__body">{seen && children}</div>
    </aside>
  );
}
