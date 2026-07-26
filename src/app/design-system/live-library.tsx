import { Button } from "@/components/ui/button";
import {
  Avatar,
  CategoryIcon,
  HorizontalGallery,
  Icon,
  LinkedTitle,
  ListingCard,
  Media,
  MetadataTags,
  ProfileHeader,
  SectionLabel,
  TimelineRow,
  VehicleGallery,
  type IconName,
} from "@/components/ui";
import { FeedList } from "@/components/ui/feed-list";
import type { FeedItem } from "@/lib/feed";
import { CATEGORIES } from "@/lib/marketplace/taxonomy";

import { TabNavDemo } from "./live-demos";

const ICON_NAMES: IconName[] = [
  "home",
  "compass",
  "market",
  "garage",
  "user",
  "settings",
  "bell",
  "bookmark",
  "heart",
  "play",
  "back",
  "sell",
];

const DEMO_FEED: FeedItem[] = [
  {
    kind: "update",
    id: "demo-1",
    created_at: "2026-07-01T00:00:00Z",
    title: "Downpipe and tune installed",
    intro: "Fitted the 034 downpipe and flashed Stage 2. Huge midrange difference.",
    carName: "Neil's Golf R",
    carSlug: "#",
    ownerName: "Neil Barrow",
    cover_url: null,
    avatar_url: null,
    reactions: 2,
  },
  {
    kind: "car",
    id: "demo-2",
    created_at: "2026-07-01T00:00:00Z",
    name: "Maya's Supra",
    slug: "#",
    meta: "2021 Toyota GR Supra",
    cover_url: null,
    ownerName: "Maya Tran",
  },
  {
    kind: "part",
    id: "demo-3",
    created_at: "2026-07-01T00:00:00Z",
    title: "KW V3 Coilovers for B9 Audi S4/S5",
    price_cents: 145000,
    cover_url: null,
  },
];

/** Inventory of every live production component with its source path. */
const LIVE_INVENTORY: { group: string; items: { name: string; path: string; note: string }[] }[] = [
  {
    group: "Shell & primitives — src/components/ui/",
    items: [
      { name: "AppSidebar", path: "sidebar.tsx", note: "Route-aware icon rail (next/link + usePathname); primary + utility nav" },
      { name: "Button", path: "button.tsx", note: "Pill button: primary / secondary / ghost, md / sm" },
      { name: "NarrowColumn", path: "primitives.tsx", note: "540px phone-first product column" },
      { name: "Avatar", path: "primitives.tsx", note: "Initials badge with radial gradient" },
      { name: "Media", path: "primitives.tsx", note: "Image with gradient fallback" },
      { name: "MetadataTags", path: "primitives.tsx", note: "Wrapping chip row for car meta + tags" },
      { name: "SectionLabel", path: "primitives.tsx", note: "Uppercase tracking eyebrow" },
      { name: "HorizontalGallery", path: "primitives.tsx", note: "Scrollable thumb strip, compact/large" },
      { name: "TabNav", path: "primitives.tsx", note: "Underline tab switcher (About / Activity)" },
      { name: "Icon", path: "icons.tsx", note: "12-icon stroke set" },
      { name: "CategoryIcon", path: "category-icon.tsx", note: "6 custom marketplace category icons" },
      { name: "ListingCard", path: "listing-card.tsx", note: "Marketplace card with price, condition, fitment badge" },
      { name: "FeedList", path: "feed-list.tsx", note: "Mixed feed rows with content-type labels" },
    ],
  },
  {
    group: "Read.cv patterns — src/components/ui/patterns.tsx",
    items: [
      { name: "LinkedTitle", path: "patterns.tsx", note: "Tappable title with the ↗ drill-in glyph" },
      { name: "TimelineRow", path: "patterns.tsx", note: "52px date-rail + content column" },
      { name: "ProfileHeader / WebsitePill", path: "patterns.tsx", note: "88px identity block with white website pill + action slot" },
      { name: "VehicleGallery", path: "patterns.tsx", note: "Asymmetric hero + supporting tiles, opens lightbox" },
      { name: "KeyValueTable", path: "patterns.tsx", note: "Bordered rows for Wheels & Tires specs" },
      { name: "ActivityEngagement", path: "features/activity/engagement.tsx", note: "Functional reply thread + persisted emoji reactions on activity detail" },
      { name: "EmbeddedVideo", path: "components/ui/patterns.tsx", note: "Red-play video tile on activity detail (set via composer's video URL)" },
      { name: "SettingsPanel", path: "app/(product)/settings/settings-panel.tsx", note: "SettingsModal pattern: left section nav + FormField editor, wired to updateProfile" },
      { name: "FeedCard / MasonryFeed", path: "feed-card.tsx", note: "Explore columns masonry cards by content type" },
      { name: "ProfileBody", path: "components/profile/profile-body.tsx", note: "Shared bio + Vehicles/Activity timelines + links" },
    ],
  },
  {
    group: "Social — src/features/social/",
    items: [
      { name: "SaveButton / FollowButton", path: "buttons.tsx", note: "Optimistic toggles; redirect to login when logged out" },
    ],
  },
  {
    group: "Marketplace & commerce",
    items: [
      { name: "FilterBar", path: "app/(discover)/marketplace/filter-bar.tsx", note: "GET-form search + condition + price + fitment toggle" },
      { name: "PurchaseActions", path: "app/(discover)/listings/[id]/purchase-actions.tsx", note: "Buy now / Add to cart / offer modal (stub payments)" },
      { name: "QASection", path: "app/(discover)/listings/[id]/qa-section.tsx", note: "Public Q&A with threaded seller replies" },
      { name: "SellForm", path: "app/(product)/sell/sell-form.tsx", note: "Single sectioned listing form with client-side uploads" },
      { name: "CheckoutButton", path: "app/(product)/cart/checkout-button.tsx", note: "Cart checkout with inline error state" },
      { name: "ReviewForm", path: "app/(product)/orders/review-form.tsx", note: "Order-linked 1-5★ buyer↔seller review" },
    ],
  },
  {
    group: "Garage & profile editors",
    items: [
      { name: "AddCarForm", path: "app/(product)/garage/add-car-form.tsx", note: "Compact add-car modal (name/year/make/model)" },
      { name: "CarDetailsForm", path: "app/(product)/garage/[id]/edit/car-details-form.tsx", note: "Car fields + tags + public toggle" },
      { name: "GalleryManager", path: "app/(product)/garage/[id]/edit/gallery-manager.tsx", note: "Upload to car-images bucket, first = cover" },
      { name: "ModsEditor", path: "app/(product)/garage/[id]/edit/mods-editor.tsx", note: "Paste → parse → confirm structured mod items" },
      { name: "ActivityComposer", path: "app/(product)/garage/[id]/edit/activity-composer.tsx", note: "Post build updates to the car's Activity tab" },
      { name: "ProfileEditor", path: "app/(product)/profile/profile-editor.tsx", note: "read.cv-style profile edit modal with links" },
    ],
  },
];

function Specimen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">{title}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export function LiveLibrary() {
  return (
    <section id="live" className="border-t border-white/10 py-20">
      <p className="text-sm font-semibold uppercase tracking-[0.32em] text-[#3B71FE]">
        Live component library
      </p>
      <h2 className="mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-white md:text-5xl">
        What&apos;s actually shipped in src/components & src/features.
      </h2>
      <p className="mt-4 max-w-2xl text-base leading-7 text-[#BBBBBB]">
        These are the token-driven production components built through M0–M5 — rendered live
        below, not mocked. They implement the profile timeline, linked titles, vehicle gallery,
        activity detail, and explore feed defined in the canonical spec below.
      </p>

      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        <Specimen title="Button — primary / secondary / ghost">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button size="sm">Small</Button>
          </div>
        </Specimen>

        <Specimen title="Avatar / SectionLabel / MetadataTags">
          <div className="flex items-center gap-4">
            <Avatar size="h-16 w-16" initials="NB" />
            <Avatar initials="MT" />
            <Avatar size="h-8 w-8" initials="D" />
          </div>
          <div className="mt-5">
            <SectionLabel>Section label</SectionLabel>
            <div className="mt-3">
              <MetadataTags tags={["2019", "Audi S4", "Quantum Gray", "FBO", "Bagged"]} />
            </div>
          </div>
        </Specimen>

        <Specimen title="TabNav — interactive">
          <TabNavDemo />
        </Specimen>

        <Specimen title="Media + HorizontalGallery — gradient fallbacks">
          <Media alt="Fallback media" className="h-24 w-40 rounded-tile" />
          <div className="mt-4">
            <HorizontalGallery images={["", "", "", ""]} alt="Demo gallery" />
          </div>
        </Specimen>

        <Specimen title="Icon set — 12 strokes">
          <div className="flex flex-wrap gap-4">
            {ICON_NAMES.map((name) => (
              <span key={name} className="flex flex-col items-center gap-1.5 text-text-secondary">
                <Icon name={name} />
                <span className="text-[10px] text-text-muted">{name}</span>
              </span>
            ))}
          </div>
        </Specimen>

        <Specimen title="CategoryIcon — marketplace taxonomy">
          <div className="flex flex-wrap gap-5">
            {CATEGORIES.map((category) => (
              <span key={category.slug} className="flex flex-col items-center gap-1.5 text-accent">
                <CategoryIcon name={category.icon} />
                <span className="text-[10px] text-text-muted">{category.label}</span>
              </span>
            ))}
          </div>
        </Specimen>

        <Specimen title="ListingCard — with fitment badge">
          <div className="grid max-w-[560px] grid-cols-2 gap-4">
            <ListingCard
              listing={{
                id: "demo",
                title: "034 Motorsport High-Flow Downpipe",
                price_cents: 68000,
                condition: "used",
                location: "Austin, TX",
                cover_url: null,
                fits_car_name: "Neil's Audi S4",
              }}
            />
            <ListingCard
              listing={{
                id: "demo-2",
                title: "APR Carbon Intake 3.0T EA839",
                price_cents: 52000,
                condition: "like_new",
                location: "Denver, CO",
                cover_url: null,
              }}
            />
          </div>
        </Specimen>

        <Specimen title="FeedList — content-type labels">
          <FeedList items={DEMO_FEED} />
        </Specimen>

        <Specimen title="ProfileHeader — 88px identity block + website pill">
          <ProfileHeader
            initials="NB"
            name="Neil Barrow"
            handle="@neil · Austin, TX"
            website={{ label: "read.cv/neil", href: "https://read.cv" }}
          />
        </Specimen>

        <Specimen title="LinkedTitle + TimelineRow — date-rail">
          <div className="grid gap-6">
            <TimelineRow date="2019">
              <LinkedTitle href="#" label="Neil's Audi S4" />
              <p className="mt-0.5 text-sm text-text-muted">Quantum Gray · Audi S4</p>
            </TimelineRow>
            <TimelineRow date="Jul 2026">
              <LinkedTitle href="#" label="Downpipe and tune installed" />
              <p className="mt-1 text-sm text-text-secondary">Fitted the 034 downpipe and flashed Stage 2.</p>
            </TimelineRow>
          </div>
        </Specimen>

        <Specimen title="VehicleGallery — asymmetric hero + supporting">
          <VehicleGallery
            images={[{ url: "" }, { url: "" }, { url: "" }, { url: "" }, { url: "" }]}
          />
        </Specimen>
      </div>

      <div className="mt-12">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
          Full live inventory
        </p>
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          {LIVE_INVENTORY.map((group) => (
            <div key={group.group} className="rounded-card border border-border bg-surface p-6">
              <p className="text-sm font-semibold text-text-primary">{group.group}</p>
              <ul className="mt-3 flex flex-col gap-2.5">
                {group.items.map((item) => (
                  <li key={item.name} className="text-sm">
                    <span className="font-semibold text-text-secondary">{item.name}</span>
                    <span className="text-text-muted"> — {item.note}</span>
                    <span className="block text-xs text-text-muted/70">{item.path}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-text-muted">
          Interactive flows (checkout, offers, uploads, editors) need auth and real data — try
          them in the app via Garage, Sell, and any listing page. Server actions live in
          src/app/(product)/garage/actions.ts, src/app/(product)/sell/actions.ts,
          src/features/social/actions.ts, and src/features/commerce/actions.ts.
        </p>
      </div>
    </section>
  );
}
