"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GroupError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route-error]", error);
    // Server-relayed Sentry capture — the DSN never ships to the browser.
    void fetch("/api/monitoring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        path: window.location.pathname,
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <div className="wrap">
      <div className="alert" role="alert">
        <span className="alert__ico" aria-hidden="true">
          ⚠
        </span>
        <h4>Something went wrong</h4>
        <p>
          This page failed to load. It&apos;s been logged.
          {error.digest && (
            <>
              {" "}
              <span className="mono text-dim">ref {error.digest}</span>
            </>
          )}
        </p>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="btn btn--live">
          Try again
        </button>
        <Link href="/marketplace" className="btn btn--ghost">
          Back to the marketplace
        </Link>
      </div>
    </div>
  );
}
