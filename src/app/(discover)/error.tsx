"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { Alert, Button, ButtonLink } from "@/components/ui";

/** Shopping pages exit to the marketplace; cars, posts and people to Explore. */
const SHOPPING = ["/marketplace", "/listings", "/cart", "/checkout", "/order-placed"];

export default function GroupError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  /** Re-fetches and re-renders the segment (Next 16.3) — `reset` only
   *  re-rendered, which can't recover from a failed server read. */
  retry: () => void;
}) {
  const pathname = usePathname() ?? "";
  const shopping = SHOPPING.some((root) => pathname === root || pathname.startsWith(`${root}/`));
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
        This page failed to load. It&apos;s been logged.
        {error.digest && (
          <>
            {" "}
            <span className="mono text-dim">ref {error.digest}</span>
          </>
        )}
      </Alert>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button variant="live" onClick={() => retry()}>
          Try again
        </Button>
        <ButtonLink href={shopping ? "/marketplace" : "/explore"} variant="ghost">
          {shopping ? "Back to the marketplace" : "Back to Explore"}
        </ButtonLink>
      </div>
    </div>
  );
}
