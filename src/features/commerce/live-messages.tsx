"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

/**
 * Live messaging (20260928140000 adds `messages` and `conversation_unreads`
 * to the realtime publication; RLS still decides what each reader receives).
 *
 * Both components only ever call `router.refresh()` — the server render stays
 * the one source of truth for what a thread or badge shows, and client state
 * (a half-written reply) survives the refresh.
 */

function useDebouncedRefresh() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 200);
  };
}

/** Refreshes an open conversation when a message lands or is read. Falls back
 *  to a 20-second refresh while the tab is visible, in case the socket drops. */
export function LiveConversation({ conversationId }: { conversationId: string | null }) {
  const refresh = useDebouncedRefresh();
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  useEffect(() => {
    const supabase = createClient();
    const channel = conversationId
      ? supabase
          .channel(`conversation:${conversationId}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
            () => refreshRef.current(),
          )
          .subscribe()
      : null;
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") refreshRef.current();
    }, 20_000);
    return () => {
      clearInterval(poll);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [conversationId]);

  return null;
}

/** Keeps the rail's Messages badge current on every signed-in page. */
export function LiveInbox({ userId }: { userId: string }) {
  const refresh = useDebouncedRefresh();
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`unreads:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation_unreads", filter: `user_id=eq.${userId}` },
        () => refreshRef.current(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return null;
}
