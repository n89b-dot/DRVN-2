"use client";

import { useEffect } from "react";

/**
 * Pressing `/` focuses the page's search field — the read.cv-style keyboard
 * affordance for the surfaces power users live on (marketplace, console).
 * Inert while the user is already typing in any input, textarea, select or
 * contenteditable, so slashes in text stay slashes.
 */
export function SlashFocus({ selector = 'form[role="search"] input' }: { selector?: string }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT" ||
          active.isContentEditable)
      ) {
        return;
      }
      const target = document.querySelector<HTMLElement>(selector);
      if (!target) return;
      event.preventDefault();
      target.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selector]);

  return null;
}
