"use client";

import { useState, useTransition } from "react";

import {
  saveAnalyticsConsent,
  type AnalyticsConsentState,
} from "./analytics-consent-actions";

export function AnalyticsConsentForm({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [result, setResult] = useState<AnalyticsConsentState>({});
  const [pending, startTransition] = useTransition();

  return (
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
      className="my-6 border-b border-[color:var(--rule-soft)] pb-4"
    >
      <h2 className="microlabel">Privacy</h2>
      <label className="flex items-center gap-3 py-3">
        <input
          type="checkbox"
          name="analytics"
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.target.checked);
            setResult({});
          }}
        />
        Allow optional product analytics in this browser
      </label>
      <p className="order__meta">
        Off by default. Shares feature usage counts to help improve DRVN. No message text,
        addresses, payment details or session recording. Turning this off also stops queued
        purchase events and analytics from your other browsers until you opt in again.
      </p>
      <button type="submit" disabled={pending} className="relbtn mt-3">
        {pending ? "Saving…" : "Save privacy preference"}
      </button>
      {result.error && (
        <p role="alert" aria-live="polite" className="field__err mt-2">
          {result.error}
        </p>
      )}
      {result.ok && (
        <p role="status" aria-live="polite" className="field__hint mt-2">
          {result.ok}
        </p>
      )}
    </form>
  );
}
