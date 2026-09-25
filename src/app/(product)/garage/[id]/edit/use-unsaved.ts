"use client";

import { useEffect } from "react";

/**
 * The manage page has one Save per section (details, the build, the
 * showcase), so editing two sections and saving one quietly dropped the
 * other. Each section marks itself "Unsaved changes" and, while it is dirty,
 * leaving the page asks first — the browser's own prompt, not a dialog.
 */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers still need returnValue set to show the prompt.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}
