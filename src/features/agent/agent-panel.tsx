"use client";

import { unstable_rethrow, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge, ButtonLink, SidePanel, SkeletonRows, useSidePanel } from "@/components/ui";

import { AgentChat } from "./agent-chat";
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

function PanelThread({ aboutRef }: { aboutRef: AgentAboutRef | null }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [about, setAbout] = useState<ChatAbout | null>(null);
  const [jobs, setJobs] = useState(false);
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const key = aboutRef ? `${aboutRef.kind}:${aboutRef.id}` : "";

  useEffect(() => {
    let live = true;
    openAgentChat(aboutRef)
      .then((result) => {
        if (!live) return;
        if (!result) return setFailed(true);
        setMessages((current) => current ?? result.messages);
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
    // Re-read only when the opener changes what it's about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (failed) return <p className="field__hint mt-4">Couldn&apos;t open your agent here. Try the full page.</p>;
  if (!messages) return <SkeletonRows rows={3} />;
  return <AgentChat initial={messages} about={about} jobs={jobs} userId={userId} />;
}
