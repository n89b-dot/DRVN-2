# DRVN Component Design Doc

A developer-facing specification for the DRVN product and marketing UI. It explains
**what each component is, where it is used, how it behaves, and the concrete specs**
(dimensions, colors, typography, data shape) needed to start building.

This doc is the written companion to the live component board at `/design-system`
(`src/app/design-system/page.tsx`). When the two disagree, treat this doc as the intent
and the page as the current visual draft.

---

## 1. Product overview

DRVN is a car-culture profile network styled after Read.cv. Each person has a **profile**;
each profile lists their **cars**; each car has its own **car profile** (modifications +
details) and its own **activity** feed (build log). Tapping an activity entry opens a focused
**activity detail** post.

There is also a **marketing** surface (public landing pages) and a wider **explore** feed for
discovery.

### 1.1 Design principles

1. **Phone-first, low-scroll columns.** Profile, car profile, and settings pages are capped to
   a **540px content column**. This is intentional: these pages should read like a quick,
   scannable brief on a phone, not a sprawling desktop layout. Wide, discovery-heavy surfaces
   (Explore, marketing) are exempt.
2. **Dark and editorial.** The product surface stays dark and quiet so photography and content
   lead. Marketing goes darker still (near-black cards, blue accents).
3. **Links are the primary affordance.** Drill-down happens through linked titles (with a `↗`
   glyph), not through tapping galleries. Galleries are previews.
4. **One pattern, reused at different scopes.** e.g. the same activity-entry row appears both on
   a person's profile (across all their cars) and inside a single car's Activity tab (scoped to
   that car).

---

## 2. Information architecture & navigation

The drill-down model (several steps are not obvious from static frames):

| Step | Screen | What it shows | Primary action |
| --- | --- | --- | --- |
| 1 | **Profile** (per person) | Identity, the person's cars, activity across all their cars, contact, crews. This is the page you land on when you open someone — **not** the app's home page. | Click a car |
| 2 | **Car Profile → About** | The car's description, photo gallery, modifications (Exterior / Interior / Performance / Suspension), wheels & tires. | Switch to Activity tab |
| 3 | **Car Profile → Activity** | Build log **scoped to that car only**. Dated entries with media. | Click an entry |
| 4 | **Activity Detail** | A single post: header, long-form body sections, image gallery, embedded video, reactions + reply. | Reply / react |

### 2.1 Behaviors worth calling out

- **Car tags are user input.** The chips above a car (`2024 Lapiz Blue`, `Fort Lauderdale`,
  `Bagged`, `FBO`, `Fully Built`, …) are entered by the owner and rendered on their profile. They
  are free-form metadata, not a fixed enum.
- **Two levels of Activity.** Profile activity spans all of a person's cars; a car's Activity tab
  is scoped to just that vehicle. Same row component, different query scope.
- **Activity detail has no "More from" section.** The post ends after the reply composer.

---

## 3. Design tokens

### 3.1 Color

| Token | Hex | Usage |
| --- | --- | --- |
| Product bg | `#1A1D1F` | App background |
| Surface | `#1E2124` | Cards, panels, sidebar |
| Raised card | `#272B30` | Active nav item, inputs, chips on dark |
| Text primary | `#EEEEEE` | Titles, primary copy |
| Text secondary | `#BBBBBB` | Body copy |
| Text muted | `#888888` | Labels, meta, dates |
| Accent blue | `#007AFF` | Eyebrows, focus, primary marketing accent |
| Success | `#34C759` | Published / positive status |

**Explore / marketing extras** (from the Figma feed): card fill `#333333`, hairline border
`#353945`, near-black media `#111315`, marketing blue `#3B71FE`, light pill `#E6E8EC` with text
`#23262F`, muted blue-gray text `#777E90`.

### 3.2 Typography

- **Product UI:** Rubik / DM Sans. Name 20px, handle 14px, body 14px (~22px line height),
  meta 11–12px.
- **Explore cards:** Poppins. Title ~12.4px/21, label ~10.6px/17.6.
- **Marketing:** large semibold display headings with tight tracking (`-0.04em` to `-0.075em`).

### 3.3 Spacing, radius, layout

- **Content column:** 540px (profile / car profile / settings).
- **Sidebar:** 96px fixed.
- **Radii:** chips/pills `full`; inputs/tiles 14–22px; cards 21–32px.
- **Timeline rows:** ~60px date rail + content, 64px vertical gap between rows.
- **Gallery:** 8px gap; compact thumb 89×90, wide thumb 160×90; 2px custom scrollbar.

---

## 4. Component catalog

Each entry below lists: **Purpose**, **Where used**, **Anatomy**, **Specs**, **States**, and a
suggested **Data interface** (TypeScript) where the component is data-driven.

### 4.1 App Shell

#### CollapsingSidebar
- **Purpose:** Primary product navigation.
- **Where used:** Every product page (profile, car profile, settings).
- **Anatomy:** Logo (top) → icon nav rows (home, explore, profile, store/garage, analytics) →
  utility row (back/help, theme toggle) at the bottom.
- **Specs:** 96px fixed width; `#1E2124` background; 48px logo; 48px icon rows; active item
  `#272B30` rounded highlight.
- **States:** default, active (current route), hover.
- **Data:** `{ items: { id: string; icon: IconName; href: string }[]; activeId: string }`

#### ThemeToggle
- **Purpose:** Light/dark switch.
- **Where used:** Bottom of the sidebar.
- **Specs:** pill track `#111315`, 40–48px; knob `#272B30` with sun/moon icon.
- **States:** light, dark.
- **Data:** `{ theme: "light" | "dark"; onToggle(): void }`

#### Logo
- **Purpose:** DRVN brand mark, links home.
- **Where used:** Sidebar and marketing nav.
- **Specs:** rounded square `#3B71FE`, white "D" / "drvn" wordmark; brand font, tracking `-0.06em`.

#### ExploreTopNav
- **Purpose:** Full-width top bar for the Explore feed only.
- **Anatomy:** logo + wordmark · (optional builds dropdown) · support / language · "List your
  build" outline button · notifications bell (with status dot) · avatar.
- **Specs:** 80px tall; bottom border `#353945`; `#1A1D1F` background.

#### MarketingTopNav
- **Purpose:** Horizontal text nav for public marketing pages.
- **Specs:** transparent over dark; text links in `#888888`, active `#EEEEEE`.

#### MarketingSidebar
- **Purpose:** Slim icon rail on marketing pages, mirroring the product shell.

### 4.2 Profile & Vehicle

#### ProfileHeader
- **Purpose:** Identity block at the top of a profile.
- **Where used:** Top of a person's profile (owner variant) and a car profile (vehicle variant).
- **Anatomy:** avatar + (name, @handle, tagline) + optional WebsitePill / Follow actions.
- **Specs:** 104px avatar (owner); name 20px Rubik/DM Sans; handle 14px `#888`; two variants
  (user, vehicle).
- **States:** own profile (edit affordances) vs. visitor (Follow button).
- **Data:**
  ```ts
  interface ProfileHeaderProps {
    variant: "user" | "vehicle";
    avatarUrl: string;
    name: string;
    handle: string;       // "@mrawr2"
    tagline?: string;     // "Product Designer in Fort Lauderdale, Florida"
    websiteUrl?: string;
    isOwner: boolean;
  }
  ```

#### ProfileInfo
- **Purpose:** The name / handle / tagline text cluster beside the avatar.
- **Note:** Usually composed inside `ProfileHeader`; split out for reuse in compact contexts.

#### WebsitePill
- **Purpose:** Rounded pill linking to the owner's personal site.
- **Specs:** full radius, white fill, dark text, 1px inset border; 40–48px tall.
- **Data:** `{ label: string; href: string }`

#### TabNavigation
- **Purpose:** About / Activity switcher.
- **Where used:** Both person profiles and car profiles.
- **Specs:** 32px height; 24px gap; active `#EEEEEE` with 1px underline; inactive `#888888`.
- **Data:** `{ tabs: string[]; activeTab: string; onChange(tab: string): void }`

#### BioParagraph
- **Purpose:** Free-text intro under the header (owner bio or car description).
- **Specs:** 14px body, ~22px line height, `#BBBBBB`.

#### MetadataTag
- **Purpose:** Owner-entered attribute chip above a car (year, paint, location, build status).
- **Important:** Free-form **user input**, not a fixed list. Wraps across rows.
- **Specs:** 28px height; 14px radius; optional 16px leading icon; 1px inset border; `#BBBBBB` text.
- **Data:** `{ tags: string[] }` — e.g. `["2024 Lapiz Blue", "Bagged", "FBO"]`

#### ContactRow
- **Purpose:** A single contact line in the Contact section.
- **Specs:** label `#888` + value `#EEEEEE`; one row per channel (website, Instagram, TikTok, email).
- **Data:** `{ channel: string; label: string; href?: string }`

#### CrewCard
- **Purpose:** A crew/community the owner belongs to, in the Crews section.
- **Anatomy:** crew avatar/initials + crew name (+ optional role/status).
- **Data:** `{ crewId: string; name: string; avatarUrl?: string }`

### 4.3 Timeline & Media

#### TimelineSection
- **Purpose:** Date-rail + content layout shared by Vehicles, Activity, Contact, and Crews.
- **Specs:** ~60px date rail + 480px content; 64px row gap.
- **Composition:** renders a list of `VehicleListItem` or `ActivityEntry` rows.

#### TimelineDateRail
- **Purpose:** Left-aligned year or month label for each row.
- **Specs:** right-aligned, `#888888`, small caps-feel meta text.

#### LinkedTitle
- **Purpose:** Tappable title with a `↗` glyph — the primary drill-in affordance.
- **Behavior:** on a car → opens the car profile; on an activity → opens the activity detail.
- **Data:** `{ label: string; href: string }`

#### VehicleListItem
- **Purpose:** A car row in the owner's Vehicles section.
- **Anatomy:** `LinkedTitle` (car name) + color subtitle + `HorizontalGallery` photo strip +
  optional `MetadataTag` row.
- **Data:**
  ```ts
  interface VehicleListItemProps {
    vehicleId: string;
    year: string;
    name: string;          // "Volkswagen Golf R"
    colorLabel: string;    // "Lapiz Blue"
    tags: string[];
    photos: string[];
    href: string;
  }
  ```

#### ActivityEntry
- **Purpose:** A build-log row: date, linked title, description, photo strip.
- **Where used:** Person profile (all cars) and a car's Activity tab (scoped).
- **Data:**
  ```ts
  interface ActivityEntryProps {
    postId: string;
    date: string;          // "Sep 2024"
    title: string;
    description: string;
    photos: string[];
    href: string;
  }
  ```

#### HorizontalGallery
- **Purpose:** Scrollable image strip for vehicles and activity entries.
- **Specs:** compact 89×90, wide 160×90; 8px gap; subtle thumbnail border; paired with
  `GalleryScrollbar`.
- **Data:** `{ images: string[] }`

#### GalleryScrollbar
- **Purpose:** Thin custom scrollbar under a horizontal gallery.
- **Specs:** 2px track `#383838`, thumb `#666666`.

#### MasonryGallery
- **Purpose:** Vehicle media overview on the car About page (asymmetric hero + supporting tiles).
- **Specs:** 540px width; 16px gap; mixed 2-column and 3-column rows; rounded tiles.
- **Data:** `{ images: string[] }`

### 4.4 Activity Detail

The focused post reached by tapping an `ActivityEntry`. Stays in the 540px column.

#### BackLink
- **Purpose:** `← Activity` breadcrumb back to the car's activity feed.
- **Data:** `{ label: string; href: string }`

#### ActivityPostHeader
- **Purpose:** Avatar + post title + intro paragraph at the top of the post.
- **Data:** `{ avatarUrl: string; title: string; intro: string }`

#### ActivityBodySection
- **Purpose:** A sub-heading plus long-form body copy; repeats down the post (e.g. "Modifications").
- **Data:** `{ heading: string; body: string }`

#### EmbeddedVideo
- **Purpose:** Inline media embed (e.g. YouTube) inside a post.
- **Specs:** rounded 18px container; play affordance; preserves aspect ratio.
- **Data:** `{ provider: "youtube" | "file"; url: string; title?: string }`

#### ReactionBar
- **Purpose:** Emoji reactions attached to a post.
- **Specs:** circular `#272B30` buttons; default set `🔥 🤙 😯 📈`.
- **Data:** `{ reactions: { emoji: string; count: number; reacted: boolean }[] }`

#### ReplyComposer
- **Purpose:** "Reply directly…" input for responding to a post.
- **Anatomy:** rounded input + send affordance; sits alongside the reaction buttons.
- **Data:** `{ placeholder: string; onSubmit(text: string): void }`

### 4.5 Explore & Settings

#### FilterPills
- **Purpose:** Trending / Newest toggle on the Explore feed.
- **Specs:** active pill `#E6E8EC` text `#23262F`; inactive text `#777E90`.

#### FilterDropdown
- **Purpose:** Dark filter selector on the Explore feed.
- **Specs:** 48px tall; 1px `#353945` border; chevron in a bordered circle.

#### MasonryGrid
- **Purpose:** Four-column masonry layout the Explore cards sit in.
- **Specs:** responsive 1→2→4 columns; variable tile heights.

#### FeedCard
- **Purpose:** Explore card for build posts, cars, listings, and social content.
- **Variants:** (1) image-top + reply bar, (2) tall image + reply bar, (3) text-first with image
  and a social action row.
- **Specs:** 294px base width; `#333333` fill; `#353945` border; 21px radius; author label,
  title, body, reply input + heart action.
- **Data:**
  ```ts
  interface FeedCardProps {
    variant: "image-top" | "tall-image" | "text-first";
    author: string;
    title: string;
    body: string;
    media?: string;
  }
  ```

#### SettingsModal
- **Purpose:** Editor for profile, vehicle, activity, contact, and crews.
- **Specs:** 840px overlay with dimmed backdrop, left nav + right form panel. A narrow,
  low-scroll layout also applies here per the phone-first principle.
- **Composition:** hosts `FormField`, `RichTextEditor`, and `ListEntryEditor`.

#### FormField
- **Purpose:** Labeled input / textarea / select used throughout settings.
- **Specs:** label `#888` uppercase; input `#0` overlay fill + 1px border; 14px radius.
- **Data:** `{ label: string; type: "text" | "textarea" | "select"; value: string }`

#### RichTextEditor
- **Purpose:** Formatting toolbar + body field for bios and posts.

#### ListEntryEditor
- **Purpose:** Repeatable entry editor (title, date, media) for Vehicles and Activity. This is where
  an owner adds the cars and build updates — and the `MetadataTag` values — that render on the profile.
- **Data:** `{ entries: ListEntry[]; onAdd(): void; onRemove(id: string): void }`

### 4.6 Marketing

| Component | Purpose | Key specs |
| --- | --- | --- |
| PageHero | Eyebrow + headline + subhead at the top of a marketing page. | blue eyebrow; large display headline; gray subhead |
| HeroVideo | Rounded hero video with a centered play pill (About hub). | gradient surface; centered "Watch film" pill |
| TestimonialGrid | Two-column quotes with attribution. | quote `#BBBBBB`; avatar + name |
| BentoFeatureGrid | 2×3 grid of feature cards linking to product pages. | equal tiles; `#1C1C1E` fill, 1px border |
| FeatureCard | Visual mock + title + description tile in a feature grid. | `#1C1C1E` surface; 18–24px radius; blue eyebrow |
| FeatureRow | Alternating visual-left / copy-right explainer row. | 50/50 split; 48px column gap |
| VisualCard | Dark rounded surface hosting any product mock. | reusable wrapper |
| SupporterCTA | Repeated "Become a supporter" upsell before the footer. | white pill button; centered copy |
| SiteFooter | Four-column link footer on every marketing page. | heading + links per column |

### 4.7 Specialty mocks

These start as marketing visuals and can graduate into product UI.

| Component | Purpose |
| --- | --- |
| SearchTag | Blue filter chip (e.g. "Location: California") from the Search page. |
| AvatarCluster | Overlapping avatars showing mutual connections. |
| ShortcutKey | Keyboard key caps (⌘ K) for the command palette. |
| ProfileTabMock | Mini profile-with-tabs illustration used in marketing. |
| PublishedBadge | Green "Published" status pill. |
| PasswordLockMock | Locked content illustration for private posts. |
| LogoCloud | Grid of partner/brand logos. |
| StatsCard | Pricing/stats rows (price, impressions, CPM). |

---

## 5. Suggested build order

1. **Tokens + shell** — colors/typography, `CollapsingSidebar`, `Logo`, `ThemeToggle`.
2. **Profile primitives** — `ProfileHeader`, `TabNavigation`, `BioParagraph`, `MetadataTag`,
   `ContactRow`, `CrewCard`.
3. **Timeline + media** — `TimelineSection`, `VehicleListItem`, `ActivityEntry`,
   `HorizontalGallery`, `MasonryGallery`, `LinkedTitle`.
4. **Car profile** — compose the above into the About + Activity tabs.
5. **Activity detail** — `BackLink`, `ActivityPostHeader`, `ActivityBodySection`,
   `EmbeddedVideo`, `ReactionBar`, `ReplyComposer`.
6. **Explore** — `FeedCard` variants, `MasonryGrid`, `FilterPills`, `FilterDropdown`.
7. **Settings** — `SettingsModal`, `FormField`, `RichTextEditor`, `ListEntryEditor`.
8. **Marketing + specialty** — as needed for the public site.

---

## 6. Notes for implementation

- Extract these as real reusable components under `src/components/` so the product pages and the
  `/design-system` board import the **same** source (today the board renders inline examples).
- Keep the 540px column a shared layout primitive (e.g. `<NarrowColumn>`), not a magic number
  copy-pasted per page.
- Treat `MetadataTag` values and `ListEntryEditor` content as user data end-to-end; do not hardcode.
