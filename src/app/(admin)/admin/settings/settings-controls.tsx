"use client";

import { useActionState, useCallback, useRef, useSyncExternalStore } from "react";

import { Icon } from "@/components/ui/icons";
import { adminSendTestAlert } from "@/lib/admin/actions";

/**
 * The two live controls on the Settings page. Everything else there is
 * deliberately read-only — these are the settings that are actually settable
 * from a browser.
 */

/** Same DOM-truth theme plumbing as the nav toggle (and LivesheetBar). */
export function ThemeSetting({ initialNight }: { initialNight: boolean }) {
  const listeners = useRef(new Set<() => void>());
  const subscribe = useCallback((cb: () => void) => {
    const set = listeners.current;
    set.add(cb);
    return () => set.delete(cb);
  }, []);
  const night = useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.theme === "dark",
    () => initialNight,
  );
  const toggle = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "day" : "night";
    if (next === "night") {
      document.documentElement.dataset.theme = "dark";
    } else {
      delete document.documentElement.dataset.theme;
    }
    document.cookie = `ls-theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
    listeners.current.forEach((cb) => cb());
  };
  return (
    <button type="button" className="btn" onClick={toggle} aria-pressed={night}>
      <Icon name={night ? "moon" : "sun"} className="h-[15px] w-[15px]" />
      {night ? "Dark" : "Light"}
    </button>
  );
}

export function TestAlertButton({ configured }: { configured: boolean }) {
  const [state, formAction, pending] = useActionState(adminSendTestAlert, null);
  return (
    <form action={formAction}>
      <button
        type="submit"
        className="btn"
        disabled={!configured || pending}
        title={configured ? undefined : "Set ADMIN_ALERT_WEBHOOK_URL first"}
      >
        {pending ? "Sending…" : "Send test alert"}
      </button>
      {state?.ok && <p className="order__meta mt-1 text-ok">{state.ok}</p>}
      {state?.error && <p className="order__meta mt-1 text-live">{state.error}</p>}
    </form>
  );
}
