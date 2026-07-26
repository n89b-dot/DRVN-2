"use client";

import { useEffect, useRef } from "react";

/** The classic Konami sequence; letter keys are matched case-insensitively. */
const KONAMI_SEQUENCE: readonly string[] = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

/**
 * Fires `onUnlock` whenever the user types the Konami code. Matching is
 * forgiving: a wrong key restarts from the most plausible position so the user
 * can recover mid-sequence instead of starting completely over.
 *
 * @param onUnlock - Called each time the full sequence is entered.
 */
export function useKonamiCode(onUnlock: () => void): void {
  // Hold the latest callback in a ref so the listener stays bound once while
  // always invoking the freshest closure.
  const onUnlockRef = useRef(onUnlock);

  useEffect(() => {
    onUnlockRef.current = onUnlock;
  }, [onUnlock]);

  useEffect(() => {
    let matchedCount = 0;

    const handleKeyDown = (event: KeyboardEvent) => {
      const expectedKey = KONAMI_SEQUENCE[matchedCount];
      const pressedKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;

      if (pressedKey === expectedKey) {
        matchedCount += 1;
        if (matchedCount === KONAMI_SEQUENCE.length) {
          matchedCount = 0;
          onUnlockRef.current();
        }
        return;
      }

      matchedCount = pressedKey === KONAMI_SEQUENCE[0] ? 1 : 0;
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
