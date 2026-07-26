/**
 * Presentational building blocks for the DRVN mockup.
 *
 * These mirror the components described in docs/component-design-doc.md. They are
 * intentionally stateless — navigation state lives in the page and is passed down.
 */

import type { ReactNode } from "react";

import type { Tone } from "./data";

const TONE_GRADIENTS: Record<Tone, string> = {
  blue: "bg-[linear-gradient(135deg,#0F1115,#2D5BFF_70%,#7CA2FF)]",
  dusk: "bg-[linear-gradient(135deg,#11151C,#3B71FE_55%,#C7D2E5)]",
  steel: "bg-[linear-gradient(135deg,#15181C,#56616F_60%,#AEB7C2)]",
  dark: "bg-[linear-gradient(135deg,#070809,#23262B_70%,#3A4048)]",
  red: "bg-[linear-gradient(135deg,#180A0A,#7A1F1F_55%,#E2552F)]",
  light: "bg-[linear-gradient(135deg,#1A1D1F,#9AA3AE_60%,#E6E8EC)]",
};

/** A stand-in for a photo, rendered as a gradient tile. */
export function Photo({ tone, className = "" }: { tone: Tone; className?: string }) {
  return <span className={`${TONE_GRADIENTS[tone]} ${className}`} aria-hidden />;
}

export function Avatar({ size = "h-12 w-12", initials = "NB" }: { size?: string; initials?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_25%,#4B83D6,#111315_70%)] text-[11px] font-bold text-white ${size}`}
    >
      {initials}
    </span>
  );
}

export type IconName = "home" | "compass" | "user" | "garage" | "settings" | "back" | "bell" | "heart" | "play";

export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    home: <path d="M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5" />,
    compass: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m15.5 8.5-2 5-5 2 2-5z" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" />
      </>
    ),
    garage: <path d="M3 21V8l9-5 9 5v13M7 21v-7h10v7M7 14h10" />,
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
      </>
    ),
    back: <path d="M15 18l-6-6 6-6" />,
    bell: <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 21h4" />,
    heart: <path d="M12 20s-7-4.4-7-9.5A3.5 3.5 0 0 1 12 7a3.5 3.5 0 0 1 7 3.5C19 15.6 12 20 12 20z" />,
    play: <path d="M8 5v14l11-7z" />,
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

export type NavKey = "profile" | "explore" | "settings";

const NAV_ITEMS: { key: NavKey; icon: IconName; label: string }[] = [
  { key: "profile", icon: "user", label: "Profile" },
  { key: "explore", icon: "compass", label: "Explore" },
  { key: "settings", icon: "settings", label: "Settings" },
];

/** 96px fixed icon rail used on every product screen. */
export function Sidebar({
  active,
  onNavigate,
}: {
  active: NavKey;
  onNavigate: (key: NavKey) => void;
}) {
  return (
    <aside className="sticky top-0 flex h-screen w-[72px] shrink-0 flex-col items-center justify-between border-r border-white/10 bg-[#1E2124] py-5 md:w-24">
      <div className="flex flex-col items-center gap-6">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#3B71FE] font-brand text-lg font-bold text-white">
          D
        </span>
        <nav className="flex flex-col items-center gap-2">
          {NAV_ITEMS.map((item) => {
            const isActive = item.key === active;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onNavigate(item.key)}
                title={item.label}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                className={`grid h-11 w-11 place-items-center rounded-xl transition ${
                  isActive ? "bg-[#272B30] text-[#EEEEEE]" : "text-[#777E90] hover:bg-white/5 hover:text-[#BBBBBB]"
                }`}
              >
                <Icon name={item.icon} />
              </button>
            );
          })}
        </nav>
      </div>
      <button
        type="button"
        title="Theme"
        aria-label="Toggle theme"
        className="grid h-10 w-10 place-items-center rounded-full bg-[#272B30] text-[#BBBBBB]"
      >
        <Icon name="settings" className="h-4 w-4" />
      </button>
    </aside>
  );
}

/**
 * The phone-first 540px reading column used by profile, car profile, and the
 * activity detail page. Centered within whatever space the page gives it.
 */
export function NarrowColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[540px] px-5 py-10 md:py-14">{children}</div>;
}

export function MetadataTags({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-[#BBBBBB]"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#777E90]">{children}</p>
  );
}

/** Scrollable thumbnail strip for vehicle and activity rows. */
export function HorizontalGallery({ images, large = false }: { images: Tone[]; large?: boolean }) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
      {images.map((tone, index) => (
        <Photo
          key={`${tone}-${index}`}
          tone={tone}
          className={`${large ? "h-28 w-44" : "h-20 w-28"} shrink-0 rounded-xl border border-white/10`}
        />
      ))}
    </div>
  );
}

export function TabNav({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}) {
  return (
    <div className="flex items-center gap-6 border-b border-white/10 text-sm">
      {tabs.map((tab) => {
        const isActive = tab === active;
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onChange(tab)}
            className={`-mb-px border-b-2 pb-3 transition ${
              isActive ? "border-[#EEEEEE] text-[#EEEEEE]" : "border-transparent text-[#888888] hover:text-[#BBBBBB]"
            }`}
          >
            {tab}
          </button>
        );
      })}
    </div>
  );
}
