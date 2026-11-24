"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import type { createClient } from "@/lib/supabase/client";

type BrowserClient = ReturnType<typeof createClient>;

/**
 * The browser client, loaded when a component first needs it. LiveInbox is on
 * every signed-in page, so a plain import put supabase-js in the first script
 * of each one; this way it arrives after the page is up, which is when the
 * socket is opened anyway.
 */
const loadClient = (): Promise<BrowserClient> => import("@/lib/supabase/client").then((module) => module.createClient());

/**
 * Live messaging (20260928140000 adds `messages` and `conversation_unreads`
 * to the realtime publication; RLS still decides what each reader receives).
 *
 * Both components only ever call `router.refresh()` — the server render stays
 * the one source of truth for what a thread or badge shows, and client state
 * (a half-written reply) survives the refresh.
 */

/**
 * RR-16: a socket that drops and comes back missed whatever happened in
 * between, so it catches up once on recovery. Returns the `subscribe`
 * callback for a channel.
 */
function catchUpOnRecovery(refresh: () => void) {
  let down = false;
  return (status: string) => {
    if (status === "SUBSCRIBED") {
      if (down) refresh();
      down = false;
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      down = true;
    }
  };
}

/**
 * Join as the signed-in member, not as an anonymous visitor (RR-16).
 *
 * The browser client reads its session from cookies asynchronously, and a
 * channel subscribed straight away joined before that finished — with no
 * access token at all. Realtime then applied RLS as `anon`, which can't read
 * anyone's unread counters or messages, so the join "succeeded" and no event
 * ever arrived: the badge never moved and threads only updated on the
 * fallback refresh. Hand Realtime the session's token first, then subscribe.
 * (supabase-js keeps it current on TOKEN_REFRESHED/SIGNED_IN after that.)
 */
async function authorizeRealtime(supabase: BrowserClient) {
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) await supabase.realtime.setAuth(data.session.access_token);
}

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
    let supabase: BrowserClient | null = null;
    let channel: ReturnType<BrowserClient["channel"]> | null = null;
    let cancelled = false;
    if (conversationId) {
      void loadClient().then(async (client) => {
        if (cancelled) return;
        supabase = client;
        await authorizeRealtime(client);
        if (cancelled) return;
        channel = client
          .channel(`conversation:${conversationId}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
            () => refreshRef.current(),
          )
          .subscribe(catchUpOnRecovery(() => refreshRef.current()));
      });
    }
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") refreshRef.current();
    }, 20_000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, [conversationId]);

  return null;
}

/** A tab left in the background this long may have missed badge changes
 *  (a sleeping laptop drops the socket without an error). */
const STALE_AFTER_HIDDEN_MS = 60_000;

/** Keeps the rail's Messages badge current on every signed-in page. No
 *  interval here — this runs on every page — but it catches up when the
 *  socket recovers and when a long-hidden tab is shown again (RR-16). */
export function LiveInbox({ userId }: { userId: string }) {
  const refresh = useDebouncedRefresh();
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  useEffect(() => {
    let supabase: BrowserClient | null = null;
    let channel: ReturnType<BrowserClient["channel"]> | null = null;
    let cancelled = false;
    void loadClient().then(async (client) => {
      if (cancelled) return;
      supabase = client;
      await authorizeRealtime(client);
      if (cancelled) return;
      channel = client
        .channel(`unreads:${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "conversation_unreads", filter: `user_id=eq.${userId}` },
          () => refreshRef.current(),
        )
        .subscribe(catchUpOnRecovery(() => refreshRef.current()));
    });
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null) {
        if (Date.now() - hiddenAt > STALE_AFTER_HIDDEN_MS) refreshRef.current();
        hiddenAt = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, [userId]);

  return null;
}
