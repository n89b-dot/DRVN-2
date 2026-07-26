import Link from "next/link";
import type { ReactNode } from "react";

import { LiveLibrary } from "./live-library";

type ComponentSpec = {
  name: string;
  purpose: string;
  specs: string[];
};

type Token = {
  name: string;
  value: string;
  className: string;
};

const productTokens: Token[] = [
  { name: "Product bg", value: "#1A1D1F", className: "bg-[#1A1D1F]" },
  { name: "Surface", value: "#1E2124", className: "bg-[#1E2124]" },
  { name: "Raised card", value: "#272B30", className: "bg-[#272B30]" },
  { name: "Text primary", value: "#EEEEEE", className: "bg-[#EEEEEE]" },
  { name: "Text secondary", value: "#BBBBBB", className: "bg-[#BBBBBB]" },
  { name: "Text muted", value: "#888888", className: "bg-[#888888]" },
  { name: "Accent blue", value: "#3B71FE", className: "bg-[#3B71FE]" },
  { name: "Success", value: "#34C759", className: "bg-[#34C759]" },
];

const componentSpecs: ComponentSpec[] = [
  {
    name: "CollapsingSidebar",
    purpose: "Primary product navigation for profile, vehicle, and settings surfaces.",
    specs: ["96px fixed width", "#1E2124 background", "48px logo", "48px icon rows", "active item #272B30"],
  },
  {
    name: "ProfileHeader",
    purpose: "Owner or vehicle identity block used at the top of profile pages.",
    specs: ["104px avatar", "Rubik/DM Sans 20px name", "14px handle", "website pill", "user and vehicle variants"],
  },
  {
    name: "TabNavigation",
    purpose: "Two-state About and Activity switcher.",
    specs: ["32px height", "24px tab gap", "active #EEE", "inactive #888", "1px underline"],
  },
  {
    name: "MetadataTag",
    purpose: "Vehicle attributes such as year, paint, location, and build status.",
    specs: ["28px height", "14px radius", "16px leading icon", "1px inset border", "wraps across rows"],
  },
  {
    name: "TimelineSection",
    purpose: "Date-rail content for vehicles, activity, contact, and crews.",
    specs: ["60px date rail", "480px content", "64px row gap", "gray dates", "linked title with NE icon"],
  },
  {
    name: "HorizontalGallery",
    purpose: "Scrollable image strip for vehicles and activity entries.",
    specs: ["compact 89x90", "wide 160x90", "8px gap", "2px scrollbar", "subtle thumbnail border"],
  },
  {
    name: "MasonryGallery",
    purpose: "Vehicle media overview with asymmetric hero and supporting tiles.",
    specs: ["540px width", "16px gap", "mixed 2-column and 3-column rows", "rounded image tiles"],
  },
  {
    name: "FeedCard",
    purpose: "Explore masonry card for build posts, cars, listings, and social content.",
    specs: ["294px base width", "#333 card fill", "#353945 border", "21px radius", "reply input + heart action"],
  },
  {
    name: "SettingsModal",
    purpose: "Overlay editor for profile, vehicle, activity, contact, and crews.",
    specs: ["840px modal", "dimmed backdrop", "left nav", "right form panel", "list editor pattern"],
  },
  {
    name: "MarketingFeatureCard",
    purpose: "Read.cv-inspired landing page feature card.",
    specs: ["#1C1C1E visual surface", "24px radius", "blue eyebrow", "white title", "gray description"],
  },
  {
    name: "FeatureRow",
    purpose: "Alternating marketing explainer row for search, writing, and build stories.",
    specs: ["50/50 visual and copy", "48px column gap", "large visual card", "compact CTA"],
  },
  {
    name: "PillButton",
    purpose: "Primary and secondary action pattern across product and marketing.",
    specs: ["40-48px height", "full radius", "white primary", "dark secondary", "16-24px horizontal padding"],
  },
];

const componentGroups = [
  {
    title: "App Shell",
    items: ["CollapsingSidebar", "ThemeToggle", "Logo", "ExploreTopNav", "MarketingTopNav", "MarketingSidebar"],
  },
  {
    title: "Profile and Vehicle",
    items: ["ProfileHeader", "ProfileInfo", "WebsitePill", "TabNavigation", "BioParagraph", "MetadataTag", "ContactRow", "CrewCard"],
  },
  {
    title: "Timeline and Media",
    items: ["TimelineSection", "TimelineDateRail", "LinkedTitle", "VehicleListItem", "ActivityEntry", "HorizontalGallery", "GalleryScrollbar", "MasonryGallery"],
  },
  {
    title: "Activity Detail",
    items: ["BackLink", "ActivityPostHeader", "ActivityBodySection", "EmbeddedVideo", "ReactionBar", "ReplyComposer"],
  },
  {
    title: "Explore and Settings",
    items: ["FilterPills", "FilterDropdown", "MasonryGrid", "FeedCard", "SettingsModal", "FormField", "RichTextEditor", "ListEntryEditor"],
  },
  {
    title: "Marketing",
    items: ["PageHero", "HeroVideo", "TestimonialGrid", "BentoFeatureGrid", "FeatureCard", "FeatureRow", "VisualCard", "SupporterCTA", "SiteFooter"],
  },
  {
    title: "Specialty Mocks",
    items: ["SearchTag", "AvatarCluster", "ShortcutKey", "ProfileTabMock", "PublishedBadge", "PasswordLockMock", "LogoCloud", "StatsCard"],
  },
];

// The end-to-end path a visitor takes through the owner/vehicle/activity screens.
// Captured here so the (non-obvious) drill-down behavior is documented alongside
// the components that implement it.
const navigationFlow: { title: string; detail: string }[] = [
  {
    title: "Opening a person shows their Profile",
    detail:
      "This is the page you see when you click into someone's profile — it is not the application's home/landing page. It shows who they are plus their cars and activity.",
  },
  {
    title: "The Profile surfaces the person's cars",
    detail:
      "The profile lists that person's cars (each with owner-entered tags, a color subtitle, and a photo strip) and shows activity across all of their cars.",
  },
  {
    title: "Clicking a car opens its Car Profile",
    detail:
      "Selecting a car takes you to that car's own page: the car profile, showing its modifications and details, plus the car's own Activity tab.",
  },
  {
    title: "The car's Activity tab is scoped to that car",
    detail:
      "On the Car Profile, the Activity tab shows the build log for that specific vehicle only — separate from the activity shown on the person's profile.",
  },
  {
    title: "Clicking an entry opens the Activity detail",
    detail:
      "An activity entry expands into a full post: title, body sections, image gallery, embedded video, emoji reactions, a reply input, and related posts.",
  },
];

// Behaviors that aren't visible in the static frames but matter for the build.
const functionalNotes: { title: string; detail: string }[] = [
  {
    title: "Car tags are user input",
    detail:
      "The chips above a car (e.g. '2024 Quantum Gray', 'Fort Lauderdale', 'Black Optic', 'Bagged', 'FBO', 'Fully Built') are entered by the owner and render on their profile as MetadataTags.",
  },
  {
    title: "Two levels of Activity",
    detail:
      "A person's profile shows activity across all of their cars; each car's own Activity tab is scoped to just that vehicle. Same ActivityEntry component, different scope.",
  },
  {
    title: "Links are the primary affordance",
    detail:
      "The ↗ LinkedTitle is how you drill in: titles on cars open the Car Profile; titles on activity open the Activity detail. Galleries are previews, not the navigation target.",
  },
];

// Short, plain-language note for each component: what it is and where it shows up
// in the product. Surfaced on every inventory card so the build list reads like
// documentation rather than just a list of names.
const componentPurposes: Record<string, string> = {
  // App shell
  CollapsingSidebar: "Left icon rail on every product page. Holds home, explore, profile, store, and analytics nav.",
  ThemeToggle: "Light/dark switch pinned to the bottom of the sidebar.",
  Logo: "DRVN mark in the sidebar and marketing nav; links home.",
  ExploreTopNav: "Full-width top bar used only on the Explore feed (logo, search, notifications, avatar).",
  MarketingTopNav: "Horizontal text nav for the public marketing pages.",
  MarketingSidebar: "Slim icon rail on marketing pages, mirroring the product shell.",
  // Profile and vehicle
  ProfileHeader: "Identity block at the top of a profile. Owner variant shows the person; vehicle variant shows the car.",
  ProfileInfo: "Name, @handle, and tagline beside the avatar.",
  WebsitePill: "Small rounded pill linking to the owner's personal site.",
  TabNavigation: "About / Activity switcher. Present on both owner and vehicle pages.",
  BioParagraph: "Free-text intro under the header (owner bio or car description).",
  MetadataTag: "Owner-entered attribute chip above a car (year, paint, location, 'Bagged', 'FBO', etc.). These are user input and render on the profile.",
  ContactRow: "Single contact line (website, Instagram, TikTok, email) in the Contact section.",
  CrewCard: "A crew/community the owner belongs to, listed in the Crews section.",
  // Timeline and media
  TimelineSection: "Date-rail + content layout shared by Vehicles, Activity, Contact, and Crews sections.",
  TimelineDateRail: "Left-aligned year or month label for each timeline row.",
  LinkedTitle: "Tappable title with a ↗ icon. On a car it opens the car page; on activity it opens the post.",
  VehicleListItem: "A car row in the owner's Vehicles section: linked name, color subtitle, and photo strip.",
  ActivityEntry: "A build-log row: date, linked title, description, and a photo strip.",
  HorizontalGallery: "Scrollable thumbnail strip used in vehicle and activity rows.",
  GalleryScrollbar: "Thin custom scrollbar under a horizontal gallery.",
  MasonryGallery: "Asymmetric photo grid on the vehicle About page (hero + supporting tiles).",
  // Activity detail
  BackLink: "'← Activity' breadcrumb returning to the car's activity feed.",
  ActivityPostHeader: "Avatar + post title + intro paragraph at the top of an activity detail page.",
  ActivityBodySection: "A sub-heading plus long-form body copy; repeats down the post.",
  EmbeddedVideo: "Inline media embed (e.g. YouTube) inside an activity post.",
  ReactionBar: "Emoji reactions (🔥 🤙 😯 📈) attached to a post.",
  ReplyComposer: "'Reply directly…' input for responding to a post.",
  // Explore and settings
  FilterPills: "Trending / Newest toggle on the Explore feed.",
  FilterDropdown: "Dark filter selector on the Explore feed.",
  MasonryGrid: "Four-column masonry layout the Explore cards sit in.",
  FeedCard: "Explore card variants (image-top, tall image, text-first social).",
  SettingsModal: "840px overlay editor (also a narrow, low-scroll layout) for profile, vehicle, and activity content.",
  FormField: "Labeled input/textarea/select used throughout settings.",
  RichTextEditor: "Formatting toolbar + body field for bios and posts.",
  ListEntryEditor: "Repeatable entry editor (title, date, media) for Vehicles and Activity.",
  // Marketing
  PageHero: "Eyebrow + headline + subhead at the top of a marketing page.",
  HeroVideo: "Rounded hero video with a centered play pill on the About hub.",
  TestimonialGrid: "Two-column serif quotes with attribution.",
  BentoFeatureGrid: "2×3 grid of feature cards linking to product pages.",
  FeatureCard: "Visual mock + title + description tile in a feature grid.",
  FeatureRow: "Alternating visual-left / copy-right explainer row.",
  VisualCard: "Dark rounded surface that hosts any product mock on marketing pages.",
  SupporterCTA: "Repeated 'Become a supporter' upsell before the footer.",
  SiteFooter: "Four-column link footer on every marketing page.",
  // Specialty mocks
  SearchTag: "Quantum Gray filter chip (e.g. 'Location: California') from the Search page.",
  AvatarCluster: "Overlapping avatars showing mutual connections.",
  ShortcutKey: "Keyboard key caps (⌘ K) for the command palette.",
  ProfileTabMock: "Mini profile-with-tabs illustration used in marketing.",
  PublishedBadge: "Green 'Published' status pill.",
  PasswordLockMock: "Locked content illustration for private posts.",
  LogoCloud: "Grid of partner/brand logos.",
  StatsCard: "Pricing/stats rows (price, impressions, CPM).",
};

function Swatch({ token }: { token: Token }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
      <div className={`h-20 rounded-2xl border border-white/10 ${token.className}`} />
      <p className="mt-4 text-sm font-semibold text-[#EEEEEE]">{token.name}</p>
      <p className="mt-1 font-mono text-xs text-[#888888]">{token.value}</p>
    </div>
  );
}

function Section({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-white/10 py-20">
      <div className="mb-10 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#3B71FE]">{eyebrow}</p>
        <h2 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-[#EEEEEE] md:text-5xl">{title}</h2>
        {description ? <p className="mt-4 text-base leading-7 text-[#BBBBBB]">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function SpecCard({ spec }: { spec: ComponentSpec }) {
  return (
    <article className="rounded-[28px] border border-white/10 bg-[#1E2124] p-5">
      <h3 className="text-lg font-semibold text-[#EEEEEE]">{spec.name}</h3>
      <p className="mt-2 text-sm leading-6 text-[#BBBBBB]">{spec.purpose}</p>
      <ul className="mt-5 grid gap-2">
        {spec.specs.map((item) => (
          <li key={item} className="rounded-2xl bg-black/20 px-3 py-2 text-xs text-[#999999]">
            {item}
          </li>
        ))}
      </ul>
    </article>
  );
}

function MiniSidebar() {
  const icons = ["D", "H", "E", "P", "M", "A"];

  return (
    <div className="flex h-[420px] w-24 flex-col justify-between rounded-[28px] bg-[#1E2124] p-6">
      <div className="grid gap-10">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#EEEEEE] text-lg font-black tracking-[-0.08em] text-[#1A1D1F]">
          D
        </div>
        <div className="grid gap-2">
          {icons.slice(1).map((icon, index) => (
            <div
              key={icon}
              className={`grid h-12 w-12 place-items-center rounded-xl text-sm font-semibold ${
                index === 1 ? "bg-[#272B30] text-[#EEEEEE] shadow-[inset_0_1px_1px_rgba(255,255,255,0.11)]" : "text-[#888888]"
              }`}
            >
              {icon}
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-4">
        <div className="h-px bg-white/10" />
        <div className="grid h-12 w-12 place-items-center rounded-full bg-[#111315] text-[#BBBBBB]">NB</div>
      </div>
    </div>
  );
}

function ProfileSpecimen() {
  const tags = ["2024", "Quantum Gray", "Fort Lauderdale", "Black Optic", "Bagged", "FBO", "Fully Built"];

  return (
    <div className="rounded-[32px] border border-white/10 bg-[#1A1D1F] p-6">
      <div className="mx-auto max-w-[540px]">
        <div className="flex items-start gap-8">
          <div className="h-[104px] w-[104px] rounded-full border border-white/10 bg-[radial-gradient(circle_at_35%_35%,#4E8CFF,#111315_68%)]" />
          <div className="min-w-0 flex-1">
            <h3 className="text-xl font-medium text-[#EEEEEE]">Audi S4</h3>
            <p className="mt-1 text-sm text-[#999999]">@mrawr2</p>
            <p className="mt-2 text-sm text-[#888888]">Product Designer in Fort Lauderdale, Florida</p>
            <span className="mt-3 inline-flex rounded-full bg-white/[0.05] px-3 py-1 text-[10px] text-[#CCCCCC]">
              mrawr2.com
            </span>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span key={tag} className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-[#BBBBBB]">
              {tag}
            </span>
          ))}
        </div>
        <div className="mt-8 flex h-8 gap-6 border-b border-white/10 text-sm">
          <span className="border-b border-[#EEEEEE] text-[#EEEEEE]">About</span>
          <span className="text-[#888888]">Activity</span>
        </div>
      </div>
    </div>
  );
}

function TimelineSpecimen() {
  const entries = [
    ["2024", "Audi S4", "Quantum Gray daily build with media, mods, activity, and linked listings."],
    ["Sep 2024", "AWE Touring Exhaust Install", "Installing the AWE Touring Exhaust and a few other parts over the weekend."],
    ["Sep 2024", "034 Intake and Heat Exchanger Install", "A scoped activity entry for the S4 build log."],
  ];

  return (
    <div className="rounded-[32px] border border-white/10 bg-[#1E2124] p-6">
      <div className="grid gap-8">
        {entries.map(([date, title, body], rowIndex) => (
          <div key={`${date}-${title}`} className="grid grid-cols-[72px_1fr] gap-5">
            <p className="text-right text-sm text-[#888888]">{date}</p>
            <div>
              <h3 className="text-sm text-[#EEEEEE]">{title} NE</h3>
              <p className="mt-1 text-sm leading-6 text-[#BBBBBB]">{body}</p>
              <div className="mt-4 flex gap-2 overflow-hidden">
                {[0, 1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className={`h-20 min-w-32 rounded-2xl border border-white/10 ${
                      rowIndex === 0
                        ? "bg-[linear-gradient(135deg,#1A1D1F,#3B71FE)]"
                        : "bg-[linear-gradient(135deg,#2A2E35,#6D7B8D)]"
                    }`}
                  />
                ))}
              </div>
              <div className="mt-3 h-0.5 rounded-full bg-[#383838]">
                <div className="h-full w-2/5 rounded-full bg-[#666666]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GallerySpecimen() {
  return (
    <div className="grid gap-4 rounded-[32px] border border-white/10 bg-[#1E2124] p-6">
      <div className="grid h-72 grid-cols-[0.7fr_1fr] gap-4">
        <div className="grid gap-4">
          <div className="rounded-[22px] bg-[linear-gradient(135deg,#0F1115,#3B71FE)]" />
          <div className="rounded-[22px] bg-[linear-gradient(135deg,#1E2124,#56616F)]" />
        </div>
        <div className="rounded-[22px] bg-[radial-gradient(circle_at_70%_30%,#7CA2FF,#15171A_65%)]" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="h-28 rounded-[22px] bg-[#272B30]" />
        <div className="h-28 rounded-[22px] bg-[#343A43]" />
        <div className="h-28 rounded-[22px] bg-[#20242A]" />
      </div>
    </div>
  );
}

// Activity detail page: the screen you reach by tapping a single activity entry
// inside a car's Activity tab. Kept to the 540px column so it reads as a focused,
// low-scroll post rather than a wide article.
function ActivityDetailSpecimen() {
  return (
    <div className="mx-auto w-full max-w-[540px] rounded-[32px] border border-white/10 bg-[#1E2124] p-6">
      <button type="button" className="flex items-center gap-2 text-sm font-medium text-[#888888]">
        <span aria-hidden>←</span> Activity
      </button>

      <div className="mt-6 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_25%,#4B83D6,#111315_70%)] text-[10px] font-bold text-white">
          NB
        </span>
        <h3 className="text-lg font-medium text-[#EEEEEE]">AWE Touring Exhaust Install</h3>
      </div>
      <p className="mt-4 text-sm leading-6 text-[#BBBBBB]">
        Recently picked up this 2024 Quantum Gray S4 as a daily. Just started modifying it. Looking forward to sharing
        how the build progresses. Stay tuned!
      </p>

      <div className="mt-6 grid h-56 grid-cols-[1fr_0.7fr] gap-3">
        <span className="rounded-[18px] bg-[radial-gradient(circle_at_60%_30%,#7CA2FF,#15171A_65%)]" />
        <div className="grid gap-3">
          <span className="rounded-[18px] bg-[linear-gradient(135deg,#0F1115,#3B71FE)]" />
          <span className="rounded-[18px] bg-[linear-gradient(135deg,#2A2E35,#6D7B8D)]" />
        </div>
      </div>

      <div className="mt-6">
        <h4 className="text-sm font-semibold text-[#EEEEEE]">Modifications</h4>
        <p className="mt-2 text-sm leading-6 text-[#BBBBBB]">
          Exterior, interior, performance, and suspension notes written as long-form body copy beneath each sub-heading.
        </p>
      </div>

      <div className="mt-6 grid h-44 place-items-center rounded-[18px] bg-[linear-gradient(135deg,#0C0C0C,#2A2A2A)]">
        <span className="grid h-11 w-16 place-items-center rounded-lg bg-[#FF0000] text-sm font-bold text-white">▶</span>
        <span className="mt-3 text-xs text-[#888888]">Embedded YouTube</span>
      </div>

      <div className="mt-6 border-t border-white/10 pt-5">
        <p className="text-sm text-[#888888]">Send D. Buko a reply about this page</p>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex flex-1 items-center justify-between rounded-full bg-[#272B30] px-4 py-3 text-xs text-[#888888]">
            Reply directly… <span className="text-[#666666]">↵</span>
          </div>
          {["🔥", "🤙", "😯", "📈"].map((emoji) => (
            <span key={emoji} className="grid h-9 w-9 place-items-center rounded-full bg-[#272B30] text-base">
              {emoji}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function CardAvatar() {
  return (
    <div className="grid size-[35px] shrink-0 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_25%,#4B83D6,#111315_70%)] text-[10px] font-bold text-white">
      NB
    </div>
  );
}

function CardMedia({ heightClass }: { heightClass: string }) {
  return (
    <div className={`${heightClass} relative w-full bg-[linear-gradient(135deg,#0C1117,#6E7C8F_42%,#D6D0BF)]`}>
      <div className="absolute left-[14px] top-[16px]">
        <CardAvatar />
      </div>
    </div>
  );
}

function CardInfo({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col gap-[8.8px] px-[17.6px] pb-[21px] pt-[14px]">
      <div className="flex flex-col gap-[3.5px]">
        <p className="font-['Poppins'] text-[10.6px] leading-[17.6px] text-[#777E90]">Mrawr2</p>
        <p className="font-['Poppins'] text-[12.4px] font-medium leading-[21px] text-[#FCFCFD]">{title}</p>
      </div>
      <p className="font-['Poppins'] text-[10.6px] leading-[17.6px] text-[#E6E8EC]">{body}</p>
    </div>
  );
}

function ReplyBar() {
  return (
    <div className="flex items-center gap-[14px] px-[17.6px] pb-[21px]">
      <div className="flex h-[31.8px] w-[212px] items-center justify-between rounded-[7px] bg-[#222222] pl-[10.6px] pr-[12px]">
        <span className="font-['Inter'] text-[12.4px] text-[#888888]">Reply directly...</span>
        <span className="text-[14px] text-[#888888]">☺</span>
      </div>
      <span className="text-[15.5px] text-[#EEEEEE]">❤️</span>
    </div>
  );
}

function SocialActionRow() {
  return (
    <div className="flex items-center justify-between px-[17.6px] pb-[21px]">
      <span className="text-[15px] text-[#888888]">💬</span>
      <span className="text-[15px] text-[#888888]">🔁</span>
      <span className="flex items-center gap-[7px] text-[15px] text-[#888888]">
        🤍 <span className="font-['Inter'] text-[10.6px] text-[#888888]">25</span>
      </span>
    </div>
  );
}

function ExploreSpecimen() {
  const title = "AWE Touring Exhaust Install";
  const body = "Installing the AWE Touring Exhaust and a few other parts over the weekend.";

  return (
    <div className="overflow-hidden rounded-[32px] border border-[#353945] bg-[#1A1D1F] p-6 text-[#FCFCFD] md:p-8">
      <div className="flex flex-wrap items-start justify-center gap-6">
        {/* Variant 1 — image top, reply bar */}
        <article className="w-[294px] overflow-hidden rounded-[21px] border-[0.883px] border-[#353945] bg-[#333333]">
          <CardMedia heightClass="h-[178px]" />
          <CardInfo title={title} body={body} />
          <ReplyBar />
        </article>

        {/* Variant 2 — tall image, reply bar */}
        <article className="w-[294px] overflow-hidden rounded-[21px] border-[0.883px] border-[#353945] bg-[#333333]">
          <CardMedia heightClass="h-[353px]" />
          <CardInfo title={title} body={body} />
          <ReplyBar />
        </article>

        {/* Variant 3 — text first, image, text, social actions */}
        <article className="w-[294px] overflow-hidden rounded-[21px] border-[0.883px] border-[#353945] bg-[#333333]">
          <CardInfo title={title} body={body} />
          <CardMedia heightClass="h-[178px]" />
          <CardInfo title={title} body={body} />
          <SocialActionRow />
        </article>
      </div>
    </div>
  );
}

function SettingsSpecimen() {
  const navItems = ["General", "Vehicles", "Activity", "Contact", "Crews", "Domain"];

  return (
    <div className="rounded-[32px] border border-white/10 bg-black/40 p-5">
      <div className="mx-auto grid max-w-4xl gap-6 rounded-[28px] border border-white/10 bg-[#1E2124] p-5 md:grid-cols-[220px_1fr]">
        <aside className="grid content-start gap-2">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#888888]">Profile</p>
          {navItems.map((item) => (
            <span
              key={item}
              className={`rounded-2xl px-4 py-3 text-sm ${item === "Vehicles" ? "bg-[#272B30] text-[#EEEEEE]" : "text-[#888888]"}`}
            >
              {item}
            </span>
          ))}
        </aside>
        <div className="rounded-[24px] border border-white/10 bg-[#1A1D1F] p-5">
          <h3 className="text-2xl font-semibold tracking-[-0.04em] text-[#EEEEEE]">Vehicle editor</h3>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {["Vehicle name", "Year", "Color", "Location"].map((label) => (
              <label key={label} className="grid gap-2 text-sm text-[#888888]">
                <span>{label}</span>
                <span className="h-12 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-[#BBBBBB]">
                  {label === "Vehicle name" ? "Audi S4" : "Add value"}
                </span>
              </label>
            ))}
          </div>
          <div className="mt-5 rounded-3xl border border-dashed border-white/15 bg-black/20 p-6 text-center text-sm text-[#888888]">
            Attach gallery, activity photos, and media
          </div>
        </div>
      </div>
    </div>
  );
}

function MarketingSpecimen() {
  return (
    <div className="rounded-[32px] bg-black p-6 text-white">
      <div className="mx-auto max-w-5xl">
        <nav className="flex flex-wrap gap-5 text-sm text-[#888888]">
          {["Front page", "Profiles", "Activity", "Search", "Crews", "About"].map((item) => (
            <span key={item} className={item === "About" ? "text-white" : ""}>
              {item}
            </span>
          ))}
        </nav>
        <div className="mt-16 max-w-2xl">
          <p className="text-sm font-semibold text-[#3B71FE]">For builders</p>
          <h3 className="mt-3 text-5xl font-semibold tracking-[-0.06em]">Beautiful automotive homepages.</h3>
          <p className="mt-4 text-lg leading-7 text-[#888888]">A marketing system for profiles, build stories, search, crews, and marketplace education.</p>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {["Profiles", "Build Logs", "Crew Pages"].map((title) => (
            <article key={title} className="rounded-[28px] border border-white/10 bg-[#1C1C1E] p-5">
              <div className="h-40 rounded-[22px] bg-[radial-gradient(circle_at_35%_35%,#2D5BFF,#262626_62%)]" />
              <p className="mt-5 text-sm text-[#3B71FE]">Product story</p>
              <h4 className="mt-1 text-xl font-semibold">{title}</h4>
              <p className="mt-2 text-sm leading-6 text-[#888888]">Read.cv-inspired feature card with a visual mock, eyebrow, title, and compact description.</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function SpecialtyMocks() {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      <div className="rounded-[28px] border border-white/10 bg-[#1E2124] p-5">
        <p className="text-sm font-semibold text-[#EEEEEE]">SearchTag</p>
        <div className="mt-6 rounded-full border border-[#3B71FE]/50 bg-[#3B71FE]/20 px-4 py-3 text-sm text-[#7CB7FF]">
          Location: California, United States
        </div>
      </div>
      <div className="rounded-[28px] border border-white/10 bg-[#1E2124] p-5">
        <p className="text-sm font-semibold text-[#EEEEEE]">AvatarCluster</p>
        <div className="mt-6 flex items-center justify-center -space-x-4">
          {["NB", "MC", "AC", "JK", "EL"].map((avatar) => (
            <div key={avatar} className="grid h-14 w-14 place-items-center rounded-full border-2 border-[#1E2124] bg-[#272B30] text-xs font-bold text-[#EEEEEE]">
              {avatar}
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-[28px] border border-white/10 bg-[#1E2124] p-5">
        <p className="text-sm font-semibold text-[#EEEEEE]">ShortcutKeyPair</p>
        <div className="mt-6 flex justify-center gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[#272B30] text-xl font-semibold text-white">Cmd</div>
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[#272B30] text-xl font-semibold text-white">K</div>
        </div>
      </div>
    </div>
  );
}

function PreviewAvatar({ size = "h-8 w-8" }: { size?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_25%,#4B83D6,#111315_70%)] text-[8px] font-bold text-white ${size}`}
    >
      NB
    </span>
  );
}

function ComponentPreview({ name }: { name: string }) {
  const shellComponents = ["CollapsingSidebar", "MarketingSidebar"];
  const navComponents = ["ExploreTopNav", "MarketingTopNav"];

  if (shellComponents.includes(name)) {
    return (
      <div className="flex h-full items-center gap-3">
        <div className="flex h-full w-10 flex-col justify-between rounded-2xl bg-[#1E2124] p-2">
          <span className="h-6 w-6 rounded-lg bg-white" />
          <div className="grid gap-1">
            {[0, 1, 2, 3].map((item) => (
              <span key={item} className={`h-5 w-6 rounded-md ${item === 1 ? "bg-[#272B30]" : "bg-white/10"}`} />
            ))}
          </div>
          <span className="h-6 w-6 rounded-full bg-[#272B30]" />
        </div>
        <div className="grid flex-1 content-center gap-1.5 text-[11px]">
          {["Home", "Explore", "Profile", "Garage"].map((label, index) => (
            <span key={label} className={index === 1 ? "font-medium text-[#EEEEEE]" : "text-[#888888]"}>
              {label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (navComponents.includes(name)) {
    return (
      <div className="grid h-full content-center">
        <div className="flex items-center justify-between rounded-2xl border border-[#353945] bg-[#1A1D1F] p-2.5">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-lg bg-[#3B71FE] text-[10px] font-bold text-white">D</span>
            <span className="text-xs font-semibold text-[#EEEEEE]">drvn</span>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-[#777E90]">Support</span>
            <span className="rounded-full border border-[#777E90] px-2 py-1 text-[#EEEEEE]">List build</span>
          </div>
        </div>
      </div>
    );
  }

  switch (name) {
    case "ThemeToggle":
      return (
        <div className="grid h-full place-items-center">
          <div className="flex h-12 w-24 items-center rounded-full bg-[#111315] p-1">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[#272B30] text-xs text-[#EEEEEE]">moon</span>
          </div>
        </div>
      );
    case "Logo":
      return (
        <div className="grid h-full place-items-center">
          <div className="grid h-16 w-16 place-items-center rounded-[20px] bg-[#3B71FE] font-brand text-2xl font-bold text-white">
            D
          </div>
        </div>
      );
    case "ProfileHeader":
    case "ProfileInfo":
      return (
        <div className="flex h-full items-center gap-3">
          <PreviewAvatar size="h-14 w-14" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[#EEEEEE]">Neil Barrow</p>
            <p className="text-xs text-[#888888]">@mrawr2</p>
            <p className="mt-1 text-[11px] leading-4 text-[#BBBBBB]">Product Designer in Fort Lauderdale, Florida</p>
          </div>
        </div>
      );
    case "WebsitePill":
    case "PillButton":
      return (
        <div className="grid h-full place-items-center">
          <span className="rounded-full border border-white/10 bg-white px-6 py-3 text-xs font-semibold text-[#1A1D1F]">
            mrawr2.com
          </span>
        </div>
      );
    case "TabNavigation":
      return (
        <div className="flex h-full items-center gap-6 border-b border-white/10 text-sm">
          <span className="self-center border-b border-[#EEEEEE] pb-2 text-[#EEEEEE]">About</span>
          <span className="pb-2 text-[#888888]">Activity</span>
        </div>
      );
    case "BioParagraph":
      return (
        <div className="grid h-full content-center">
          <p className="text-[11px] leading-[17px] text-[#BBBBBB]">
            Freelance illustrator from Verona, Italy. I create colorful, simple and geometric illustrations.
          </p>
        </div>
      );
    case "MetadataTag":
      return (
        <div className="flex h-full flex-wrap content-center gap-1.5">
          {["2024 Quantum Gray", "Fort Lauderdale", "Bagged", "FBO", "Fully Built"].map((tag) => (
            <span key={tag} className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-[#BBBBBB]">
              {tag}
            </span>
          ))}
        </div>
      );
    case "ContactRow":
      return (
        <div className="grid h-full content-center gap-2.5 text-[11px]">
          {[
            ["Website", "andychung.me"],
            ["Instagram", "@andychung"],
            ["Email", "hi@andychung.me"],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <span className="text-[#888888]">{label}</span>
              <span className="text-[#EEEEEE]">{value}</span>
            </div>
          ))}
        </div>
      );
    case "CrewCard":
    case "TeamMemberRow":
      return (
        <div className="grid h-full content-center gap-2">
          {[
            ["MC", "Miami Euros"],
            ["AC", "Lauderdale Bagged"],
          ].map(([initials, label]) => (
            <div key={label} className="flex items-center gap-3 rounded-2xl bg-black/20 p-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#272B30] text-[9px] font-bold text-[#EEEEEE]">
                {initials}
              </span>
              <span className="text-xs text-[#EEEEEE]">{label}</span>
            </div>
          ))}
        </div>
      );
    case "TimelineSection":
    case "TimelineDateRail":
    case "VehicleListItem":
    case "ActivityEntry":
      return (
        <div className="grid h-full content-center gap-4">
          {[
            ["2024", "Audi S4 ↗", "Quantum Gray"],
            ["Sep", "AWE Touring Exhaust Install ↗", "Installed the AWE exhaust this weekend."],
          ].map(([date, title, body]) => (
            <div key={title} className="grid grid-cols-[40px_1fr] gap-3">
              <span className="text-right text-[10px] text-[#888888]">{date}</span>
              <div>
                <p className="text-[11px] font-medium leading-4 text-[#EEEEEE]">{title}</p>
                <p className="mt-0.5 text-[10px] leading-[14px] text-[#888888]">{body}</p>
              </div>
            </div>
          ))}
        </div>
      );
    case "LinkedTitle":
      return (
        <div className="flex h-full items-center justify-center gap-1.5">
          <span className="text-sm font-medium text-[#EEEEEE]">Audi S4</span>
          <span className="text-xs text-[#888888]">↗</span>
        </div>
      );
    case "HorizontalGallery":
    case "GalleryScrollbar":
      return (
        <div className="grid h-full content-center gap-3 overflow-hidden">
          <div className="flex gap-2">
            {[0, 1, 2, 3].map((item) => (
              <span key={item} className="h-14 min-w-20 rounded-xl bg-[linear-gradient(135deg,#0F1115,#3B71FE)]" />
            ))}
          </div>
          <span className="h-0.5 w-full rounded-full bg-[#383838]">
            <span className="block h-full w-2/5 rounded-full bg-[#666666]" />
          </span>
        </div>
      );
    case "MasonryGallery":
      return (
        <div className="grid h-full grid-cols-[0.7fr_1fr] gap-2">
          <div className="grid gap-2">
            <span className="rounded-xl bg-[#272B30]" />
            <span className="rounded-xl bg-[#343A43]" />
          </div>
          <span className="rounded-xl bg-[radial-gradient(circle_at_70%_30%,#7CA2FF,#15171A_65%)]" />
        </div>
      );
    case "BackLink":
      return (
        <div className="flex h-full items-center gap-2">
          <span className="text-sm text-[#888888]">←</span>
          <span className="text-sm font-medium text-[#EEEEEE]">Activity</span>
        </div>
      );
    case "ActivityPostHeader":
      return (
        <div className="grid h-full content-center gap-2">
          <div className="flex items-center gap-2">
            <PreviewAvatar />
            <span className="text-xs font-medium text-[#EEEEEE]">AWE Touring Exhaust Install</span>
          </div>
          <p className="text-[11px] leading-4 text-[#BBBBBB]">
            Recently picked up this 2024 Quantum Gray S4 as a daily. Just started modifying it.
          </p>
        </div>
      );
    case "ActivityBodySection":
      return (
        <div className="grid h-full content-center gap-1.5">
          <p className="text-xs font-semibold text-[#EEEEEE]">Modifications</p>
          <p className="text-[11px] leading-4 text-[#BBBBBB]">
            Exterior, interior, performance, and suspension notes written as long-form body copy beneath the heading.
          </p>
        </div>
      );
    case "EmbeddedVideo":
      return (
        <div className="grid h-full place-items-center rounded-2xl bg-[linear-gradient(135deg,#0C0C0C,#2A2A2A)]">
          <span className="grid h-10 w-14 place-items-center rounded-lg bg-[#FF0000] text-xs font-bold text-white">▶</span>
        </div>
      );
    case "ReactionBar":
      return (
        <div className="flex h-full items-center justify-center gap-2 text-lg">
          {["🔥", "🤙", "😯", "📈"].map((emoji) => (
            <span key={emoji} className="grid h-9 w-9 place-items-center rounded-full bg-[#272B30]">{emoji}</span>
          ))}
        </div>
      );
    case "ReplyComposer":
      return (
        <div className="grid h-full content-center">
          <div className="flex items-center justify-between rounded-full bg-[#272B30] px-4 py-3 text-xs text-[#888888]">
            Reply directly… <span className="text-[#666666]">↵</span>
          </div>
        </div>
      );
    case "FilterPills":
      return (
        <div className="flex h-full items-center gap-2">
          <span className="rounded-full bg-[#E6E8EC] px-3 py-1.5 text-xs font-bold text-[#23262F]">Trending</span>
          <span className="rounded-full px-3 py-1.5 text-xs font-bold text-[#777E90]">Newest</span>
        </div>
      );
    case "FilterDropdown":
      return (
        <div className="grid h-full place-items-center">
          <div className="flex h-12 w-48 items-center justify-between rounded-xl border border-[#353945] px-4 text-sm text-[#FCFCFD]">
            Filter <span className="grid h-8 w-8 place-items-center rounded-full border border-[#353945]">v</span>
          </div>
        </div>
      );
    case "MasonryGrid":
      const masonryTileHeights = ["h-12", "h-16", "h-9", "h-14", "h-[72px]", "h-11", "h-[60px]", "h-10"];
      return (
        <div className="grid h-full grid-cols-4 gap-2">
          {masonryTileHeights.map((heightClass, index) => (
            <span key={`${heightClass}-${index}`} className={`rounded-xl bg-[#333333] ${heightClass}`} />
          ))}
        </div>
      );
    case "FeedCard":
      return (
        <div className="overflow-hidden rounded-[14px] border border-[#353945] bg-[#333333]">
          <div className="h-14 bg-[linear-gradient(135deg,#0C1117,#6E7C8F_42%,#D6D0BF)]" />
          <div className="grid gap-1 p-2.5">
            <p className="text-[9px] text-[#777E90]">Mrawr2</p>
            <p className="text-[10px] font-medium leading-3 text-[#FCFCFD]">AWE Exhaust Install</p>
            <p className="text-[9px] leading-3 text-[#E6E8EC]">Installed the AWE exhaust this weekend.</p>
            <div className="mt-1 flex h-6 items-center rounded-md bg-[#222222] px-2 text-[9px] text-[#888888]">
              Reply directly…
            </div>
          </div>
        </div>
      );
    case "SettingsModal":
    case "FormField":
    case "RichTextEditor":
    case "ListEntryEditor":
      return (
        <div className="grid h-full content-start gap-2 rounded-2xl border border-white/10 bg-[#1E2124] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#888888]">Display name</p>
          <div className="flex h-7 items-center rounded-lg border border-white/10 bg-black/20 px-2 text-[11px] text-[#EEEEEE]">
            Neil Barrow
          </div>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-[#888888]">Bio</p>
          <div className="rounded-lg border border-white/10 bg-black/20 p-2 text-[10px] leading-[14px] text-[#BBBBBB]">
            Freelance illustrator from Verona, Italy.
          </div>
        </div>
      );
    case "PageHero":
      return (
        <div className="grid h-full content-center gap-2">
          <p className="text-[10px] font-semibold text-[#3B71FE]">For builders</p>
          <p className="text-lg font-semibold leading-5 tracking-[-0.04em] text-white">Beautiful automotive homepages.</p>
          <p className="text-[10px] leading-[14px] text-[#888888]">A marketing system for profiles, build stories, and crews.</p>
        </div>
      );
    case "HeroVideo":
      return (
        <div className="grid h-full place-items-center rounded-3xl bg-[linear-gradient(135deg,#111315,#3B71FE_55%,#111315)]">
          <span className="rounded-full bg-black/50 px-4 py-2 text-xs text-white">Watch film</span>
        </div>
      );
    case "TestimonialGrid":
      return (
        <div className="grid h-full grid-cols-2 gap-3">
          {[
            ["“Finally a home for my build.”", "Marco C."],
            ["“The cleanest car profiles.”", "Ava L."],
          ].map(([quote, name]) => (
            <div key={name} className="grid content-center gap-2">
              <p className="text-[11px] leading-4 text-[#BBBBBB]">{quote}</p>
              <div className="flex items-center gap-2">
                <PreviewAvatar size="h-6 w-6" />
                <span className="text-[10px] text-[#888888]">{name}</span>
              </div>
            </div>
          ))}
        </div>
      );
    case "BentoFeatureGrid":
      return (
        <div className="grid h-full grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((item) => (
            <span key={item} className="rounded-xl bg-[#1C1C1E] border border-white/10" />
          ))}
        </div>
      );
    case "FeatureCard":
    case "VisualCard":
    case "MarketingFeatureCard":
      return (
        <div className="rounded-[18px] border border-white/10 bg-[#1C1C1E] p-3">
          <div className="h-14 rounded-2xl bg-[radial-gradient(circle_at_35%_35%,#2D5BFF,#262626_62%)]" />
          <p className="mt-2.5 text-[10px] font-semibold text-[#3B71FE]">Product story</p>
          <p className="mt-1 text-xs font-semibold text-white">Build Logs</p>
        </div>
      );
    case "FeatureRow":
      return (
        <div className="grid h-full grid-cols-2 items-center gap-3">
          <span className="h-full rounded-2xl bg-[radial-gradient(circle_at_40%_40%,#2D5BFF,#1C1C1E_62%)]" />
          <div className="grid content-center gap-1.5">
            <p className="text-[10px] font-semibold text-[#3B71FE]">Crews</p>
            <p className="text-xs font-semibold leading-4 text-white">Find your local scene.</p>
            <p className="text-[10px] leading-[14px] text-[#888888]">Join crews and share builds.</p>
          </div>
        </div>
      );
    case "SupporterCTA":
      return (
        <div className="grid h-full place-items-center text-center">
          <div>
            <p className="text-[11px] leading-4 text-[#BBBBBB]">Support an independent build community.</p>
            <span className="mt-3 inline-block rounded-full bg-white px-4 py-2 text-[11px] font-semibold text-black">
              Become a supporter
            </span>
          </div>
        </div>
      );
    case "SiteFooter":
      return (
        <div className="grid h-full grid-cols-4 content-center gap-3 text-[10px]">
          {[
            ["Product", ["Profiles", "Crews", "Search"]],
            ["Company", ["About", "Careers", "Press"]],
            ["Resources", ["Help", "Guides", "API"]],
            ["Legal", ["Terms", "Privacy", "DMCA"]],
          ].map(([heading, links]) => (
            <div key={heading as string} className="grid gap-1.5">
              <span className="font-semibold text-[#EEEEEE]">{heading as string}</span>
              {(links as string[]).map((link) => (
                <span key={link} className="text-[#888888]">{link}</span>
              ))}
            </div>
          ))}
        </div>
      );
    case "SearchTag":
      return (
        <div className="grid h-full place-items-center">
          <span className="rounded-full border border-[#3B71FE]/50 bg-[#3B71FE]/20 px-4 py-3 text-xs text-[#7CB7FF]">
            Location: California
          </span>
        </div>
      );
    case "AvatarCluster":
      return (
        <div className="flex h-full items-center justify-center -space-x-3">
          {["NB", "MC", "AC", "EL"].map((avatar) => (
            <PreviewAvatar key={avatar} size="h-10 w-10" />
          ))}
        </div>
      );
    case "ShortcutKey":
      return (
        <div className="flex h-full items-center justify-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#272B30] font-semibold text-white">Cmd</span>
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#272B30] font-semibold text-white">K</span>
        </div>
      );
    case "ProfileTabMock":
      return (
        <div className="rounded-2xl border border-white/10 bg-[#1C1C1E] p-4">
          <div className="flex items-center gap-3">
            <PreviewAvatar />
            <span className="text-xs font-semibold text-white">Neil Barrow</span>
          </div>
          <div className="mt-4 flex gap-4 text-xs">
            <span className="border-b border-white pb-1 text-white">About</span>
            <span className="text-[#888888]">Activity</span>
          </div>
        </div>
      );
    case "PublishedBadge":
      return (
        <div className="grid h-full place-items-center">
          <span className="rounded-full bg-[#34C759]/20 px-4 py-2 text-sm font-semibold text-[#34C759]">Published</span>
        </div>
      );
    case "PasswordLockMock":
      return (
        <div className="grid h-full content-center gap-2">
          <div className="flex h-9 items-center rounded-xl bg-[#272B30] px-3 text-xs tracking-[0.3em] text-[#888888]">
            ••••••••
          </div>
          <span className="ml-auto rounded-xl bg-[#333333] px-4 py-2 text-xs font-semibold text-white">Submit</span>
        </div>
      );
    case "LogoCloud":
      return (
        <div className="grid h-full grid-cols-3 content-center gap-3">
          {["loom", "Figma", "coda", "shop", "Brex", "MH"].map((logo) => (
            <span key={logo} className="text-center text-xs font-semibold text-[#BBBBBB]">{logo}</span>
          ))}
        </div>
      );
    case "StatsCard":
      return (
        <div className="grid content-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
          {["Price per month $99", "Impressions ~100k", "CPM $1.00"].map((row) => (
            <div key={row} className="flex justify-between gap-4 text-[10px] text-[#BBBBBB]">
              <span>{row.split(" ").slice(0, -1).join(" ")}</span>
              <span className="text-white">{row.split(" ").at(-1)}</span>
            </div>
          ))}
        </div>
      );
    default:
      return (
        <div className="grid h-full place-items-center">
          <span className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-[#BBBBBB]">
            {name}
          </span>
        </div>
      );
  }
}

function ComponentInventoryCard({ name }: { name: string }) {
  const purpose = componentPurposes[name];
  return (
    <article className="flex flex-col rounded-[24px] border border-white/10 bg-[#1A1D1F] p-3">
      <div className="h-36 rounded-[18px] border border-white/10 bg-[#111315] p-4">
        <ComponentPreview name={name} />
      </div>
      <h4 className="mt-3 text-sm font-semibold text-[#EEEEEE]">{name}</h4>
      {purpose ? (
        <p className="mt-1.5 text-xs leading-[18px] text-[#888888]">{purpose}</p>
      ) : null}
    </article>
  );
}

export default function DesignSystemPage() {
  return (
    <main className="min-h-screen bg-[#1A1D1F] text-[#EEEEEE]">
      <div className="mx-auto max-w-[1440px] px-5 py-6 md:px-10 xl:px-20">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
          <Link href="/" className="font-brand text-2xl font-bold tracking-[-0.06em] text-white">
            DRVN
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-[#BBBBBB]">
              Design system direction
            </span>
            <Link
              href="/mockup"
              className="rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-[#EEEEEE] transition hover:bg-white/10"
            >
              Open clickable mockup
            </Link>
            <Link href="/" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#1A1D1F]">
              Back to home
            </Link>
          </div>
        </header>

        <section className="grid min-h-[680px] gap-10 py-20 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.32em] text-[#3B71FE]">
              Canonical component spec
            </p>
            <h1 className="mt-5 max-w-4xl text-6xl font-semibold tracking-[-0.075em] text-white md:text-8xl">
              DRVN should feel like Read.cv for car culture.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#BBBBBB]">
              These are the components the product is built from — the profile timeline, linked
              titles, vehicle gallery, activity detail, and explore feed. The live library above
              renders the shipped, token-driven versions of exactly these patterns.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#live" className="rounded-full bg-[#3B71FE] px-5 py-3 text-sm font-semibold text-white">
                Live component library
              </a>
              <a href="#components" className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#1A1D1F]">
                View components
              </a>
              <a href="#inventory" className="rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-[#EEEEEE]">
                Component inventory
              </a>
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-[96px_1fr]">
            <MiniSidebar />
            <div className="grid gap-5">
              <ProfileSpecimen />
              <TimelineSpecimen />
            </div>
          </div>
        </section>

        <LiveLibrary />

        <Section
          eyebrow="00 / How it works"
          title="Product map & functional model"
          description="Notes on how these screens connect so the intent isn't lost. Several behaviors here aren't obvious from the static frames."
        >
          <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <article className="rounded-[28px] border border-white/10 bg-[#1E2124] p-6">
              <h3 className="text-lg font-semibold text-[#EEEEEE]">Navigation flow</h3>
              <ol className="mt-5 grid gap-4">
                {navigationFlow.map((step, index) => (
                  <li key={step.title} className="grid grid-cols-[28px_1fr] gap-3">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-[#272B30] text-xs font-semibold text-[#3B71FE]">
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[#EEEEEE]">{step.title}</p>
                      <p className="mt-1 text-sm leading-6 text-[#BBBBBB]">{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </article>
            <article className="rounded-[28px] border border-[#3B71FE]/25 bg-[#11151C] p-6">
              <h3 className="text-lg font-semibold text-[#EEEEEE]">Why the 540px column</h3>
              <p className="mt-4 text-sm leading-6 text-[#BBBBBB]">
                The profile, vehicle, and settings pages are intentionally capped to a single 540px
                column. It&rsquo;s a deliberate, phone-first choice: the page should read like a quick,
                low-scroll brief on a phone screen rather than a sprawling desktop layout. Wide,
                discovery-heavy surfaces like Explore and the marketing pages are exempt &mdash; the
                constraint only applies where a tight, scannable summary is the goal.
              </p>
            </article>
          </div>
          <div className="mt-5 grid gap-5 md:grid-cols-3">
            {functionalNotes.map((note) => (
              <article key={note.title} className="rounded-[24px] border border-white/10 bg-[#1A1D1F] p-5">
                <h4 className="text-sm font-semibold text-[#EEEEEE]">{note.title}</h4>
                <p className="mt-2 text-sm leading-6 text-[#BBBBBB]">{note.detail}</p>
              </article>
            ))}
          </div>
        </Section>

        <Section
          eyebrow="01 / Brand foundation"
          title="Tokens for the direction"
          description="The product surface stays dark, narrow, and editorial. Marketing pages move even darker with pure black cards and blue feature accents."
        >
          <div className="grid gap-4 md:grid-cols-4">
            {productTokens.map((token) => (
              <Swatch key={token.name} token={token} />
            ))}
          </div>
          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            <div className="rounded-[28px] border border-white/10 bg-[#1E2124] p-6">
              <p className="text-sm text-[#888888]">Profile name</p>
              <p className="mt-3 text-xl font-medium text-[#EEEEEE]">Audi S4</p>
              <p className="mt-2 text-sm text-[#999999]">@mrawr2</p>
            </div>
            <div className="rounded-[28px] border border-white/10 bg-[#1E2124] p-6">
              <p className="text-sm text-[#888888]">Body paragraph</p>
              <p className="mt-3 text-sm leading-[22.4px] text-[#BBBBBB]">
                Recently picked up this 2024 Quantum Gray S4 as a daily. Looking forward to sharing how the build progresses.
              </p>
            </div>
            <div className="rounded-[28px] border border-white/10 bg-black p-6">
              <p className="text-sm font-semibold text-[#3B71FE]">Marketing eyebrow</p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-white">Beautiful build pages.</p>
            </div>
          </div>
        </Section>

        <Section
          eyebrow="02 / Product surfaces"
          title="Core product components"
          description="These are the pieces needed for owner profiles, vehicle About pages, and vehicle Activity tabs."
        >
          <div id="components" className="grid gap-6 xl:grid-cols-2">
            <ProfileSpecimen />
            <TimelineSpecimen />
            <GallerySpecimen />
            <SettingsSpecimen />
          </div>
        </Section>

        <Section
          eyebrow="02b / Activity detail"
          title="The page behind an activity entry"
          description="Tapping a single activity entry opens this focused post. It stays in the 540px column — a '← Activity' breadcrumb back to the car's feed, a post header, long-form body sections, image gallery, an embedded video, and emoji reactions with a reply input."
        >
          <ActivityDetailSpecimen />
        </Section>

        <Section
          eyebrow="03 / Discovery"
          title="Explore card system"
          description="Three Figma card variants on #333 surfaces with #353945 borders: (1) image-top + reply bar, (2) tall image + reply bar, (3) text-first with image and a social action row (comment, repost, like + count)."
        >
          <ExploreSpecimen />
        </Section>

        <Section
          eyebrow="04 / Marketing"
          title="Landing-page language"
          description="The Read.cv marketing screenshots introduce the top nav, side rail, bento feature cards, feature rows, testimonials, logo clouds, and supporter CTAs."
        >
          <MarketingSpecimen />
        </Section>

        <Section
          eyebrow="05 / Specialty patterns"
          title="Reusable interaction mocks"
          description="Search filters, mutual connections, keyboard shortcuts, published badges, password locks, and stats cards can start as marketing visuals and graduate into product UI."
        >
          <SpecialtyMocks />
        </Section>

        <Section
          eyebrow="06 / Inventory"
          title="Component creation checklist"
          description="A visual build list pulled from the full design doc, grouped by implementation domain. Each card renders a real example of the component with its actual content and styling, plus a note on what it's for."
        >
          <div id="inventory" className="grid gap-6">
            {componentGroups.map((group) => (
              <article key={group.title} className="rounded-[28px] border border-white/10 bg-[#1E2124] p-6">
                <h3 className="text-xl font-semibold tracking-[-0.03em] text-[#EEEEEE]">{group.title}</h3>
                <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.items.map((item) => (
                    <ComponentInventoryCard key={item} name={item} />
                  ))}
                </div>
              </article>
            ))}
          </div>
          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {componentSpecs.map((spec) => (
              <SpecCard key={spec.name} spec={spec} />
            ))}
          </div>
        </Section>
      </div>
    </main>
  );
}
