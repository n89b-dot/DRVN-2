"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/** Large grids prefetch only after the shopper hovers or focuses a link. */
export function IntentLink({ onMouseEnter, onFocus, prefetch, ...props }: ComponentProps<typeof Link>) {
  const [active, setActive] = useState(false);
  return <Link {...props} prefetch={prefetch === false ? false : active ? null : false}
    onMouseEnter={event => { setActive(true); onMouseEnter?.(event); }}
    onFocus={event => { setActive(true); onFocus?.(event); }} />;
}
