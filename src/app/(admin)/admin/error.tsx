"use client";

import { useEffect } from "react";

import { Alert, Button, ButtonLink } from "@/components/ui";

/**
 * A console page whose read failed. The read layer throws rather than
 * rendering an unread queue or total as 0 (src/lib/admin/queries.ts); this
 * keeps that failure inside the console, under its nav, instead of the
 * product's error page.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin-route-error]", error);
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
    <div>
      <Alert ico="⚠" title="This page couldn't be loaded" role="alert">
        A read failed, so nothing here is shown rather than a figure that might be wrong. It&apos;s
        been logged.
        {error.digest && (
          <>
            {" "}
            <span className="mono text-dim">ref {error.digest}</span>
          </>
        )}
      </Alert>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button variant="live" onClick={reset}>
          Try again
        </Button>
        <ButtonLink variant="ghost" href="/admin">
          Back to Operations
        </ButtonLink>
      </div>
    </div>
  );
}
