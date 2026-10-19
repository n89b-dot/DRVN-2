"use client";

import { ButtonLink, useSidePanel } from "@/components/ui";

import type { AgentAboutRef } from "./agent-panel";

/**
 * "Ask your agent" in an object's action row (A3c): on desktop it opens the
 * agent beside the page, about this listing or car; on a phone, or without
 * the panel, it goes to /agent with the same context chip, and Back returns.
 */
export function AskAgentButton({ about, className }: { about: AgentAboutRef; className?: string }) {
  const panel = useSidePanel();
  return (
    <ButtonLink
      href={`/agent?about=${about.kind}:${about.id}`}
      variant="ghost"
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || !panel.available("agent")) return;
        event.preventDefault();
        panel.open("agent", about);
      }}
    >
      Ask your agent
    </ButtonLink>
  );
}
