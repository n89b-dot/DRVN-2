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
  | "smile";

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
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
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
