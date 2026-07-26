"use client";

import Link from "next/link";
import { FormEvent, ReactNode, useMemo, useState } from "react";

import {
  Avatar,
  HorizontalGallery,
  Icon,
  Media,
  MetadataTags,
  NarrowColumn,
  SectionLabel,
  Sidebar,
  TabNav,
  type SidebarNavItem,
} from "@/components/drvn/ui";
import {
  categories,
  currentProfile,
  heroImage,
  initialBuilds,
  initialCars,
  initialListings,
  type ActivityPost,
  type Car,
  type Listing,
} from "@/lib/drvn-data";
import { cx, money } from "@/lib/format";

type PageKey =
  | "home"
  | "explore"
  | "marketplace"
  | "sell"
  | "garage"
  | "profile"
  | "saved"
  | "notifications"
  | "settings"
  | "listing"
  | "car"
  | "activity"
  | "build";

type FilterState = {
  keyword: string;
  make: string;
  model: string;
  platform: string;
  category: string;
  condition: string;
  maxPrice: string;
  location: string;
  fulfillment: string;
};

type SellFormState = {
  title: string;
  category: string;
  condition: string;
  price: string;
  sourceCarId: string;
  compatibility: string;
  location: string;
  notes: string;
};

const primaryNav: SidebarNavItem<PageKey>[] = [
  { key: "home", icon: "home", label: "Home" },
  { key: "explore", icon: "compass", label: "Explore" },
  { key: "marketplace", icon: "market", label: "Marketplace" },
  { key: "garage", icon: "garage", label: "Garage" },
  { key: "profile", icon: "user", label: "Profile" },
];

const utilityNav: SidebarNavItem<PageKey>[] = [
  { key: "notifications", icon: "bell", label: "Notifications" },
  { key: "saved", icon: "bookmark", label: "Saved" },
  { key: "settings", icon: "settings", label: "Settings" },
];

const profileTabs = ["About", "Activity"];
const carTabs = ["About", "Activity"];
const settingsSections = ["Account", "Profile", "Vehicles", "Activity", "Branding", "Billing", "Notifications"];
const reactions = ["fire", "shaka", "wow", "chart"];

function Button({
  children,
  variant = "primary",
  onClick,
  type = "button",
  className,
  disabled,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  onClick?: () => void;
  type?: "button" | "submit";
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex h-11 items-center justify-center rounded-full px-5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-[#3B71FE] text-white hover:bg-blue-500",
        variant === "secondary" && "border border-white/10 bg-white/[0.04] text-[#EEEEEE] hover:bg-white/10",
        variant === "ghost" && "text-[#BBBBBB] hover:bg-white/10 hover:text-white",
        className,
      )}
    >
      {children}
    </button>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      value={value}
      type={type}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-[#EEEEEE] outline-none transition placeholder:text-[#777E90] focus:border-[#3B71FE]"
    />
  );
}

function SelectInput({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-[#EEEEEE] outline-none transition focus:border-[#3B71FE]"
    >
      {options.map((option) => (
        <option key={option}>{option}</option>
      ))}
    </select>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#888888]">{label}</span>
      {children}
    </label>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? (
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-[#3B71FE]">{eyebrow}</p>
        ) : null}
        <h2 className="text-4xl font-semibold tracking-[-0.05em] text-[#EEEEEE] md:text-5xl">{title}</h2>
        {description ? <p className="mt-4 text-base leading-7 text-[#BBBBBB]">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

function Surface({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[28px] border border-white/10 bg-[#1E2124] ${className}`}>{children}</div>;
}

function LinkedTitle({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group inline-flex items-center gap-1.5 text-left font-medium text-[#EEEEEE]">
      <span className="group-hover:underline">{label}</span>
      <span className="text-xs text-[#777E90] transition group-hover:text-[#BBBBBB]">-&gt;</span>
    </button>
  );
}

function TimelineRow({ date, children }: { date: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[52px_1fr] gap-4">
      <span className="pt-0.5 text-right text-xs text-[#888888]">{date}</span>
      <div>{children}</div>
    </div>
  );
}

function ListingCard({
  listing,
  car,
  saved,
  onOpen,
  onSave,
}: {
  listing: Listing;
  car?: Car;
  saved: boolean;
  onOpen: () => void;
  onSave: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-[24px] border border-[#353945] bg-[#333333]">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <Media src={listing.image} alt={listing.title} className="h-52 w-full" />
        <div className="p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-[#777E90]">{listing.category}</span>
            <span className="text-sm font-semibold text-[#EEEEEE]">{money.format(listing.price)}</span>
          </div>
          <h3 className="mt-2 text-base font-semibold leading-6 text-[#FCFCFD]">{listing.title}</h3>
          <p className="mt-2 text-sm leading-6 text-[#BBBBBB]">{listing.condition} - {listing.location}</p>
          {car ? <p className="mt-2 text-xs text-[#888888]">Source car: {car.name}</p> : null}
        </div>
      </button>
      <div className="flex items-center justify-between border-t border-white/10 px-4 py-3">
        <span className="text-xs text-[#777E90]">{listing.status}</span>
        <button type="button" onClick={onSave} className="text-[#EEEEEE]" aria-label={saved ? "Unsave listing" : "Save listing"}>
          <Icon name={saved ? "heart" : "bookmark"} className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

function VehicleGallery({ images, name }: { images: string[]; name: string }) {
  const [hero, ...rest] = images;
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-[1fr_0.7fr] gap-3">
        <Media src={hero} alt={`${name} hero`} className="h-56 rounded-2xl border border-white/10" />
        <div className="grid gap-3">
          {rest.slice(0, 2).map((image, index) => (
            <Media key={image} src={image} alt={`${name} detail ${index + 1}`} className="h-[106px] rounded-2xl border border-white/10" />
          ))}
        </div>
      </div>
      {rest.length > 2 ? (
        <div className="grid grid-cols-3 gap-3">
          {rest.slice(2, 5).map((image, index) => (
            <Media key={image} src={image} alt={`${name} gallery ${index + 1}`} className="h-24 rounded-2xl border border-white/10" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActivityRow({ post, onOpen }: { post: ActivityPost; onOpen: () => void }) {
  return (
    <TimelineRow date={post.date}>
      <LinkedTitle label={post.title} onClick={onOpen} />
      <p className="mt-1 text-sm leading-6 text-[#BBBBBB]">{post.summary}</p>
      <div className="mt-3">
        <HorizontalGallery images={post.photos} alt={post.title} />
      </div>
    </TimelineRow>
  );
}

function FeedCard({
  title,
  author,
  body,
  image,
  variant,
  onOpen,
}: {
  title: string;
  author: string;
  body: string;
  image: string;
  variant: "image-top" | "tall-image" | "text-first";
  onOpen: () => void;
}) {
  return (
    <article className="mb-5 break-inside-avoid overflow-hidden rounded-[21px] border border-[#353945] bg-[#333333]">
      {variant !== "text-first" ? (
        <button type="button" onClick={onOpen} aria-label={`Open ${title}`} className="block w-full text-left">
          <Media src={image} alt={title} className={variant === "tall-image" ? "h-80 w-full" : "h-44 w-full"} />
        </button>
      ) : null}
      <button type="button" onClick={onOpen} className="block w-full px-[18px] py-[14px] text-left">
        <p className="text-[11px] leading-[18px] text-[#777E90]">{author}</p>
        <h3 className="mt-1 text-[13px] font-medium leading-[21px] text-[#FCFCFD]">{title}</h3>
        <p className="mt-3 text-[11px] leading-[18px] text-[#E6E8EC]">{body}</p>
      </button>
      {variant === "text-first" ? (
        <button type="button" onClick={onOpen} aria-label={`Open ${title}`} className="block w-full px-[18px] pb-4">
          <Media src={image} alt={title} className="h-44 w-full rounded-[14px]" />
        </button>
      ) : null}
      <div className="flex items-center gap-3 px-[18px] pb-[21px]">
        <div className="flex h-8 flex-1 items-center rounded-[7px] bg-[#222222] px-3 text-[12px] text-[#888888]">
          Reply directly...
        </div>
        <Icon name="heart" className="h-4 w-4 text-[#EEEEEE]" />
      </div>
    </article>
  );
}

export default function Home() {
  const [activePage, setActivePage] = useState<PageKey>("home");
  const [cars, setCars] = useState<Car[]>(initialCars);
  const [builds] = useState(initialBuilds);
  const [listings, setListings] = useState<Listing[]>(initialListings);
  const [selectedListingId, setSelectedListingId] = useState(initialListings[0].id);
  const [selectedCarId, setSelectedCarId] = useState(initialCars[0].id);
  const [selectedPostId, setSelectedPostId] = useState(initialCars[0].activity[0].id);
  const [selectedBuildId] = useState(initialBuilds[0].id);
  const [savedIds, setSavedIds] = useState<string[]>(["listing-apr-downpipe", "car-supra"]);
  const [profileTab, setProfileTab] = useState("About");
  const [carTab, setCarTab] = useState("About");
  const [exploreSort, setExploreSort] = useState("Trending");
  const [settingsSection, setSettingsSection] = useState("Profile");
  const [filters, setFilters] = useState<FilterState>({
    keyword: "",
    make: "All",
    model: "All",
    platform: "All",
    category: "All",
    condition: "All",
    maxPrice: "",
    location: "",
    fulfillment: "All",
  });
  const [garageDraft, setGarageDraft] = useState({
    year: "",
    make: "",
    model: "",
    trim: "",
    platform: "",
  });
  const [sellForm, setSellForm] = useState<SellFormState>({
    title: "",
    category: "Exhaust",
    condition: "Used",
    price: "",
    sourceCarId: initialCars[0].id,
    compatibility: "B9.5 quattro, S4, Audi S3",
    location: "New York, NY",
    notes: "",
  });

  const selectedListing = listings.find((listing) => listing.id === selectedListingId) ?? listings[0];
  const selectedCar = cars.find((car) => car.id === selectedCarId) ?? cars[0];
  const selectedPost = selectedCar.activity.find((post) => post.id === selectedPostId) ?? selectedCar.activity[0];
  const selectedBuild = builds.find((build) => build.id === selectedBuildId) ?? builds[0];

  const allActivity = cars.flatMap((car) => car.activity.map((post) => ({ car, post })));
  const savedListings = listings.filter((listing) => savedIds.includes(listing.id));
  const savedCars = cars.filter((car) => savedIds.includes(car.id));

  const filteredListings = useMemo(() => {
    return listings.filter((listing) => {
      const linkedCar = cars.find((car) => car.id === listing.linkedCarId);
      const searchText = `${listing.title} ${listing.brand} ${listing.category} ${listing.compatibility.join(" ")}`.toLowerCase();
      const keywordMatch = searchText.includes(filters.keyword.toLowerCase());
      const makeMatch = filters.make === "All" || linkedCar?.make === filters.make;
      const modelMatch = filters.model === "All" || linkedCar?.model === filters.model;
      const platformMatch = filters.platform === "All" || linkedCar?.platform === filters.platform;
      const categoryMatch = filters.category === "All" || listing.category === filters.category;
      const conditionMatch = filters.condition === "All" || listing.condition === filters.condition;
      const priceMatch = !filters.maxPrice || listing.price <= Number(filters.maxPrice);
      const locationMatch = !filters.location || listing.location.toLowerCase().includes(filters.location.toLowerCase());
      const fulfillmentMatch =
        filters.fulfillment === "All" ||
        (filters.fulfillment === "Shipping" && listing.shipping) ||
        (filters.fulfillment === "Pickup" && listing.pickup);

      return keywordMatch && makeMatch && modelMatch && platformMatch && categoryMatch && conditionMatch && priceMatch && locationMatch && fulfillmentMatch;
    });
  }, [cars, filters, listings]);

  const activeSidebarPage: PageKey =
    activePage === "listing" || activePage === "sell"
      ? "marketplace"
      : activePage === "car" || activePage === "activity" || activePage === "build"
        ? "profile"
        : activePage;

  function navigate(page: PageKey) {
    setActivePage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openListing(id: string) {
    setSelectedListingId(id);
    navigate("listing");
  }

  function openCar(id: string) {
    setSelectedCarId(id);
    setCarTab("About");
    navigate("car");
  }

  function openActivity(carId: string, postId: string) {
    setSelectedCarId(carId);
    setSelectedPostId(postId);
    navigate("activity");
  }

  function toggleSaved(id: string) {
    setSavedIds((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]));
  }

  function publishListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sellForm.title || !sellForm.price) return;

    const sourceCar = cars.find((car) => car.id === sellForm.sourceCarId) ?? cars[0];
    const newListing: Listing = {
      id: `listing-${Date.now()}`,
      title: sellForm.title,
      category: sellForm.category,
      subcategory: "Owner-listed part",
      brand: sellForm.title.split(" ")[0] || "DRVN",
      product: sellForm.title,
      condition: sellForm.condition,
      price: Number(sellForm.price),
      location: sellForm.location,
      shipping: true,
      pickup: true,
      status: "Active",
      seller: currentProfile.name,
      sellerUsername: currentProfile.handle.replace("@", ""),
      linkedCarId: sellForm.sourceCarId,
      linkedBuildId: selectedBuild.id,
      compatibility: sellForm.compatibility.split(",").map((item) => item.trim()).filter(Boolean),
      notes: sellForm.notes || "Owner-created listing from the redesigned sell flow.",
      hardware: "Hardware details pending.",
      defects: "See seller notes.",
      image: sourceCar.gallery[0] ?? sourceCar.image,
      images: sourceCar.gallery,
      comments: [],
    };

    setListings((previous) => [newListing, ...previous]);
    setSelectedListingId(newListing.id);
    navigate("listing");
  }

  function addGarageCar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!garageDraft.year || !garageDraft.make || !garageDraft.model) return;

    const newCar: Car = {
      id: `car-${Date.now()}`,
      slug: `${garageDraft.year}-${garageDraft.make}-${garageDraft.model}`.toLowerCase().replace(/\s+/g, "-"),
      name: `${garageDraft.year} ${garageDraft.make} ${garageDraft.model}`,
      year: garageDraft.year,
      make: garageDraft.make,
      model: garageDraft.model,
      trim: garageDraft.trim || "Base",
      platform: garageDraft.platform || "Unknown",
      engine: "To be added",
      drivetrain: "To be added",
      transmission: "To be added",
      color: "To be added",
      owner: currentProfile.name,
      ownerUsername: currentProfile.handle.replace("@", ""),
      location: "Fort Lauderdale, FL",
      buildStatus: "Draft build",
      image: heroImage,
      gallery: [heroImage],
      description: "Draft car profile. Add photos, tags, modifications, and activity from Settings.",
      mods: [],
      tags: [garageDraft.year, garageDraft.make, garageDraft.model].filter(Boolean),
      colorLabel: "To be added",
      modGroups: [],
      wheels: [],
      activity: [],
      socials: [],
      followers: 0,
      saves: 0,
      likes: 0,
    };

    setCars((previous) => [newCar, ...previous]);
    setSelectedCarId(newCar.id);
    setGarageDraft({ year: "", make: "", model: "", trim: "", platform: "" });
    navigate("car");
  }

  function HomePage() {
    return (
      <div className="mx-auto w-full max-w-[1280px] px-6 py-10 md:px-10">
        <section className="grid min-h-[620px] overflow-hidden rounded-[36px] border border-white/10 bg-[#111315] lg:grid-cols-[1.05fr_0.95fr]">
          <div className="flex flex-col justify-between p-8 md:p-12">
            <div className="flex flex-wrap gap-2">
              {["Profiles", "Build logs", "Marketplace"].map((label) => (
                <span key={label} className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-[#BBBBBB]">
                  {label}
                </span>
              ))}
            </div>
            <div className="mt-16 max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.32em] text-[#3B71FE]">DRVN</p>
              <h1 className="mt-5 text-6xl font-semibold tracking-[-0.075em] text-white md:text-8xl">
                Car profiles with a marketplace attached.
              </h1>
              <p className="mt-6 text-lg leading-8 text-[#BBBBBB]">
                Build a clean read.cv-style home for your cars, document every change, and sell parts with source-car context.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button onClick={() => navigate("profile")}>Open Profile</Button>
                <Button variant="secondary" onClick={() => navigate("marketplace")}>Browse Parts</Button>
              </div>
            </div>
          </div>
          <div className="grid gap-4 border-t border-white/10 p-6 lg:border-l lg:border-t-0">
            <Media src={selectedCar.image} alt={selectedCar.name} className="min-h-[260px] rounded-[28px] border border-white/10" />
            <div className="grid gap-4 md:grid-cols-2">
              <Surface className="p-5">
                <p className="text-sm text-[#888888]">Featured car</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">{selectedCar.name}</h2>
                <p className="mt-2 text-sm leading-6 text-[#BBBBBB]">{selectedCar.description}</p>
                <Button variant="secondary" onClick={() => openCar(selectedCar.id)} className="mt-5">View car</Button>
              </Surface>
              <Surface className="p-5">
                <p className="text-sm text-[#888888]">Latest listing</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">{listings[0].title}</h2>
                <p className="mt-2 text-sm text-[#BBBBBB]">{money.format(listings[0].price)} - {listings[0].condition}</p>
                <Button variant="secondary" onClick={() => openListing(listings[0].id)} className="mt-5">View listing</Button>
              </Surface>
            </div>
          </div>
        </section>
      </div>
    );
  }

  function ProfilePage() {
    return (
      <NarrowColumn>
        <header className="flex items-start gap-4">
          <Avatar size="h-[88px] w-[88px]" initials="NB" />
          <div className="min-w-0 flex-1 pt-1">
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[#EEEEEE]">{currentProfile.name}</h1>
            <p className="text-sm text-[#888888]">{currentProfile.handle}</p>
            <p className="mt-1 text-sm text-[#BBBBBB]">{currentProfile.tagline}</p>
            <span className="mt-3 inline-flex rounded-full border border-white/10 bg-white px-4 py-1.5 text-xs font-semibold text-[#1A1D1F]">
              {currentProfile.website}
            </span>
          </div>
        </header>

        <div className="mt-8"><TabNav tabs={profileTabs} active={profileTab} onChange={setProfileTab} /></div>

        {profileTab === "About" ? (
          <div className="mt-8 grid gap-12">
            <p className="text-sm leading-7 text-[#BBBBBB]">{currentProfile.bio}</p>
            <section>
              <SectionLabel>Vehicles</SectionLabel>
              <div className="mt-5 grid gap-8">
                {cars.map((car) => (
                  <TimelineRow key={car.id} date={car.year}>
                    <LinkedTitle label={car.name} onClick={() => openCar(car.id)} />
                    <p className="mt-0.5 text-sm text-[#888888]">{car.colorLabel}</p>
                    <div className="mt-3"><MetadataTags tags={car.tags} /></div>
                    <button type="button" onClick={() => openCar(car.id)} aria-label={`Open ${car.name}`} className="mt-3 block w-full text-left">
                      <HorizontalGallery images={car.gallery} alt={car.name} />
                    </button>
                  </TimelineRow>
                ))}
              </div>
            </section>
            <section>
              <SectionLabel>Activity</SectionLabel>
              <div className="mt-5 grid gap-8">
                {allActivity.map(({ car, post }) => (
                  <ActivityRow key={post.id} post={post} onOpen={() => openActivity(car.id, post.id)} />
                ))}
              </div>
            </section>
            <section>
              <SectionLabel>Contact</SectionLabel>
              <div className="mt-5 grid gap-3">
                {currentProfile.contact.map((row) => (
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
                {currentProfile.crews.map((crew) => (
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
              <ActivityRow key={post.id} post={post} onOpen={() => openActivity(car.id, post.id)} />
            ))}
          </div>
        )}
      </NarrowColumn>
    );
  }

  function CarProfilePage() {
    const linkedListings = listings.filter((listing) => listing.linkedCarId === selectedCar.id);
    return (
      <NarrowColumn>
        <button type="button" onClick={() => navigate("profile")} className="flex items-center gap-1.5 text-sm font-medium text-[#888888] hover:text-[#BBBBBB]">
          <Icon name="back" className="h-4 w-4" /> {currentProfile.name}
        </button>
        <header className="mt-6 flex items-start gap-4">
          <Media src={selectedCar.image} alt={selectedCar.name} className="h-[88px] w-[88px] rounded-2xl border border-white/10" />
          <div className="min-w-0 flex-1 pt-1">
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[#EEEEEE]">{selectedCar.name}</h1>
            <p className="text-sm text-[#888888]">{selectedCar.year} - {selectedCar.colorLabel}</p>
            <div className="mt-3"><MetadataTags tags={selectedCar.tags} /></div>
          </div>
        </header>
        <div className="mt-8"><TabNav tabs={carTabs} active={carTab} onChange={setCarTab} /></div>
        {carTab === "About" ? (
          <div className="mt-8 grid gap-12">
            <p className="text-sm leading-7 text-[#BBBBBB]">{selectedCar.description}</p>
            <section>
              <SectionLabel>Gallery</SectionLabel>
              <div className="mt-5"><VehicleGallery images={[selectedCar.image, ...selectedCar.gallery]} name={selectedCar.name} /></div>
            </section>
            <section>
              <SectionLabel>Modifications</SectionLabel>
              <div className="mt-5 grid gap-5">
                {selectedCar.modGroups.map((mod) => (
                  <div key={mod.label}>
                    <p className="text-sm font-medium text-[#EEEEEE]">{mod.label}</p>
                    <p className="mt-1 text-sm leading-6 text-[#BBBBBB]">{mod.body}</p>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <SectionLabel>Wheels & Tires</SectionLabel>
              <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
                {selectedCar.wheels.map((row, index) => (
                  <div key={row.label} className={`flex items-center justify-between px-4 py-3 text-sm ${index > 0 ? "border-t border-white/10" : ""}`}>
                    <span className="text-[#888888]">{row.label}</span>
                    <span className="text-[#EEEEEE]">{row.value}</span>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <div className="flex items-center justify-between gap-4">
                <SectionLabel>Active listings from this car</SectionLabel>
                <Button variant="ghost" onClick={() => navigate("sell")} className="h-8 px-3 text-xs">List part</Button>
              </div>
              <div className="mt-5 grid gap-3">
                {linkedListings.map((listing) => (
                  <button key={listing.id} type="button" onClick={() => openListing(listing.id)} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-left">
                    <Media src={listing.image} alt={listing.title} className="h-14 w-20 shrink-0 rounded-xl" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[#EEEEEE]">{listing.title}</span>
                      <span className="text-xs text-[#888888]">{money.format(listing.price)} - {listing.status}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="mt-8 grid gap-8">
            {selectedCar.activity.map((post) => (
              <ActivityRow key={post.id} post={post} onOpen={() => openActivity(selectedCar.id, post.id)} />
            ))}
          </div>
        )}
      </NarrowColumn>
    );
  }

  function ActivityDetailPage() {
    return (
      <NarrowColumn>
        <button type="button" onClick={() => { setCarTab("Activity"); navigate("car"); }} className="flex items-center gap-1.5 text-sm font-medium text-[#888888] hover:text-[#BBBBBB]">
          <Icon name="back" className="h-4 w-4" /> Activity
        </button>
        <header className="mt-6 flex items-center gap-3">
          <Avatar size="h-10 w-10" initials="NB" />
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-[#EEEEEE]">{selectedPost.title}</h1>
        </header>
        <p className="mt-4 text-sm leading-7 text-[#BBBBBB]">{selectedPost.intro}</p>
        <div className="mt-6 grid grid-cols-[1fr_0.7fr] gap-3">
          <Media src={selectedPost.photos[0]} alt={selectedPost.title} className="h-56 rounded-2xl border border-white/10" />
          <div className="grid gap-3">
            {selectedPost.photos.slice(1, 3).map((image, index) => (
              <Media key={image} src={image} alt={`${selectedPost.title} ${index + 1}`} className="h-[106px] rounded-2xl border border-white/10" />
            ))}
          </div>
        </div>
        <div className="mt-8 grid gap-8">
          {selectedPost.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-sm font-semibold text-[#EEEEEE]">{section.heading}</h2>
              <p className="mt-2 text-sm leading-7 text-[#BBBBBB]">{section.body}</p>
            </section>
          ))}
        </div>
        {selectedPost.video ? (
          <div className="mt-8">
            <div className="grid h-52 place-items-center rounded-2xl bg-[linear-gradient(135deg,#0C0C0C,#2A2A2A)]">
              <span className="grid h-14 w-20 place-items-center rounded-xl bg-[#FF0000] text-white"><Icon name="play" className="h-6 w-6" /></span>
            </div>
            <p className="mt-2 text-xs text-[#888888]">{selectedPost.video.title}</p>
          </div>
        ) : null}
        <div className="mt-10 border-t border-white/10 pt-6">
          <p className="text-sm text-[#888888]">Send {currentProfile.name} a reply about this page</p>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex flex-1 items-center justify-between rounded-full bg-[#272B30] px-4 py-3 text-sm text-[#888888]">
              Reply directly... <span className="text-[#666666]">enter</span>
            </div>
            {reactions.map((reaction) => (
              <button key={reaction} type="button" className="grid h-10 w-10 place-items-center rounded-full bg-[#272B30] text-xs text-[#BBBBBB] transition hover:bg-[#31363c]">
                {reaction}
              </button>
            ))}
          </div>
        </div>
      </NarrowColumn>
    );
  }

  function ExplorePage() {
    const feed = [
      ...allActivity.map(({ car, post }, index) => ({
        id: post.id,
        title: post.title,
        author: car.ownerUsername,
        body: post.summary,
        image: post.photos[0],
        variant: (index % 3 === 0 ? "image-top" : index % 3 === 1 ? "tall-image" : "text-first") as "image-top" | "tall-image" | "text-first",
        onOpen: () => openActivity(car.id, post.id),
      })),
      ...listings.slice(0, 4).map((listing, index) => ({
        id: listing.id,
        title: listing.title,
        author: listing.sellerUsername,
        body: `${money.format(listing.price)} - ${listing.condition} - ${listing.category}`,
        image: listing.image,
        variant: (index % 2 === 0 ? "image-top" : "text-first") as "image-top" | "text-first",
        onOpen: () => openListing(listing.id),
      })),
    ];

    return (
      <div className="mx-auto w-full max-w-[1200px] px-6 py-10 md:px-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-5xl font-bold tracking-[-0.04em] text-[#FCFCFD]">Explore</h1>
          <Button>Advanced filter</Button>
        </div>
        <div className="mt-7 h-px bg-[#353945]" />
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-2">
            {["Trending", "Newest"].map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setExploreSort(option)}
                className={cx(
                  "rounded-full px-3 py-1.5 text-sm font-bold",
                  option === exploreSort ? "bg-[#E6E8EC] text-[#23262F]" : "text-[#777E90] hover:text-[#BBBBBB]",
                )}
              >
                {option}
              </button>
            ))}
          </div>
          <button type="button" className="flex h-12 w-full items-center justify-between rounded-xl border border-[#353945] px-4 text-sm text-[#FCFCFD] sm:w-64">
            Filter <span className="grid h-8 w-8 place-items-center rounded-full border border-[#353945] text-[#777E90]">v</span>
          </button>
        </div>
        <div className="mt-8 columns-1 gap-5 sm:columns-2 xl:columns-3">
          {feed.map((card) => (
            <FeedCard key={card.id} {...card} />
          ))}
        </div>
      </div>
    );
  }

  function MarketplacePage() {
    const makes = ["All", ...Array.from(new Set(cars.map((car) => car.make)))];
    const models = ["All", ...Array.from(new Set(cars.map((car) => car.model)))];
    const platforms = ["All", ...Array.from(new Set(cars.map((car) => car.platform)))];
    return (
      <div className="mx-auto w-full max-w-[1280px] px-6 py-10 md:px-10">
        <SectionHeader
          eyebrow="Marketplace"
          title="Parts with source-car context"
          description="Browse listings tied back to the cars, builds, and fitment details they came from."
          action={<Button onClick={() => navigate("sell")}>Sell a Part</Button>}
        />
        <Surface className="mb-6 grid gap-3 p-4 md:grid-cols-4">
          <TextInput value={filters.keyword} onChange={(keyword) => setFilters({ ...filters, keyword })} placeholder="Search parts" />
          <SelectInput label="Make" value={filters.make} onChange={(make) => setFilters({ ...filters, make })} options={makes} />
          <SelectInput label="Category" value={filters.category} onChange={(category) => setFilters({ ...filters, category })} options={categories} />
          <SelectInput label="Fulfillment" value={filters.fulfillment} onChange={(fulfillment) => setFilters({ ...filters, fulfillment })} options={["All", "Shipping", "Pickup"]} />
          <SelectInput label="Model" value={filters.model} onChange={(model) => setFilters({ ...filters, model })} options={models} />
          <SelectInput label="Platform" value={filters.platform} onChange={(platform) => setFilters({ ...filters, platform })} options={platforms} />
          <SelectInput label="Condition" value={filters.condition} onChange={(condition) => setFilters({ ...filters, condition })} options={["All", "Used", "Excellent", "Refreshed"]} />
          <TextInput value={filters.maxPrice} onChange={(maxPrice) => setFilters({ ...filters, maxPrice })} placeholder="Max price" type="number" />
        </Surface>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredListings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              car={cars.find((car) => car.id === listing.linkedCarId)}
              saved={savedIds.includes(listing.id)}
              onOpen={() => openListing(listing.id)}
              onSave={() => toggleSaved(listing.id)}
            />
          ))}
        </div>
      </div>
    );
  }

  function ListingDetailPage() {
    const linkedCar = cars.find((car) => car.id === selectedListing.linkedCarId);
    return (
      <div className="mx-auto w-full max-w-[1180px] px-6 py-10 md:px-10">
        <button type="button" onClick={() => navigate("marketplace")} className="mb-6 flex items-center gap-1.5 text-sm text-[#888888] hover:text-[#BBBBBB]">
          <Icon name="back" className="h-4 w-4" /> Marketplace
        </button>
        <div className="grid gap-6 lg:grid-cols-[1fr_0.85fr]">
          <div className="grid gap-4">
            <Media src={selectedListing.image} alt={selectedListing.title} className="h-[520px] rounded-[32px] border border-white/10" />
            <HorizontalGallery images={selectedListing.images} alt={selectedListing.title} large />
          </div>
          <Surface className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#777E90]">{selectedListing.category}</p>
                <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-white">{selectedListing.title}</h1>
              </div>
              <span className="text-2xl font-semibold text-white">{money.format(selectedListing.price)}</span>
            </div>
            <p className="mt-5 text-sm leading-7 text-[#BBBBBB]">{selectedListing.notes}</p>
            <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
              {[
                ["Condition", selectedListing.condition],
                ["Location", selectedListing.location],
                ["Status", selectedListing.status],
                ["Seller", selectedListing.seller],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl bg-black/20 p-4">
                  <p className="text-[#888888]">{label}</p>
                  <p className="mt-1 text-[#EEEEEE]">{value}</p>
                </div>
              ))}
            </div>
            {linkedCar ? (
              <button type="button" onClick={() => openCar(linkedCar.id)} className="mt-6 flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-left">
                <Media src={linkedCar.image} alt={linkedCar.name} className="h-16 w-24 rounded-xl" />
                <span>
                  <span className="block text-sm font-semibold text-[#EEEEEE]">Source car: {linkedCar.name}</span>
                  <span className="text-xs text-[#888888]">{linkedCar.platform} - {linkedCar.colorLabel}</span>
                </span>
              </button>
            ) : null}
            <div className="mt-6 flex gap-3">
              <Button onClick={() => toggleSaved(selectedListing.id)}>{savedIds.includes(selectedListing.id) ? "Saved" : "Save"}</Button>
              <Button variant="secondary">Message Seller</Button>
            </div>
          </Surface>
        </div>
      </div>
    );
  }

  function SellPage() {
    return (
      <div className="mx-auto w-full max-w-[920px] px-6 py-10 md:px-10">
        <SectionHeader eyebrow="Sell" title="List a part from a known car" description="Every listing keeps source-car and compatibility context attached." />
        <Surface className="p-6">
          <form onSubmit={publishListing} className="grid gap-5">
            <Field label="Part title"><TextInput value={sellForm.title} onChange={(title) => setSellForm({ ...sellForm, title })} placeholder="034 High-Flow Downpipe" /></Field>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Category"><SelectInput label="Category" value={sellForm.category} onChange={(category) => setSellForm({ ...sellForm, category })} options={categories.filter((category) => category !== "All")} /></Field>
              <Field label="Condition"><SelectInput label="Condition" value={sellForm.condition} onChange={(condition) => setSellForm({ ...sellForm, condition })} options={["Used", "Excellent", "Refreshed", "Draft"]} /></Field>
              <Field label="Price"><TextInput value={sellForm.price} onChange={(price) => setSellForm({ ...sellForm, price })} type="number" placeholder="680" /></Field>
              <Field label="Source car"><SelectInput label="Source car" value={sellForm.sourceCarId} onChange={(sourceCarId) => setSellForm({ ...sellForm, sourceCarId })} options={cars.map((car) => car.id)} /></Field>
            </div>
            <Field label="Compatibility"><TextInput value={sellForm.compatibility} onChange={(compatibility) => setSellForm({ ...sellForm, compatibility })} /></Field>
            <Field label="Location"><TextInput value={sellForm.location} onChange={(location) => setSellForm({ ...sellForm, location })} /></Field>
            <Field label="Notes">
              <textarea
                aria-label="Listing notes"
                value={sellForm.notes}
                onChange={(event) => setSellForm({ ...sellForm, notes: event.target.value })}
                rows={4}
                className="resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-[#EEEEEE] outline-none focus:border-[#3B71FE]"
              />
            </Field>
            <div className="flex justify-end"><Button type="submit">Publish Listing</Button></div>
          </form>
        </Surface>
      </div>
    );
  }

  function GaragePage() {
    return (
      <div className="mx-auto w-full max-w-[1100px] px-6 py-10 md:px-10">
        <SectionHeader eyebrow="Garage" title="Manage your cars" description="Cars created here become profile cards, car profiles, and listing source cars." />
        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <Surface className="p-6">
            <form onSubmit={addGarageCar} className="grid gap-4">
              <Field label="Year"><TextInput value={garageDraft.year} onChange={(year) => setGarageDraft({ ...garageDraft, year })} placeholder="2024" /></Field>
              <Field label="Make"><TextInput value={garageDraft.make} onChange={(make) => setGarageDraft({ ...garageDraft, make })} placeholder="Audi" /></Field>
              <Field label="Model"><TextInput value={garageDraft.model} onChange={(model) => setGarageDraft({ ...garageDraft, model })} placeholder="S4" /></Field>
              <Field label="Trim"><TextInput value={garageDraft.trim} onChange={(trim) => setGarageDraft({ ...garageDraft, trim })} placeholder="ZF8" /></Field>
              <Field label="Platform"><TextInput value={garageDraft.platform} onChange={(platform) => setGarageDraft({ ...garageDraft, platform })} placeholder="B9.5" /></Field>
              <Button type="submit">Create Car Profile</Button>
            </form>
          </Surface>
          <div className="grid gap-4">
            {cars.map((car) => (
              <button key={car.id} type="button" onClick={() => openCar(car.id)} className="flex items-center gap-4 rounded-[24px] border border-white/10 bg-[#1E2124] p-4 text-left">
                <Media src={car.image} alt={car.name} className="h-24 w-32 shrink-0 rounded-2xl" />
                <span>
                  <span className="block text-lg font-semibold text-[#EEEEEE]">{car.name}</span>
                  <span className="text-sm text-[#888888]">{car.platform} - {car.buildStatus}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function SavedPage() {
    return (
      <div className="mx-auto w-full max-w-[1180px] px-6 py-10 md:px-10">
        <SectionHeader eyebrow="Saved" title="Saved cars and listings" description="Your short list of cars, build references, and parts to revisit." />
        <div className="grid gap-8">
          <section>
            <SectionLabel>Listings</SectionLabel>
            <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {savedListings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} car={cars.find((car) => car.id === listing.linkedCarId)} saved onOpen={() => openListing(listing.id)} onSave={() => toggleSaved(listing.id)} />
              ))}
            </div>
          </section>
          <section>
            <SectionLabel>Cars</SectionLabel>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {savedCars.map((car) => (
                <button key={car.id} type="button" onClick={() => openCar(car.id)} className="flex items-center gap-4 rounded-[24px] border border-white/10 bg-[#1E2124] p-4 text-left">
                  <Media src={car.image} alt={car.name} className="h-20 w-28 shrink-0 rounded-2xl" />
                  <span>
                    <span className="block text-sm font-semibold text-[#EEEEEE]">{car.name}</span>
                    <span className="text-xs text-[#888888]">{car.colorLabel}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  }

  function NotificationsPage() {
    const notifications = [
      ["Listing interest", "Maya asked about pickup for your 034 high-flow downpipe.", "Unread"],
      ["Car follow", "Ridgeline Performance followed Neil's Audi S4.", "Unread"],
      ["Saved listing", "3 people saved your Bilstein B16 listing this week.", "Read"],
      ["Build comment", "A new question was added to your S4 exhaust update.", "Read"],
    ];
    return (
      <div className="mx-auto w-full max-w-[920px] px-6 py-10 md:px-10">
        <SectionHeader eyebrow="Notifications" title="Activity across profiles and commerce" />
        <div className="grid gap-4">
          {notifications.map(([type, text, state]) => (
            <Surface key={text} className="p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <span className={cx("rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.18em]", state === "Unread" ? "bg-[#34C759] text-[#1A1D1F]" : "bg-white/7 text-[#BBBBBB]")}>{type}</span>
                  <p className="mt-4 text-lg font-semibold text-white">{text}</p>
                </div>
                <span className="text-sm text-[#777E90]">{state}</span>
              </div>
            </Surface>
          ))}
        </div>
      </div>
    );
  }

  function BuildDetailPage() {
    const buildCar = cars.find((car) => car.id === selectedBuild.carId);
    return (
      <NarrowColumn>
        <button type="button" onClick={() => buildCar ? openCar(buildCar.id) : navigate("profile")} className="mb-6 flex items-center gap-1.5 text-sm text-[#888888] hover:text-[#BBBBBB]">
          <Icon name="back" className="h-4 w-4" /> Build
        </button>
        <Media src={selectedBuild.image} alt={selectedBuild.title} className="h-72 rounded-[28px] border border-white/10" />
        <h1 className="mt-6 text-4xl font-semibold tracking-[-0.05em] text-white">{selectedBuild.title}</h1>
        <p className="mt-4 text-sm leading-7 text-[#BBBBBB]">{selectedBuild.summary}</p>
        <div className="mt-8 grid gap-4">
          {selectedBuild.updates.map((update) => (
            <Surface key={update} className="p-4 text-sm text-[#BBBBBB]">{update}</Surface>
          ))}
        </div>
      </NarrowColumn>
    );
  }

  function SettingsPage() {
    return (
      <div className="mx-auto w-full max-w-[940px] px-6 py-10 md:px-10">
        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#1E2124]">
          <div className="grid md:grid-cols-[220px_1fr]">
            <nav className="border-b border-white/10 p-3 md:border-b-0 md:border-r">
              <p className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#777E90]">Settings</p>
              <div className="flex gap-1 overflow-x-auto md:grid md:gap-0.5">
                {settingsSections.map((item) => (
                  <button key={item} type="button" onClick={() => setSettingsSection(item)} className={cx("whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition", item === settingsSection ? "bg-[#272B30] text-[#EEEEEE]" : "text-[#888888] hover:text-[#BBBBBB]")}>
                    {item}
                  </button>
                ))}
              </div>
              <div className="mt-6 grid gap-1 px-3 text-sm">
                <Link href="/design-system" className="text-[#888888] hover:text-[#EEEEEE]">Design system</Link>
                <Link href="/mockup" className="text-[#888888] hover:text-[#EEEEEE]">Reference mockup</Link>
                <Link href="/home-alt" className="text-[#888888] hover:text-[#EEEEEE]">Velocity concept</Link>
                <Link href="/home-brutalist" className="text-[#888888] hover:text-[#EEEEEE]">Paddock concept</Link>
                <Link href="/home-anthropic" className="text-[#888888] hover:text-[#EEEEEE]">Clay concept</Link>
              </div>
            </nav>
            <div className="p-6 md:p-8">
              <h2 className="text-lg font-semibold text-[#EEEEEE]">{settingsSection}</h2>
              <p className="mt-1 text-sm text-[#888888]">Edit the content that appears in this part of the product.</p>
              <div className="mt-6 grid gap-5">
                {settingsSection === "Vehicles" ? (
                  <>
                    <Field label="Car name"><TextInput value={selectedCar.name} onChange={() => undefined} /></Field>
                    <Field label="Tags"><textarea aria-label="Vehicle tags" defaultValue={selectedCar.tags.join(", ")} rows={3} className="resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-[#EEEEEE] outline-none focus:border-[#3B71FE]" /></Field>
                  </>
                ) : settingsSection === "Activity" ? (
                  <>
                    <Field label="Post title"><TextInput value={selectedPost.title} onChange={() => undefined} /></Field>
                    <Field label="Body"><textarea aria-label="Activity body" defaultValue={selectedPost.intro} rows={5} className="resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-[#EEEEEE] outline-none focus:border-[#3B71FE]" /></Field>
                  </>
                ) : (
                  <>
                    <Field label="Display name"><TextInput value={currentProfile.name} onChange={() => undefined} /></Field>
                    <Field label="Handle"><TextInput value={currentProfile.handle} onChange={() => undefined} /></Field>
                    <Field label="Bio"><textarea aria-label="Profile bio" defaultValue={currentProfile.bio} rows={4} className="resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-[#EEEEEE] outline-none focus:border-[#3B71FE]" /></Field>
                  </>
                )}
              </div>
              <div className="mt-7 flex justify-end gap-3">
                <Button variant="ghost">Cancel</Button>
                <Button>Save</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderPage() {
    if (activePage === "home") return <HomePage />;
    if (activePage === "explore") return <ExplorePage />;
    if (activePage === "marketplace") return <MarketplacePage />;
    if (activePage === "sell") return <SellPage />;
    if (activePage === "garage") return <GaragePage />;
    if (activePage === "profile") return <ProfilePage />;
    if (activePage === "saved") return <SavedPage />;
    if (activePage === "notifications") return <NotificationsPage />;
    if (activePage === "settings") return <SettingsPage />;
    if (activePage === "listing") return <ListingDetailPage />;
    if (activePage === "car") return <CarProfilePage />;
    if (activePage === "activity") return <ActivityDetailPage />;
    if (activePage === "build") return <BuildDetailPage />;
    return <HomePage />;
  }

  return (
    <div className="min-h-screen bg-[#1A1D1F] text-[#EEEEEE]">
      <div className="flex">
        <Sidebar active={activeSidebarPage} primaryItems={primaryNav} utilityItems={utilityNav} onNavigate={navigate} />
        <main className="min-h-screen flex-1">{renderPage()}</main>
      </div>
    </div>
  );
}

