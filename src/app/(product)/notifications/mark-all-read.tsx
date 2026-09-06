"use client";

import { useState, useTransition } from "react";

import { markAllNotificationsRead } from "./actions";

export function MarkAllRead() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function markAll() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await markAllNotificationsRead();
        if ("error" in result) setError(result.error);
      } catch {
        setError("Couldn't mark notifications as read. Try again.");
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={markAll}
        className="relbtn !static"
      >
        {pending ? "Clearing…" : "Mark all as read"}
      </button>
      {error && <p role="alert" aria-live="polite" className="field__err mt-2">{error}</p>}
    </div>
  );
}
