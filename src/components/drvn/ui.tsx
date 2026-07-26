"use client";

/**
 * Legacy shim for the mockup/design-system pages.
 * Product code should import from "@/components/ui" instead.
 * The button-based Sidebar (state-router navigation) lives here because the
 * clickable mockup navigates via component state, not routes.
 */

import { cx } from "@/lib/format";
import { Icon, type IconName } from "@/components/ui/icons";

export { Icon, type IconName } from "@/components/ui/icons";
export {
  NarrowColumn,
  Avatar,
  Media,
  MetadataTags,
  SectionLabel,
  HorizontalGallery,
  TabNav,
} from "@/components/ui/primitives";

export type SidebarNavItem<T extends string> = {
  key: T;
  icon: IconName;
  label: string;
};

export function Sidebar<T extends string>({
  active,
  primaryItems,
  utilityItems,
  onNavigate,
}: {
  active: T;
  primaryItems: SidebarNavItem<T>[];
  utilityItems?: SidebarNavItem<T>[];
  onNavigate: (key: T) => void;
}) {
  const renderItem = (item: SidebarNavItem<T>) => {
    const isActive = item.key === active;
    return (
      <button
        key={item.key}
        type="button"
        title={item.label}
        aria-label={item.label}
        aria-current={isActive ? "page" : undefined}
        onClick={() => onNavigate(item.key)}
        className={cx(
          "grid h-11 w-11 place-items-center rounded-xl transition",
          isActive ? "bg-raised text-text-primary" : "text-text-muted hover:bg-white/5 hover:text-text-secondary",
        )}
      >
        <Icon name={item.icon} />
      </button>
    );
  };

  return (
    <aside className="sticky top-0 z-40 flex h-screen w-[72px] shrink-0 flex-col items-center justify-between border-r border-white/10 bg-surface py-5 md:w-24">
      <div className="flex flex-col items-center gap-6">
        <button
          type="button"
          onClick={() => onNavigate(primaryItems[0].key)}
          className="grid h-10 w-10 place-items-center rounded-2xl bg-accent font-brand text-lg font-bold text-white"
          aria-label="DRVN home"
        >
          D
        </button>
        <nav className="flex flex-col items-center gap-2">{primaryItems.map(renderItem)}</nav>
      </div>
      <nav className="flex flex-col items-center gap-2">
        {utilityItems?.map(renderItem)}
        <span className="grid h-10 w-10 place-items-center rounded-full bg-raised text-text-secondary">
          <Icon name="settings" className="h-4 w-4" />
        </span>
      </nav>
    </aside>
  );
}
