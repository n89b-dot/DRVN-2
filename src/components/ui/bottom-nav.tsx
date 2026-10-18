"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { cx } from "@/lib/format";
import { Icon, type IconName } from "./icons";

export type BottomNavItem = {
  href: string;
  label: string;
  icon: IconName;
  active?: boolean;
  /** Shown as the rail's dot: a count has no room at this size. */
  badge?: number;
};

/** A field that raises the on-screen keyboard. */
function isTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return (
    el instanceof HTMLInputElement &&
    !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"].includes(el.type)
  );
}

/**
 * True while a touch device is typing: the keyboard is up and a tab bar
 * would ride on top of it, covering the field.
 */
function useTyping(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)");
    const onIn = (e: FocusEvent) => setTyping(coarse.matches && isTextEntry(e.target));
    const onOut = (e: FocusEvent) => {
      if (!isTextEntry(e.relatedTarget)) setTyping(false);
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  return typing;
}

/**
 * The phone and tablet tab bar: the few top-level places, fixed to the
 * bottom edge below 1081px, where the rail goes away. It stands down on its
 * own while the keyboard is up, and wherever the page already owns the
 * bottom edge (a purchase bar, a save bar, a message composer: see `.bnav`).
 * Callers hide it on focused screens with `hidden`.
 */
export function BottomNav({
  items,
  label = "Main",
  hidden = false,
}: {
  items: BottomNavItem[];
  /** Accessible name for the navigation landmark. */
  label?: string;
  /** Focused screens (checkout, editors) where the page is the whole task. */
  hidden?: boolean;
}) {
  const typing = useTyping();
  return (
    <nav className="bnav" aria-label={label} hidden={hidden || typing}>
      <ul className="bnav__rows">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={cx("bnav__item", item.active && "is-here")}
              aria-current={item.active ? "page" : undefined}
            >
              <span className="bnav__ico" aria-hidden="true">
                <Icon name={item.icon} className="h-[20px] w-[20px]" />
                {(item.badge ?? 0) > 0 && <span className="railrow__dot" />}
              </span>
              <span className="bnav__label">{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
