"use client";

import { useEffect, useRef } from "react";

/**
 * Two things one part of the page tells every mounted agent chat (the
 * thread on /agent, the side panel beside any page, Settings → Privacy):
 *
 * - the chat was cleared (N125), so a thread still showing the deleted
 *   messages, or a panel holding them for its next open, drops them;
 * - the member saved a new agent setting (AG-7), so a panel that loaded
 *   under Off reloads instead of staying disabled.
 *
 * Window events: the instances share no React parent (the panel lives in
 * the app shell), and nothing here crosses a tab, which reloads anyway.
 */
export const AGENT_CHAT_CLEARED = "drvn:agent-chat-cleared";
export const AGENT_MODE_SAVED = "drvn:agent-mode-saved";

type AgentEventName = typeof AGENT_CHAT_CLEARED | typeof AGENT_MODE_SAVED;

export function announceAgentEvent(name: AgentEventName) {
  window.dispatchEvent(new Event(name));
}

/** Run `handler` whenever `name` is announced, for as long as the caller is mounted. */
export function useAgentEvent(name: AgentEventName, handler: () => void) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const listener = () => latest.current();
    window.addEventListener(name, listener);
    return () => window.removeEventListener(name, listener);
  }, [name]);
}
