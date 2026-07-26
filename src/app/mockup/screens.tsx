"use client";

/**
 * Screen-level compositions for the DRVN mockup. Each screen is presentational;
 * navigation state and handlers are owned by the page and passed in as props.
 */

import {
  type ActivityPost,
  type Car,
  exploreCards,
  person,
  type Tone,
} from "./data";
import {
  Avatar,
  HorizontalGallery,
  Icon,
  MetadataTags,
  NarrowColumn,
  Photo,
  SectionLabel,
  TabNav,
} from "./ui";

const PROFILE_TABS = ["About", "Activity"];
const CAR_TABS = ["About", "Activity"];
const REACTIONS = ["🔥", "🤙", "😯", "📈"];

interface OpenCar {
  (carId: string): void;
}

interface OpenActivity {
  (carId: string, postId: string): void;
}

/** Linked, tappable title with the drill-in glyph. */
function LinkedTitle({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex items-center gap-1.5 text-left text-[15px] font-medium text-[#EEEEEE]"
    >
      <span className="group-hover:underline">{label}</span>
      <span className="text-xs text-[#777E90] transition group-hover:text-[#BBBBBB]">↗</span>
    </button>
  );
}

function TimelineRow({ date, children }: { date: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[52px_1fr] gap-4">
      <span className="pt-0.5 text-right text-xs text-[#888888]">{date}</span>
      <div>{children}</div>
    </div>
  );
}

function ActivityRow({
  post,
  onOpen,
}: {
  post: ActivityPost;
  onOpen: () => void;
}) {
  return (
    <TimelineRow date={post.date}>
      <LinkedTitle label={post.title} onClick={onOpen} />
      <p className="mt-1 text-sm leading-6 text-[#BBBBBB]">{post.summary}</p>
      <div className="mt-3">
        <HorizontalGallery images={post.photos} />
      </div>
    </TimelineRow>
  );
}

/* ----------------------------- Profile screen ----------------------------- */

export function ProfileScreen({
  tab,
  onTab,
  onOpenCar,
  onOpenActivity,
}: {
  tab: string;
  onTab: (tab: string) => void;
  onOpenCar: OpenCar;
  onOpenActivity: OpenActivity;
}) {
  const allActivity = person.cars.flatMap((car) =>
    car.activity.map((post) => ({ car, post })),
  );

  return (
    <NarrowColumn>
      <header className="flex items-start gap-4">
        <Avatar size="h-[88px] w-[88px]" initials="NB" />
        <div className="min-w-0 flex-1 pt-1">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[#EEEEEE]">{person.name}</h1>
          <p className="text-sm text-[#888888]">{person.handle}</p>
          <p className="mt-1 text-sm text-[#BBBBBB]">{person.tagline}</p>
          <span className="mt-3 inline-flex rounded-full border border-white/10 bg-white px-4 py-1.5 text-xs font-semibold text-[#1A1D1F]">
            {person.website}
          </span>
        </div>
      </header>

      <div className="mt-8">
        <TabNav tabs={PROFILE_TABS} active={tab} onChange={onTab} />
      </div>

      {tab === "About" ? (
        <div className="mt-8 grid gap-12">
          <p className="text-sm leading-7 text-[#BBBBBB]">{person.bio}</p>

          <section>
            <SectionLabel>Vehicles</SectionLabel>
            <div className="mt-5 grid gap-8">
              {person.cars.map((car) => (
                <TimelineRow key={car.id} date={car.year}>
                  <LinkedTitle label={car.name} onClick={() => onOpenCar(car.id)} />
                  <p className="mt-0.5 text-sm text-[#888888]">{car.colorLabel}</p>
                  <div className="mt-3">
                    <MetadataTags tags={car.tags} />
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenCar(car.id)}
                    aria-label={`Open ${car.name}`}
                    className="mt-3 block w-full text-left"
                  >
                    <HorizontalGallery images={car.gallery} />
                  </button>
                </TimelineRow>
              ))}
            </div>
          </section>

          <section>
            <SectionLabel>Activity</SectionLabel>
            <div className="mt-5 grid gap-8">
              {allActivity.map(({ car, post }) => (
                <ActivityRow key={post.id} post={post} onOpen={() => onOpenActivity(car.id, post.id)} />
              ))}
            </div>
          </section>

          <section>
            <SectionLabel>Contact</SectionLabel>
            <div className="mt-5 grid gap-3">
              {person.contact.map((row) => (
                <div key={row.label} className="flex items-center justify-between text-sm">
                  <span className="text-[#888888]">{row.label}</span>
                  <span className="text-[#EEEEEE]">{row.value}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <SectionLabel>Crews</SectionLabel>
            <div className="mt-5 grid gap-3">
              {person.crews.map((crew) => (
                <div key={crew.name} className="flex items-center gap-3 rounded-2xl bg-black/20 p-3">
                  <Avatar size="h-9 w-9" initials={crew.initials} />
                  <span className="text-sm text-[#EEEEEE]">{crew.name}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="mt-8 grid gap-8">
          {allActivity.map(({ car, post }) => (
            <ActivityRow key={post.id} post={post} onOpen={() => onOpenActivity(car.id, post.id)} />
          ))}
        </div>
      )}
    </NarrowColumn>
  );
}

/* --------------------------- Car profile screen --------------------------- */

function VehicleGallery({ images }: { images: Tone[] }) {
  const [hero, ...rest] = images;
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-[1fr_0.7fr] gap-3">
        <Photo tone={hero} className="h-56 rounded-2xl border border-white/10" />
        <div className="grid gap-3">
          {rest.slice(0, 2).map((tone, index) => (
            <Photo key={`${tone}-${index}`} tone={tone} className="h-[106px] rounded-2xl border border-white/10" />
          ))}
        </div>
      </div>
      {rest.length > 2 ? (
        <div className="grid grid-cols-3 gap-3">
          {rest.slice(2, 5).map((tone, index) => (
            <Photo key={`${tone}-${index}`} tone={tone} className="h-24 rounded-2xl border border-white/10" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CarScreen({
  car,
  tab,
  onTab,
  onBack,
  onOpenActivity,
}: {
  car: Car;
  tab: string;
  onTab: (tab: string) => void;
  onBack: () => void;
  onOpenActivity: OpenActivity;
}) {
  return (
    <NarrowColumn>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm font-medium text-[#888888] hover:text-[#BBBBBB]"
      >
        <Icon name="back" className="h-4 w-4" /> {person.name}
      </button>

      <header className="mt-6 flex items-start gap-4">
        <Photo tone="blue" className="h-[88px] w-[88px] rounded-2xl border border-white/10" />
        <div className="min-w-0 flex-1 pt-1">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[#EEEEEE]">{car.name}</h1>
          <p className="text-sm text-[#888888]">
            {car.year} · {car.colorLabel}
          </p>
          <div className="mt-3">
            <MetadataTags tags={car.tags} />
          </div>
        </div>
      </header>

      <div className="mt-8">
        <TabNav tabs={CAR_TABS} active={tab} onChange={onTab} />
      </div>

      {tab === "About" ? (
        <div className="mt-8 grid gap-12">
          <p className="text-sm leading-7 text-[#BBBBBB]">{car.description}</p>

          <section>
            <SectionLabel>Gallery</SectionLabel>
            <div className="mt-5">
              <VehicleGallery images={car.gallery} />
            </div>
          </section>

          <section>
            <SectionLabel>Modifications</SectionLabel>
            <div className="mt-5 grid gap-5">
              {car.mods.map((mod) => (
                <div key={mod.label}>
                  <p className="text-sm font-medium text-[#EEEEEE]">{mod.label}</p>
                  <p className="mt-1 text-sm leading-6 text-[#BBBBBB]">{mod.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <SectionLabel>Wheels &amp; Tires</SectionLabel>
            <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
              {car.wheels.map((row, index) => (
                <div
                  key={row.label}
                  className={`flex items-center justify-between px-4 py-3 text-sm ${
                    index > 0 ? "border-t border-white/10" : ""
                  }`}
                >
                  <span className="text-[#888888]">{row.label}</span>
                  <span className="text-[#EEEEEE]">{row.value}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="mt-8 grid gap-8">
          {car.activity.map((post) => (
            <ActivityRow key={post.id} post={post} onOpen={() => onOpenActivity(car.id, post.id)} />
          ))}
        </div>
      )}
    </NarrowColumn>
  );
}

/* ------------------------- Activity detail screen ------------------------- */

export function ActivityDetailScreen({
  post,
  onBack,
}: {
  post: ActivityPost;
  onBack: () => void;
}) {
  return (
    <NarrowColumn>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm font-medium text-[#888888] hover:text-[#BBBBBB]"
      >
        <Icon name="back" className="h-4 w-4" /> Activity
      </button>

      <header className="mt-6 flex items-center gap-3">
        <Avatar size="h-10 w-10" initials="NB" />
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-[#EEEEEE]">{post.title}</h1>
      </header>
      <p className="mt-4 text-sm leading-7 text-[#BBBBBB]">{post.intro}</p>

      <div className="mt-6 grid grid-cols-[1fr_0.7fr] gap-3">
        <Photo tone={post.photos[0]} className="h-56 rounded-2xl border border-white/10" />
        <div className="grid gap-3">
          {post.photos.slice(1, 3).map((tone, index) => (
            <Photo key={`${tone}-${index}`} tone={tone} className="h-[106px] rounded-2xl border border-white/10" />
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-8">
        {post.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-sm font-semibold text-[#EEEEEE]">{section.heading}</h2>
            <p className="mt-2 text-sm leading-7 text-[#BBBBBB]">{section.body}</p>
          </section>
        ))}
      </div>

      {post.video ? (
        <div className="mt-8">
          <div className="relative grid h-52 place-items-center overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#0C0C0C,#2A2A2A)]">
            <span className="grid h-14 w-20 place-items-center rounded-xl bg-[#FF0000] text-white">
              <Icon name="play" className="h-6 w-6" />
            </span>
          </div>
          <p className="mt-2 text-xs text-[#888888]">{post.video.title}</p>
        </div>
      ) : null}

      <div className="mt-10 border-t border-white/10 pt-6">
        <p className="text-sm text-[#888888]">Send {person.name} a reply about this page</p>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex flex-1 items-center justify-between rounded-full bg-[#272B30] px-4 py-3 text-sm text-[#888888]">
            Reply directly… <span className="text-[#666666]">↵</span>
          </div>
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="grid h-10 w-10 place-items-center rounded-full bg-[#272B30] text-base transition hover:bg-[#31363c]"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </NarrowColumn>
  );
}

/* ----------------------------- Explore screen ----------------------------- */

function FeedCard({ card }: { card: (typeof exploreCards)[number] }) {
  const media = <Photo tone={card.tone} className="w-full rounded-t-[18px]" />;
  return (
    <article className="overflow-hidden rounded-[18px] border border-[#353945] bg-[#333333]">
      {card.variant !== "text-first" ? (
        <div className={card.variant === "tall-image" ? "h-64" : "h-40"}>{media}</div>
      ) : null}
      <div className="grid gap-1.5 px-4 pb-3 pt-3.5">
        <p className="text-[11px] text-[#777E90]">{card.author}</p>
        <p className="text-[13px] font-medium leading-5 text-[#FCFCFD]">{card.title}</p>
        <p className="text-[11px] leading-[18px] text-[#E6E8EC]">{card.body}</p>
      </div>
      {card.variant === "text-first" ? (
        <div className="h-40 px-4 pb-4">
          <Photo tone={card.tone} className="h-full w-full rounded-[14px]" />
        </div>
      ) : null}
      {card.variant === "text-first" ? (
        <div className="flex items-center gap-4 px-4 pb-4 text-[#777E90]">
          <span className="text-xs">12 replies</span>
          <span className="ml-auto">
            <Icon name="heart" className="h-4 w-4" />
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-3 px-4 pb-4">
          <div className="flex h-8 flex-1 items-center rounded-lg bg-[#222222] px-3 text-xs text-[#888888]">
            Reply directly…
          </div>
          <Icon name="heart" className="h-4 w-4 text-[#EEEEEE]" />
        </div>
      )}
    </article>
  );
}

export function ExploreScreen({
  sort,
  onSort,
}: {
  sort: string;
  onSort: (sort: string) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-10 md:px-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-5xl font-bold tracking-[-0.04em] text-[#FCFCFD]">Explore</h1>
        <button
          type="button"
          className="rounded-full bg-[#3B71FE] px-5 py-3 text-sm font-bold text-white"
        >
          Advanced filter
        </button>
      </div>
      <div className="mt-7 h-px bg-[#353945]" />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-2">
          {["Trending", "Newest"].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onSort(option)}
              className={`rounded-full px-3 py-1.5 text-sm font-bold ${
                option === sort ? "bg-[#E6E8EC] text-[#23262F]" : "text-[#777E90] hover:text-[#BBBBBB]"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="flex h-12 w-full items-center justify-between rounded-xl border border-[#353945] px-4 text-sm text-[#FCFCFD] sm:w-64"
        >
          Filter
          <span className="grid h-8 w-8 place-items-center rounded-full border border-[#353945] text-[#777E90]">v</span>
        </button>
      </div>

      <div className="mt-8 columns-1 gap-5 sm:columns-2 xl:columns-3 [&>*]:mb-5 [&>*]:break-inside-avoid">
        {exploreCards.map((card) => (
          <FeedCard key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- Settings screen ---------------------------- */

const SETTINGS_NAV = ["Account", "Profile", "Vehicles", "Activity", "Branding", "Billing", "Notifications"];

function Field({ label, value, type = "text" }: { label: string; value: string; type?: "text" | "textarea" }) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#888888]">{label}</span>
      {type === "textarea" ? (
        <textarea
          defaultValue={value}
          rows={3}
          className="resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-[#EEEEEE] outline-none focus:border-[#3B71FE]"
        />
      ) : (
        <input
          defaultValue={value}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-[#EEEEEE] outline-none focus:border-[#3B71FE]"
        />
      )}
    </label>
  );
}

export function SettingsScreen({
  section,
  onSection,
}: {
  section: string;
  onSection: (section: string) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[900px] px-6 py-10 md:px-10">
      <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#1E2124]">
        <div className="grid md:grid-cols-[200px_1fr]">
          <nav className="border-b border-white/10 p-3 md:border-b-0 md:border-r">
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#777E90]">Settings</p>
            <div className="flex gap-1 overflow-x-auto md:grid md:gap-0.5">
              {SETTINGS_NAV.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => onSection(item)}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition ${
                    item === section ? "bg-[#272B30] text-[#EEEEEE]" : "text-[#888888] hover:text-[#BBBBBB]"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </nav>

          <div className="p-6 md:p-8">
            <h2 className="text-lg font-semibold text-[#EEEEEE]">{section}</h2>
            <p className="mt-1 text-sm text-[#888888]">
              Edit the content that appears on your {section.toLowerCase()} section.
            </p>
            <div className="mt-6 grid gap-5">
              {section === "Profile" ? (
                <>
                  <Field label="Display name" value={person.name} />
                  <Field label="Handle" value={person.handle} />
                  <Field label="Tagline" value={person.tagline} />
                  <Field label="Bio" value={person.bio} type="textarea" />
                </>
              ) : section === "Vehicles" ? (
                <>
                  <Field label="Year" value="2024" />
                  <Field label="Name" value="Audi S4" />
                  <Field label="Color" value="Quantum Gray" />
                  <Field label="Tags (comma separated)" value={person.cars[0].tags.join(", ")} type="textarea" />
                </>
              ) : (
                <>
                  <Field label="Title" value="AWE Touring Exhaust Install" />
                  <Field label="Date" value="Sep 2024" />
                  <Field label="Body" value={person.cars[0].activity[0].intro} type="textarea" />
                </>
              )}
            </div>
            <div className="mt-7 flex justify-end gap-3">
              <button type="button" className="rounded-full px-4 py-2 text-sm font-semibold text-[#888888]">
                Cancel
              </button>
              <button type="button" className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-[#1A1D1F]">
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
