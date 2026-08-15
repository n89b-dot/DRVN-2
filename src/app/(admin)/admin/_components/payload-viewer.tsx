"use client";

import { useState } from "react";

/**
 * Shared webhook-payload presentation: collapsible top-level keys, one-click
 * copy for the ids an investigation actually needs (event / payment_intent /
 * charge), and a highlighted event-type chip. Redacts anything that looks
 * like a secret before it ever reaches the DOM — the payload is Stripe's raw
 * event body, and this is the one place the console renders it verbatim.
 */

const REDACT_KEY = /secret|token|authorization|signature|client_secret|card|account_number/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACT_KEY.test(key) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length ? v : undefined;
}

function CopyButton({ label, value }: { label: string; value?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      className="jumplink"
      title={value}
      onClick={() => {
        navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          })
          .catch(() => {});
      }}
    >
      {copied ? `${label} copied ✓` : `Copy ${label}`}
    </button>
  );
}

export function PayloadViewer({ payload, eventType }: { payload: string; eventType?: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    parsed = null;
  }

  if (!parsed || typeof parsed !== "object") {
    return (
      <pre className="mt-2 max-h-80 overflow-auto rounded-ctl bg-paper-deep p-3 text-micro leading-relaxed">
        {payload}
      </pre>
    );
  }

  const root = parsed as Record<string, unknown>;
  const dataObject = (root.data as Record<string, unknown> | undefined)?.object as
    | Record<string, unknown>
    | undefined;
  const objectType = str(dataObject?.object);
  const eventId = str(root.id);
  const paymentIntentId =
    str(dataObject?.payment_intent) ?? (objectType === "payment_intent" ? str(dataObject?.id) : undefined);
  const charges = dataObject?.charges as { data?: { id?: string }[] } | undefined;
  const chargeId = str(charges?.data?.[0]?.id) ?? (objectType === "charge" ? str(dataObject?.id) : undefined);
  const type = eventType ?? str(root.type);

  const redacted = redact(root) as Record<string, unknown>;

  return (
    <div className="mt-2">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        {type && <span className="chip chip--live">{type}</span>}
        <CopyButton label="event id" value={eventId} />
        <CopyButton label="payment_intent id" value={paymentIntentId} />
        <CopyButton label="charge id" value={chargeId} />
      </div>
      <div className="rounded-ctl bg-paper-deep p-3 text-micro leading-relaxed">
        {Object.entries(redacted).map(([key, value]) => (
          <details key={key} className="mb-1 last:mb-0">
            <summary className="cursor-pointer font-medium">{key}</summary>
            <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap">
              {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
            </pre>
          </details>
        ))}
      </div>
    </div>
  );
}
