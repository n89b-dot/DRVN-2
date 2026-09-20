"use client";

import { use, type ReactNode } from "react";

export type ShellCounts = {
  cartCount: number;
  unreadCount: number;
  offersCount: number;
  /** Conversations with something unread (N-5), not individual messages. */
  messagesCount: number;
};

/** Only the count-dependent navigation suspends; page content stays visible. */
export function StreamedShellCounts({ counts, children }: {
  counts: Promise<ShellCounts>;
  children: (counts: ShellCounts) => ReactNode;
}) {
  return children(use(counts));
}
