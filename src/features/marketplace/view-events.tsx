"use client";

import { useEffect } from "react";
import { recordMarketplaceView, type MarketplaceView } from "./view-events-actions";

/** Only a visible, mounted page records a view. Prefetch and server retries do
 * not run this effect; refresh/Back within five minutes reuse the same view. */
export function MarketplaceViewEvent({ entry, viewKey }: { entry: MarketplaceView; viewKey: string }) {
  const encoded = JSON.stringify(entry);
  useEffect(() => {
    let sent = false;
    const record = () => {
      if (sent || document.visibilityState !== "visible") return;
      sent = true;
      const key = `drvn-marketplace-view:${viewKey}`;
      try {
        const last = Number(sessionStorage.getItem(key) ?? 0);
        if (Date.now() - last < 300_000) return;
        sessionStorage.setItem(key, String(Date.now()));
      } catch { /* Browsing still works when browser storage is unavailable. */ }
      void recordMarketplaceView(JSON.parse(encoded) as MarketplaceView).catch(() => {});
    };
    record();
    document.addEventListener("visibilitychange", record);
    return () => document.removeEventListener("visibilitychange", record);
  }, [encoded, viewKey]);
  return null;
}
