"use client";

import Link from "next/link";
import { unstable_rethrow, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge, ButtonLink, SidePanel, SkeletonRows, useSidePanel } from "@/components/ui";

import { AgentChat } from "./agent-chat";
import { AGENT_CHAT_CLEARED, AGENT_MODE_SAVED, useAgentEvent } from "./chat-events";
import { openAgentChat, type ChatMessage } from "./chat";
import type { ChatAbout } from "./chat-load";

/** What an opener passes: the listing or car you're looking at. */
export type AgentAboutRef = { kind: "listing" | "car"; id: string };

/**
 * The agent beside the page on desktop (A3c design 02): the same thread as
 * /agent in a non-modal SidePanel, opened from the rail's Agent row or an
 * object's "Ask your agent". It loads when first opened and keeps its place
 * while closed. Rendered by the layouts only when the chat step is open.
 */
export function AgentPanel() {
  const { payload } = useSidePanel();
  // /agent is the same thread full width: no second copy beside it.
  const pathname = usePathname();
  if (pathname === "/agent" || pathname.startsWith("/agent/")) return null;
  const ref = (payload as AgentAboutRef | null) ?? null;
  const fullHref = ref ? `/agent?about=${ref.kind}:${ref.id}` : "/agent";
  return (
    <SidePanel
      panelKey="agent"
      label="Your agent"
      title={
        <>
          Agent <Badge>Beta</Badge>
        </>
      }
      actions={
        <ButtonLink href={fullHref} variant="quiet">
          Full page
        </ButtonLink>
      }
    >
      <PanelThread aboutRef={ref} />
    </SidePanel>
  );
}

/** Exported for its test; the layouts render AgentPanel. */
export function PanelThread({ aboutRef }: { aboutRef: AgentAboutRef | null }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [about, setAbout] = useState<ChatAbout | null>(null);
  const [jobs, setJobs] = useState(false);
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  // AG-7: the member's agent is Off in Settings.
  const [disabled, setDisabled] = useState<string | null>(null);
  // A new agent setting saved in Settings: load again, so a panel opened
  // under Off works once it is back on (and says so if it went Off).
  const [loads, setLoads] = useState(0);
  useAgentEvent(AGENT_MODE_SAVED, () => setLoads((n) => n + 1));
  // Cleared anywhere: drop the copy the panel keeps for its next open.
  useAgentEvent(AGENT_CHAT_CLEARED, () => setMessages((current) => (current ? [] : current)));
  const key = aboutRef ? `${aboutRef.kind}:${aboutRef.id}` : "";

  useEffect(() => {
    let live = true;
    openAgentChat(aboutRef)
      .then((result) => {
        if (!live) return;
        if (!result) return setFailed(true);
        if ("disabled" in result) return setDisabled(result.disabled);
        setDisabled(null);
        setFailed(false);
        // The thread as stored now: a remount after Off, or a clear, starts
        // from it. A mounted AgentChat keeps its own copy meanwhile.
        setMessages(result.messages);
        setAbout(result.about);
        setJobs(result.jobs);
        setUserId(result.userId);
      })
      .catch((error) => {
        unstable_rethrow(error);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
    // Re-read when the opener changes what it's about, or a setting is saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loads]);

  if (disabled) {
    return (
      <p className="field__hint mt-4">
        {disabled}{" "}
        <Link href="/settings#agent" className="jumplink">
          Change it →
        </Link>
      </p>
    );
  }
  if (failed) return <p className="field__hint mt-4">Couldn&apos;t open your agent here. Try the full page.</p>;
  if (!messages) return <SkeletonRows rows={3} />;
  return <AgentChat initial={messages} about={about} jobs={jobs} userId={userId} />;
}
