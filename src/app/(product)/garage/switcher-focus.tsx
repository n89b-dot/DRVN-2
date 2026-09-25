"use client";

import { useEffect } from "react";

/**
 * Brings the selected car's chip fully into view inside the switcher strip.
 * With two or three cars the chosen one could sit half under the strip's
 * edge fade after switching — the page changed, but the strip didn't show
 * which car it changed to. Scrolls the strip only (`inline: "nearest"`,
 * `block: "nearest"`), never the page.
 */
export function SwitcherFocus({ carId }: { carId?: string }) {
  useEffect(() => {
    const chip = document.querySelector<HTMLElement>(".garageswitch .fbtn[aria-current='true']");
    const strip = chip?.parentElement;
    if (!chip || !strip || strip.scrollWidth <= strip.clientWidth) return;
    const c = chip.getBoundingClientRect();
    const s = strip.getBoundingClientRect();
    // Some margin so the edge fade doesn't cover the one you picked.
    if (c.right > s.right - 32) strip.scrollBy({ left: c.right - s.right + 48, behavior: "instant" });
    else if (c.left < s.left) strip.scrollBy({ left: c.left - s.left - 16, behavior: "instant" });
  }, [carId]);
  return null;
}
