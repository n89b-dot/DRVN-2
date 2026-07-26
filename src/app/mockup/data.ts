/**
 * Sample content for the DRVN clickable mockup.
 *
 * The prototype is image-free: every photo is represented by a `Tone` that maps
 * to a CSS gradient in the UI layer. This keeps the mockup dependency-free while
 * still reading as a real, photo-led profile.
 */

export type Tone = "blue" | "dusk" | "steel" | "dark" | "red" | "light";

export interface BodySection {
  heading: string;
  body: string;
}

export interface ActivityPost {
  id: string;
  /** Short rail label, e.g. "Sep 2024". */
  date: string;
  title: string;
  /** One-line description shown on the activity feed row. */
  summary: string;
  /** Thumbnails shown on the feed row. */
  photos: Tone[];
  /** First paragraph on the detail page. */
  intro: string;
  /** Long-form body, rendered as repeating heading + copy sections. */
  sections: BodySection[];
  /** Optional embedded video block. */
  video?: { title: string };
}

export interface ModGroup {
  label: string;
  body: string;
}

export interface WheelSpec {
  label: string;
  value: string;
}

export interface Car {
  id: string;
  year: string;
  name: string;
  colorLabel: string;
  /** Owner-entered, free-form metadata chips. */
  tags: string[];
  description: string;
  gallery: Tone[];
  mods: ModGroup[];
  wheels: WheelSpec[];
  activity: ActivityPost[];
}

export interface ContactLink {
  label: string;
  value: string;
}

export interface Crew {
  initials: string;
  name: string;
}

export interface Person {
  name: string;
  handle: string;
  tagline: string;
  bio: string;
  website: string;
  contact: ContactLink[];
  crews: Crew[];
  cars: Car[];
}

const golfActivity: ActivityPost[] = [
  {
    id: "awe-exhaust",
    date: "Sep 2024",
    title: "AWE Touring Exhaust Install",
    summary: "Installing the AWE Touring Exhaust and a few other parts over the weekend.",
    photos: ["blue", "dusk", "light"],
    intro:
      "Recently picked up this 2024 Quantum Gray S4 as a daily. Just started modifying it. Looking forward to sharing how the build progresses. Stay tuned!",
    sections: [
      {
        heading: "The install",
        body: "Spent the weekend dropping the stock exhaust and fitting the AWE Touring system. Fitment was perfect out of the box and the tips line up cleanly with the diffuser. Sound is exactly what I wanted on a daily — quiet on cold start, aggressive under load.",
      },
      {
        heading: "Modifications",
        body: "Alongside the exhaust I added a few smaller pieces: a turbo inlet, a new intake, and refreshed the diverter valve. Nothing wild yet — building a clean, reliable base before going further with the tune.",
      },
    ],
    video: { title: "AWE Touring — first start & drive" },
  },
  {
    id: "034-intake-cooling",
    date: "Sep 2024",
    title: "034 Intake and Heat Exchanger Install",
    summary: "Swapped in the 034 intake and heat exchanger to support the Stage 2+ setup.",
    photos: ["blue", "dark", "light"],
    intro:
      "Quick afternoon job adding 034 intake and cooling hardware. Big difference in how the bay reads, and the setup supports the Stage 2+ tune.",
    sections: [
      {
        heading: "Why the swap",
        body: "The intake keeps the bay tidy, the heat exchanger helps intake temps recover faster, and both upgrades keep the S4 feeling OEM-plus instead of overbuilt.",
      },
    ],
  },
];

const mr2Activity: ActivityPost[] = [
  {
    id: "mr2-spectra",
    date: "Aug 2024",
    title: "Spectra Quantum Gray Respray Complete",
    summary: "Finished the full respray back to factory Spectra Quantum Gray.",
    photos: ["steel", "blue", "dusk"],
    intro:
      "After a long winter the MR2 is finally back in its original Spectra Quantum Gray. Paint correction is next, but it already looks night-and-day.",
    sections: [
      {
        heading: "Bodywork",
        body: "Stripped the tired clear coat, sorted a few small dents, and laid down fresh Spectra Quantum Gray. The color shifts beautifully in the sun — exactly why this car deserved a proper respray.",
      },
    ],
  },
];

export const person: Person = {
  name: "Neil Barrow",
  handle: "@mrawr2",
  tagline: "Product Designer in Fort Lauderdale, Florida",
  bio: "Designer and weekend builder. I document my cars here — the daily S4 and a long-term MR2 project. Mostly clean, reliable mods with the occasional deep dive.",
  website: "andychung.me",
  contact: [
    { label: "Website", value: "andychung.me" },
    { label: "Instagram", value: "@andychung" },
    { label: "TikTok", value: "@andychung" },
    { label: "Email", value: "hi@andychung.me" },
  ],
  crews: [
    { initials: "ME", name: "Miami Euros" },
    { initials: "LB", name: "Lauderdale Bagged" },
  ],
  cars: [
    {
      id: "audi-s4",
      year: "2024",
      name: "Audi S4",
      colorLabel: "Quantum Gray",
      tags: ["2024 Quantum Gray", "Fort Lauderdale", "Black Optic", "Bagged", "FBO", "Fully Built"],
      description:
        "Recently picked up this 2024 Quantum Gray S4 as a daily. Just started modifying it. Looking forward to sharing how the build progresses. Stay tuned!",
      gallery: ["blue", "dusk", "steel", "dark", "light", "blue"],
      mods: [
        { label: "Exterior", body: "034 intake and heat exchanger, gloss black mirror caps, debadged rear, Black Optic front lip." },
        { label: "Interior", body: "Alcantara steering wheel, custom floor mats, ambient lighting upgrade." },
        { label: "Performance", body: "AWE Touring exhaust, turbo inlet, intake, Stage 1 tune." },
        { label: "Suspension", body: "Air Lift Performance 3P management, bagged on all four corners." },
      ],
      wheels: [
        { label: "Front", value: "19×8.5 ET45 — 235/35" },
        { label: "Rear", value: "19×8.5 ET45 — 235/35" },
      ],
      activity: golfActivity,
    },
    {
      id: "mr2",
      year: "2000",
      name: "Toyota MR2",
      colorLabel: "Spectra Quantum Gray",
      tags: ["2000 Spectra Quantum Gray", "Project", "NA", "Garage Kept"],
      description:
        "Long-term MR2 Spyder project. Keeping it close to stock but fresh — the goal is a clean, reliable weekend car.",
      gallery: ["steel", "blue", "dusk", "dark", "light"],
      mods: [
        { label: "Exterior", body: "Full Spectra Quantum Gray respray, hardtop, OEM-style refresh throughout." },
        { label: "Interior", body: "Reupholstered seats, new shift boot, refreshed cluster." },
        { label: "Performance", body: "Stainless catback, lightweight pulley, fresh fluids and belts." },
        { label: "Suspension", body: "Koni dampers with Eibach springs, fresh bushings." },
      ],
      wheels: [
        { label: "Front", value: "15×7 ET30 — 195/50" },
        { label: "Rear", value: "15×7 ET30 — 205/50" },
      ],
      activity: mr2Activity,
    },
  ],
};

export interface ExploreCard {
  id: string;
  variant: "image-top" | "tall-image" | "text-first";
  author: string;
  title: string;
  body: string;
  tone: Tone;
}

export const exploreCards: ExploreCard[] = [
  {
    id: "e1",
    variant: "image-top",
    author: "mrawr2",
    title: "AWE Touring Exhaust Install",
    body: "Installing the AWE Touring Exhaust and a few other parts over the weekend.",
    tone: "blue",
  },
  {
    id: "e2",
    variant: "tall-image",
    author: "kanjo_eg",
    title: "Coilover refresh on the EG",
    body: "New dampers, fresh top hats, and a corner-balance before the season.",
    tone: "dusk",
  },
  {
    id: "e3",
    variant: "text-first",
    author: "spectra_mr2",
    title: "Why I went back to factory paint",
    body: "A long write-up on the respray, the color, and what I'd do differently.",
    tone: "steel",
  },
  {
    id: "e4",
    variant: "image-top",
    author: "bagged.golf",
    title: "Air management tuck and trunk setup",
    body: "Finished the trunk build with a flush tank and hidden compressors.",
    tone: "dark",
  },
  {
    id: "e5",
    variant: "tall-image",
    author: "b9.s4",
    title: "034 intake and heat exchanger install",
    body: "Cleaner bay, stronger cooling, and better support for the Stage 2+ tune.",
    tone: "red",
  },
  {
    id: "e6",
    variant: "image-top",
    author: "daily.r",
    title: "Stage 1 first impressions",
    body: "Quick notes after a week on the Stage 1 tune. Daily-friendly.",
    tone: "blue",
  },
];
