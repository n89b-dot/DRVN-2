import type { ReactNode } from "react";

export type IconName =
  | "home"
  | "compass"
  | "market"
  | "garage"
  | "user"
  | "settings"
  | "bell"
  | "bookmark"
  | "heart"
  | "play"
  | "back"
  | "sell"
  | "comment"
  | "repost"
  | "smile"
  | "sun"
  | "moon"
  | "rail"
  | "cart"
  | "image"
  | "gauge"
  | "scale"
  | "box"
  | "flag"
  | "card"
  | "share"
  | "book"
  | "filter"
  | "search"
  | "eye"
  | "eye-off"
  | "agent";

export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    home: <path d="M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5" />,
    compass: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m15.5 8.5-2 5-5 2 2-5z" />
      </>
    ),
    market: <path d="M4 7h16l-1.5 13h-13L4 7ZM7 7a5 5 0 0 1 10 0" />,
    garage: <path d="M3 21V8l9-5 9 5v13M7 21v-7h10v7M7 14h10" />,
    // A steering wheel: you stay the driver (A3 design, docs/design/agent-a3).
    agent: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="2.2" />
        <path d="M3.2 12h6.6M14.2 12h6.6M12 14.2V21" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" />
      </>
    ),
    // A cog — the old glyph was a circle with eight rays, which reads as a
    // brightness control, not settings.
    settings: (
      <>
        <circle cx="12" cy="12" r="3.1" />
        <path d="M12 2.6h0a1.9 1.9 0 0 1 1.9 1.9v.36a1.6 1.6 0 0 0 .97 1.46 1.6 1.6 0 0 0 1.75-.32l.25-.25a1.9 1.9 0 1 1 2.7 2.7l-.26.25a1.6 1.6 0 0 0-.32 1.75v0a1.6 1.6 0 0 0 1.46.97h.36a1.9 1.9 0 0 1 0 3.8h-.36a1.6 1.6 0 0 0-1.46.97 1.6 1.6 0 0 0 .32 1.75l.25.25a1.9 1.9 0 1 1-2.7 2.7l-.24-.26a1.6 1.6 0 0 0-1.75-.32 1.6 1.6 0 0 0-.97 1.46v.36a1.9 1.9 0 0 1-3.8 0v-.36a1.6 1.6 0 0 0-1.02-1.46 1.6 1.6 0 0 0-1.75.32l-.25.25a1.9 1.9 0 1 1-2.7-2.7l.26-.25a1.6 1.6 0 0 0 .32-1.75 1.6 1.6 0 0 0-1.46-.97H4.5a1.9 1.9 0 0 1 0-3.8h.36a1.6 1.6 0 0 0 1.46-1.02 1.6 1.6 0 0 0-.32-1.75l-.25-.25a1.9 1.9 0 1 1 2.7-2.7l.25.26a1.6 1.6 0 0 0 1.75.32h.08a1.6 1.6 0 0 0 .97-1.46V4.5A1.9 1.9 0 0 1 12 2.6Z" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
      </>
    ),
    moon: <path d="M20.5 13.4A8.5 8.5 0 1 1 10.6 3.5a6.7 6.7 0 0 0 9.9 9.9Z" />,
    // The margin column of a drawing — the register rail.
    cart: (
      <>
        <path d="M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.2a1 1 0 0 0 1-.77L20 7H6" />
        <circle cx="9.5" cy="19" r="1.4" />
        <circle cx="17" cy="19" r="1.4" />
      </>
    ),
    rail: (
      <>
        <rect x="3" y="4.5" width="18" height="15" rx="2" />
        <path d="M9 4.5v15" />
      </>
    ),
    bell: <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 21h4" />,
    bookmark: <path d="M6 4h12v17l-6-4-6 4z" />,
    heart: <path d="M12 20s-7-4.4-7-9.5A3.5 3.5 0 0 1 12 7a3.5 3.5 0 0 1 7 3.5C19 15.6 12 20 12 20z" />,
    play: <path d="M8 5v14l11-7z" />,
    back: <path d="M15 18l-6-6 6-6" />,
    sell: <path d="M4 7h10l6 6-7 7-9-9V7ZM8 10h.01" />,
    comment: <path d="M21 12a8 8 0 0 1-8 8H4l2.5-3A8 8 0 1 1 21 12Z" />,
    repost: <path d="M4 9V7a2 2 0 0 1 2-2h11m0 0-3-3m3 3-3 3M20 15v2a2 2 0 0 1-2 2H7m0 0 3 3m-3-3 3-3" />,
    smile: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 10h.01M15 10h.01M8.5 14.5c1 1 2.2 1.5 3.5 1.5s2.5-.5 3.5-1.5" />
      </>
    ),
    /* A plate with a horizon and a sun — the photograph that hasn't been
       taken yet. Drawn on the same 24-grid and stroke weight as the rest. */
    image: (
      <>
        <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
        <circle cx="8.75" cy="10" r="1.6" />
        <path d="m3.5 16.5 4.6-4.1a2 2 0 0 1 2.7.05L15 16.5m-1.6-1.4 1.9-1.7a2 2 0 0 1 2.7.06l2.4 2.2" />
      </>
    ),
    gauge: (
      <>
        <path d="M4 18a8.5 8.5 0 1 1 16 0" />
        <path d="m12 18 4.2-4.2" />
        <circle cx="12" cy="18" r="1" />
      </>
    ),
    scale: (
      <>
        <path d="M12 4v17M8 21h8M4 7h16" />
        <path d="M7 7 4.5 12.5a2.8 2.8 0 0 0 5 0L7 7ZM17 7l-2.5 5.5a2.8 2.8 0 0 0 5 0L17 7Z" />
      </>
    ),
    box: <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9ZM3.5 7.5 12 12l8.5-4.5M12 12v9" />,
    flag: <path d="M5 21V4c4-2 6 2 10 0v9c-4 2-6-2-10 0" />,
    card: (
      <>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18M7 15h4" />
      </>
    ),
    /* An arrow leaving the tray — send it somewhere else. */
    share: <path d="M12 14V3.5M12 3.5 7.8 7.7M12 3.5l4.2 4.2M5 12.5v6A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-6" />,
    book: <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4ZM5 17a3 3 0 0 1 3-3h11M9 8h6" />,
    /* The lens and its handle — replaces the ⌕ text glyph in search
       fields, which rendered a size down from every real icon beside it. */
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m20 20-4.9-4.9" />
      </>
    ),
    /* Three slider rails with their knobs — refinements, not a funnel. */
    filter: (
      <>
        <path d="M4 7h16M4 12h16M4 17h16" />
        <circle cx="9" cy="7" r="1.7" fill="currentColor" />
        <circle cx="15" cy="12" r="1.7" fill="currentColor" />
        <circle cx="8" cy="17" r="1.7" fill="currentColor" />
      </>
    ),
    /* Reveal / conceal — the password field's toggle. */
    eye: (
      <>
        <path d="M2.5 12S6 5.6 12 5.6 21.5 12 21.5 12 18 18.4 12 18.4 2.5 12 2.5 12Z" />
        <circle cx="12" cy="12" r="2.9" />
      </>
    ),
    "eye-off": (
      <>
        <path d="M10.7 5.9a9.6 9.6 0 0 1 1.3-.3c6-.7 9.5 6.4 9.5 6.4a17.4 17.4 0 0 1-3 3.8M6.5 6.5A17 17 0 0 0 2.5 12S6 18.4 12 18.4a9.3 9.3 0 0 0 5.3-1.7" />
        <path d="M9.95 9.95a2.9 2.9 0 0 0 4.1 4.1" />
        <path d="m3.5 3.5 17 17" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}
