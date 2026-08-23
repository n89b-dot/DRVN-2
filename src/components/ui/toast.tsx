"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/**
 * The `.toast` CSS existed with no React consumer — this is the consumer.
 * Renders the fixed bottom-center toast and animates it in on mount, out
 * after `duration`. Mount it conditionally (`{msg && <Toast .../>}`) with a
 * `key` when the message can repeat back-to-back.
 *
 * Portalled to `<body>` on purpose. `position: fixed` is only viewport-fixed
 * while no ancestor establishes a containing block — and `container-type`
 * does establish one. A toast raised from inside a marketplace card
 * (`.mcell` is `container-type: inline-size`) was therefore pinned to the
 * *card*, landing on top of the card's own buttons instead of at the bottom
 * of the screen. The portal takes it out of any such ancestor, so one
 * component works from anywhere.
 */
const subscribeNever = () => () => {};

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

  // `document` doesn't exist during the server pass. useSyncExternalStore
  // is the SSR-safe way to ask "am I on the client?" without setting state
  // from an effect: the server snapshot is false, the client snapshot true,
  // and nothing ever changes after that (the subscribe is a no-op).
  const onClient = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  const node = (
    <output aria-live="polite" className={`toast ${shown ? "is-shown" : ""}`}>
      {message}
    </output>
  );
  return onClient ? createPortal(node, document.body) : null;
}
