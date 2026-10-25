"use client";

import { Badge, Button, ButtonLink, useSidePanel } from "@/components/ui";

import type { AgentAboutRef } from "./agent-panel";

/**
 * "Ask your agent" in an object's action row (A3c): on desktop it opens the
 * agent beside the page, about this listing or car; on a phone, or without
 * the panel, it goes to /agent with the same context chip, and Back returns.
 *
 * With `disabledReason` (AG-7: the member set their agent to Off) it is a
 * disabled button that says why, instead of a link to a page that refuses.
 */
export function AskAgentButton({
  about,
  className,
  disabledReason = null,
}: {
  about: AgentAboutRef;
  className?: string;
  /** Why the agent can't be asked right now — "Agent is off in Settings." */
  disabledReason?: string | null;
}) {
  const panel = useSidePanel();
  if (disabledReason) {
    return (
      <span className={["inline-grid gap-1", className].filter(Boolean).join(" ")}>
        <span className="inline-flex items-center gap-2">
          <Button variant="ghost" disabled aria-describedby="ask-agent-disabled">
            Ask your agent
          </Button>
          <Badge>Beta</Badge>
        </span>
        <span id="ask-agent-disabled" className="field__hint !mt-0">
          {disabledReason}
        </span>
      </span>
    );
  }
  return (
    <span className={["inline-flex items-center gap-2", className].filter(Boolean).join(" ")}>
      <ButtonLink
        href={`/agent?about=${about.kind}:${about.id}`}
        variant="ghost"
        className={className?.includes("w-full") ? "flex-1" : undefined}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || !panel.available("agent")) return;
          event.preventDefault();
          panel.open("agent", about);
        }}
      >
        Ask your agent
      </ButtonLink>
      <Badge>Beta</Badge>
    </span>
  );
}
