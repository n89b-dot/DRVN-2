"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Alert } from "@/components/ui";

/**
 * Route-level error boundary. Previously any thrown error landed on Next's
 * unstyled default page — off-brand and with no way back into the product.
 */
export default function RouteError({
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
      <Alert ico="⚠" title="Something went wrong" role="alert">
        This page failed to load. It&apos;s been logged — trying again usually sorts it.
        {error.digest && (
          <>
            {" "}
            <span className="mono text-dim">ref {error.digest}</span>
          </>
        )}
      </Alert>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="btn btn--live">
          Try again
        </button>
        <Link href="/" className="btn btn--ghost">
          Back to the start
        </Link>
      </div>
    </div>
  );
}
