"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { ActionFooter, Button, Checkbox, TileHead } from "@/components/ui";

import {
  saveAnalyticsConsent,
  type AnalyticsConsentState,
} from "./analytics-consent-actions";

/**
 * Settings → Privacy. A section of the settings sheet like any other — it
 * used to render above the page's own head, where it read as a component
 * that had leaked onto the page.
 */
export function AnalyticsConsentForm({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [result, setResult] = useState<AnalyticsConsentState>({});
  const [pending, startTransition] = useTransition();

  return (
    <section id="privacy" className="tile">
      <TileHead label="Privacy — what this browser shares" />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          startTransition(async () => {
            setResult({});
            try {
              setResult(await saveAnalyticsConsent({}, formData));
            } catch {
              setResult({ error: "The response was interrupted. Try saving this preference again." });
            }
          });
        }}
      >
        <Checkbox
          name="analytics"
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.target.checked);
            setResult({});
          }}
          label="Allow optional product analytics in this browser"
          hint="Off by default. Shares feature usage counts to help improve DRVN — no message text, addresses, payment details or session recording. Turning this off also stops queued purchase events and analytics from your other browsers until you opt in again."
        />
        <ActionFooter
          status={
            result.error
              ? { kind: "error", message: result.error }
              : result.ok
                ? { kind: "ok", message: result.ok }
                : null
          }
        >
          <Button type="submit" loading={pending} pendingLabel="Saving…">
            Save privacy preference
          </Button>
        </ActionFooter>
      </form>
      {/* The signed-in shell has no page foot, so the policies a member
          agreed to are linked here, beside the one privacy choice. */}
      <div className="mt-4 flex flex-wrap gap-4">
        <Link href="/privacy" className="jumplink">
          Privacy policy →
        </Link>
        <Link href="/terms" className="jumplink">
          Terms of service →
        </Link>
        <Link href="/protection" className="jumplink">
          Buyer &amp; seller protection →
        </Link>
      </div>
    </section>
  );
}
