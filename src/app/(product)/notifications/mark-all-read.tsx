"use client";

import { useTransition } from "react";

import { markAllNotificationsRead } from "./actions";

export function MarkAllRead() {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => markAllNotificationsRead())}
      className="relbtn !static"
    >
      {pending ? "Clearing…" : "Mark all as read"}
    </button>
  );
}
