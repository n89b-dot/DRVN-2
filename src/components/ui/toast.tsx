"use client";

import { useEffect, useState } from "react";

/**
 * The `.toast` CSS existed with no React consumer — this is the consumer.
 * Renders the fixed bottom-center toast and animates it in on mount, out
 * after `duration`. Mount it conditionally (`{msg && <Toast .../>}`) with a
 * `key` when the message can repeat back-to-back.
 */
export function Toast({
  message,
  duration = 3200,
  onDone,
}: {
  message: string;
  duration?: number;
  onDone?: () => void;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // Next frame, so the entry transition actually animates.
    const raf = requestAnimationFrame(() => setShown(true));
    const hide = setTimeout(() => setShown(false), duration);
    const done = setTimeout(() => onDone?.(), duration + 300);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(hide);
      clearTimeout(done);
    };
  }, [duration, onDone]);

  return (
    <output aria-live="polite" className={`toast ${shown ? "is-shown" : ""}`}>
      {message}
    </output>
  );
}
