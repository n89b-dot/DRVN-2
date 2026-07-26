/**
 * Domain types and seed data for the DRVN mockup.
 *
 * DRVN pairs car profiles and build documentation with a build-aware parts
 * marketplace, so listings carry source-car and fitment context. This module
 * centralizes the shared, frontend-only seed content so the main app shell and
 * the alternate home-page concepts all render the same product data.
 */

export type Car = {
  id: string;
  slug: string;
  name: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  platform: string;
  engine: string;
  drivetrain: string;
  transmission: string;
  color: string;
  owner: string;
  ownerUsername: string;
  location: string;
  buildStatus: string;
  image: string;
  gallery: string[];
  description: string;
  mods: string[];
  tags: string[];
  colorLabel: string;
  modGroups: ModGroup[];
  wheels: WheelSpec[];
  activity: ActivityPost[];
  socials: string[];
  followers: number;
  saves: number;
  likes: number;
};

export type BodySection = {
  heading: string;
  body: string;
};

export type ActivityPost = {
  id: string;
  date: string;
  title: string;
  summary: string;
  photos: string[];
  intro: string;
  sections: BodySection[];
  video?: { title: string };
};

export type ModGroup = {
  label: string;
  body: string;
};

export type WheelSpec = {
  label: string;
  value: string;
};

export type ContactLink = {
  label: string;
  value: string;
};

export type Crew = {
  initials: string;
  name: string;
};

export type Profile = {
  name: string;
  handle: string;
  tagline: string;
  bio: string;
  website: string;
  contact: ContactLink[];
  crews: Crew[];
};

export type Listing = {
  id: string;
  title: string;
  category: string;
  subcategory: string;
  brand: string;
  product: string;
  condition: string;
  price: number;
  location: string;
  shipping: boolean;
  pickup: boolean;
  status: "Active" | "Reserved" | "Sold" | "Draft";
  seller: string;
  sellerUsername: string;
  linkedCarId: string;
  linkedBuildId: string;
  compatibility: string[];
  notes: string;
  hardware: string;
  defects: string;
  image: string;
  images: string[];
  comments: string[];
};

export type Build = {
  id: string;
  title: string;
  carId: string;
  goal: string;
  type: string;
  summary: string;
  image: string;
  updates: string[];
  parts: string[];
};

export type Seller = {
  id: string;
  name: string;
  username: string;
  type: string;
  location: string;
  avatar: string;
  rating: string;
  listings: number;
  cars: number;
};

/** Hero background image used on the primary home page. */
export const heroImage =
  "https://performancespeedshop.com/cdn/shop/products/armorextend-ae-design-carbon-fiber-rear-diffuser-canards-ver2-for-audi-s4-b95-2020-on-578353.jpg?v=1743100078&width=533";

/** Marketplace part categories. "All" acts as the no-filter sentinel. */
export const categories = [
  "All",
  "Exhaust",
  "Wheels",
  "Suspension",
  "Brakes",
  "Lighting",
  "Interior",
];

export const initialCars: Car[] = [
  {
    id: "car-s4",
    slug: "neils-audi-s4",
    name: "Neil's Audi S4",
    year: "2020",
    make: "Audi",
    model: "S4",
    trim: "Premium Plus",
    platform: "B9.5",
    engine: "EA839 3.0T",
    drivetrain: "quattro AWD",
    transmission: "ZF8",
    color: "Quantum Gray",
    owner: "Neil Barrow",
    ownerUsername: "neilbarrow",
    location: "New York, NY",
    buildStatus: "Stage 2+ street build",
    image:
      "https://performancespeedshop.com/cdn/shop/products/armorextend-ae-design-carbon-fiber-rear-diffuser-canards-ver2-for-audi-s4-b95-2020-on-578353.jpg?v=1743100078&width=533",
    gallery: [
      "https://images.unsplash.com/photo-1556391362-d3d11d98e510?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1540066019607-e5f69323a8dc?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1556391362-d3d11d98e510?auto=format&fit=crop&w=900&q=80",
    ],
    description:
      "A modified daily-driven S4 focused on OEM-plus power, quattro traction, cooling, and subtle visual upgrades.",
    mods: ["034 Stage 2+", "034 drivetrain insert", "Bilstein B16", "Rotiform RSE", "AWE Touring Exhaust"],
    tags: ["2020 Quantum Gray", "New York", "B9.5", "Stage 2", "OEM+", "Daily"],
    colorLabel: "Quantum Gray",
    modGroups: [
      {
        label: "Exterior",
        body: "Black Optic trim, subtle carbon aero, and a clean wheel setup keep the car sharp without losing the OEM character.",
      },
      {
        label: "Interior",
        body: "OEM-plus cockpit with upgraded mats, a refreshed steering wheel, and small quality-of-life details for daily use.",
      },
      {
        label: "Performance",
        body: "034 Stage 2+ calibration, AWE exhaust, intake hardware, and supporting maintenance documented through the build log.",
      },
      {
        label: "Suspension",
        body: "Bilstein B16 dampers, 034 inserts, and Rotiform wheels set up for a balanced street fitment.",
      },
    ],
    wheels: [
      { label: "Front", value: "19x8.5 ET45 - 235/35" },
      { label: "Rear", value: "19x8.5 ET45 - 235/35" },
    ],
    activity: [
      {
        id: "activity-s4-awe",
        date: "Sep 2024",
        title: "AWE Touring Exhaust Install",
        summary: "Installing the AWE Touring Exhaust and a few other parts over the weekend.",
        photos: [
          "https://images.unsplash.com/photo-1556391362-d3d11d98e510?auto=format&fit=crop&w=900&q=80",
          "https://images.unsplash.com/photo-1540066019607-e5f69323a8dc?auto=format&fit=crop&w=900&q=80",
          "https://images.unsplash.com/photo-1625047509248-ec889cbff17f?auto=format&fit=crop&w=1200&q=85",
        ],
        intro:
          "Recently picked up this Quantum Gray S4 as a daily. Just started modifying it and wanted to document how the build progresses.",
        sections: [
          {
            heading: "The install",
            body: "The AWE system fit cleanly, the tips line up with the diffuser, and the tone is right for a daily: quiet at cruise, sharper under load.",
          },
          {
            heading: "Modifications",
            body: "While the car was up, I refreshed the clamps, checked the drivetrain insert, and logged fitment notes for anyone cross-shopping this setup.",
          },
        ],
        video: { title: "AWE Touring - first start and drive" },
      },
      {
        id: "activity-s4-intake-cooling",
        date: "Sep 2024",
        title: "034 Intake and Heat Exchanger Install",
        summary: "Added 034 intake hardware and heat exchanger support for a cleaner Stage 2+ setup.",
        photos: [
          "https://images.unsplash.com/photo-1556391362-d3d11d98e510?auto=format&fit=crop&w=900&q=80",
          "https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=900&q=80",
        ],
        intro: "Quick afternoon job adding 034 intake and cooling hardware to support the Stage 2+ calibration.",
        sections: [
          {
            heading: "Why the swap",
            body: "The intake keeps the bay tidy, the heat exchanger helps keep intake temps stable, and both upgrades fit the OEM-plus direction.",
          },
        ],
      },
    ],
    socials: ["Instagram", "YouTube", "Build thread"],
    followers: 1280,
    saves: 342,
    likes: 4180,
  },
  {
    id: "car-supra",
    slug: "a90-supra-track",
    name: "A90 Supra Track Pack",
    year: "2021",
    make: "Toyota",
    model: "Supra",
    trim: "3.0 Premium",
    platform: "A90",
    engine: "B58",
    drivetrain: "RWD",
    transmission: "ZF8",
    color: "Turbulence Gray",
    owner: "Maya Chen",
    ownerUsername: "maya",
    location: "Los Angeles, CA",
    buildStatus: "Track day setup",
    image:
      "https://images.unsplash.com/photo-1619405399517-d7fce0f13302?auto=format&fit=crop&w=1400&q=85",
    gallery: [
      "https://images.unsplash.com/photo-1542362567-b07e54358753?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1525609004556-c46c7d6cf023?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=900&q=80",
    ],
    description:
      "Fast-response B58 setup with cooling, aero, and brake work aimed at reliable open lapping.",
    mods: ["CSF Cooling", "Verus Aero", "SPL Arms", "Titan 7 Wheels", "Project Mu Pads"],
    tags: ["2021 Turbulence Gray", "Los Angeles", "Track", "B58", "Aero", "Cooling"],
    colorLabel: "Turbulence Gray",
    modGroups: [
      {
        label: "Exterior",
        body: "Verus aero, tow hardware, and simple track-day details that stay functional first.",
      },
      {
        label: "Interior",
        body: "Driver-focused setup with logging mounts, harness prep, and lightweight cabin touches.",
      },
      {
        label: "Performance",
        body: "Cooling upgrades and track-ready brake compounds keep the B58 consistent across longer sessions.",
      },
      {
        label: "Suspension",
        body: "SPL arms and a square wheel package focus on predictable rotation and tire life.",
      },
    ],
    wheels: [
      { label: "Front", value: "19x10 ET40 - 275/35" },
      { label: "Rear", value: "19x10 ET40 - 275/35" },
    ],
    activity: [
      {
        id: "activity-supra-cooling",
        date: "Aug 2024",
        title: "Cooling and aero shakedown",
        summary: "First track day after the heat exchanger and splitter install.",
        photos: [
          "https://images.unsplash.com/photo-1542362567-b07e54358753?auto=format&fit=crop&w=900&q=80",
          "https://images.unsplash.com/photo-1525609004556-c46c7d6cf023?auto=format&fit=crop&w=900&q=80",
          "https://images.unsplash.com/photo-1592198084033-aade902d1aae?auto=format&fit=crop&w=1200&q=85",
        ],
        intro: "First event back with the cooling and aero changes. The car felt calmer and stayed consistent deeper into each session.",
        sections: [
          {
            heading: "Cooling notes",
            body: "Oil and intake temperatures recovered faster between pulls, and the car did not pull timing in the second half of the session.",
          },
        ],
      },
    ],
    socials: ["Instagram", "TikTok", "Shop page"],
    followers: 942,
    saves: 221,
    likes: 3060,
  },
  {
    id: "car-m3",
    slug: "e92-m3-clubsport",
    name: "E92 M3 Clubsport",
    year: "2011",
    make: "BMW",
    model: "M3",
    trim: "Competition",
    platform: "E92",
    engine: "S65 V8",
    drivetrain: "RWD",
    transmission: "6MT",
    color: "Alpine White",
    owner: "Ridgeline Performance",
    ownerUsername: "ridgeline",
    location: "Denver, CO",
    buildStatus: "Shop demo build",
    image:
      "https://images.unsplash.com/photo-1555353540-64580b51c258?auto=format&fit=crop&w=1400&q=85",
    gallery: [
      "https://images.unsplash.com/photo-1511919884226-fd3cad34687c?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1502161254066-6c74afbf07aa?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&w=900&q=80",
    ],
    description:
      "A naturally aspirated customer reference car with brake, suspension, and reliability upgrades.",
    mods: ["Rod bearing service", "Ohlins R&T", "AP Racing BBK", "Recaro Pole Position", "Eventuri Intake"],
    tags: ["2011 Alpine White", "Denver", "S65", "Clubsport", "Manual", "Track"],
    colorLabel: "Alpine White",
    modGroups: [
      {
        label: "Exterior",
        body: "Subtle clubsport cues, clear bra, and track-ready tow hardware without losing the factory silhouette.",
      },
      {
        label: "Interior",
        body: "Recaro seats, lightweight trim, and harness prep for track days.",
      },
      {
        label: "Performance",
        body: "Rod bearing service, Eventuri intake, and AP Racing brakes prioritize reliability and consistency.",
      },
      {
        label: "Suspension",
        body: "Ohlins Road & Track suspension with a streetable alignment and track-day adjustability.",
      },
    ],
    wheels: [
      { label: "Front", value: "18x10 ET25 - 275/35" },
      { label: "Rear", value: "18x10 ET25 - 275/35" },
    ],
    activity: [
      {
        id: "activity-m3-brakes",
        date: "Jul 2024",
        title: "AP Racing brake refresh",
        summary: "Refreshed the shop demo brake kit before the next open-lapping weekend.",
        photos: [
          "https://images.unsplash.com/photo-1511919884226-fd3cad34687c?auto=format&fit=crop&w=900&q=80",
          "https://images.unsplash.com/photo-1607860108855-64acf2078ed9?auto=format&fit=crop&w=1200&q=85",
          "https://images.unsplash.com/photo-1599256872237-5dcc0fbe9668?auto=format&fit=crop&w=900&q=80",
        ],
        intro: "The brake kit came off for inspection, fresh seals, and new pads before the next event.",
        sections: [
          {
            heading: "Refresh notes",
            body: "Calipers were cleaned, seals inspected, pads bedded, and hardware checked before reinstalling the kit on the E92.",
          },
        ],
      },
    ],
    socials: ["Website", "Instagram", "YouTube"],
    followers: 2810,
    saves: 670,
    likes: 8920,
  },
];

export const initialBuilds: Build[] = [
  {
    id: "build-golf-street",
    title: "OEM-plus B9.5 S4 Street Build",
    carId: "car-s4",
    goal: "Fast daily with real fitment data",
    type: "Street performance",
    summary:
      "A measured Stage 2 setup that keeps daily manners while documenting what parts actually work together.",
    image:
      "https://images.unsplash.com/photo-1553440569-bcc63803a83d?auto=format&fit=crop&w=1200&q=85",
    updates: ["Downpipe removed and listed", "New wheel fitment logged", "Suspension height notes added"],
    parts: ["034 high-flow downpipe", "Bilstein B16", "Rotiform RSE", "AWE Touring Exhaust"],
  },
  {
    id: "build-supra-track",
    title: "A90 Cooling and Aero Log",
    carId: "car-supra",
    goal: "Consistent 20-minute sessions",
    type: "Track",
    summary:
      "A build diary focused on thermal control, brake consistency, and parts that survive repeated lapping.",
    image:
      "https://images.unsplash.com/photo-1592198084033-aade902d1aae?auto=format&fit=crop&w=1200&q=85",
    updates: ["Brake compound review posted", "Splitter install notes added", "Oil cooler data added"],
    parts: ["CSF heat exchanger", "Verus splitter", "Project Mu HC+", "SPL rear toe arms"],
  },
];

export const initialListings: Listing[] = [
  {
    id: "listing-apr-downpipe",
    title: "034 High-Flow Downpipe for B9/B9.5 Audi S4/S5",
    category: "Exhaust",
    subcategory: "Downpipes",
    brand: "034Motorsport",
    product: "High-Flow Downpipe",
    condition: "Used",
    price: 680,
    location: "Brooklyn, NY",
    shipping: true,
    pickup: true,
    status: "Active",
    seller: "Neil Barrow",
    sellerUsername: "neilbarrow",
    linkedCarId: "car-s4",
    linkedBuildId: "build-golf-street",
    compatibility: ["2018-2024 Audi S4", "2018-2024 Audi S5", "B9.5 quattro", "EA839 3.0T"],
    notes: "Removed during emissions-friendly refresh. No check engine light on previous Stage 2 tune.",
    hardware: "Includes clamp, reducer, and used gasket.",
    defects: "Normal heat discoloration and light scrape on lower bend.",
    image:
      "https://images.unsplash.com/photo-1625047509248-ec889cbff17f?auto=format&fit=crop&w=1200&q=85",
    images: [
      "https://images.unsplash.com/photo-1625047509248-ec889cbff17f?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1632823469850-1b7b1e8b7e1e?auto=format&fit=crop&w=900&q=80",
    ],
    comments: ["Will this clear the OEM heat shield?", "Interested if pickup is available this weekend."],
  },
  {
    id: "listing-titan7",
    title: "Titan 7 T-S5 Forged Wheels 19x10 +40",
    category: "Wheels",
    subcategory: "Forged wheels",
    brand: "Titan 7",
    product: "T-S5",
    condition: "Excellent",
    price: 2150,
    location: "Los Angeles, CA",
    shipping: false,
    pickup: true,
    status: "Reserved",
    seller: "Maya Chen",
    sellerUsername: "maya",
    linkedCarId: "car-supra",
    linkedBuildId: "build-supra-track",
    compatibility: ["A90 Supra", "G29 Z4", "5x112", "19x10 +40"],
    notes: "Track wheel set used for three events. Switching to 18-inch tire package.",
    hardware: "Includes center caps and TPMS.",
    defects: "One small nick pictured on passenger rear.",
    image:
      "https://images.unsplash.com/photo-1600661653561-629509216228?auto=format&fit=crop&w=1200&q=85",
    images: [
      "https://images.unsplash.com/photo-1600661653561-629509216228?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1614162692292-7ac56d7f7f1e?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?auto=format&fit=crop&w=900&q=80",
    ],
    comments: ["Can you confirm brake clearance with OEM calipers?"],
  },
  {
    id: "listing-ap-racing",
    title: "AP Racing Radi-CAL Front Brake Kit for E9X M3",
    category: "Brakes",
    subcategory: "Big brake kits",
    brand: "AP Racing",
    product: "Radi-CAL",
    condition: "Refreshed",
    price: 3650,
    location: "Denver, CO",
    shipping: true,
    pickup: true,
    status: "Active",
    seller: "Ridgeline Performance",
    sellerUsername: "ridgeline",
    linkedCarId: "car-m3",
    linkedBuildId: "build-golf-street",
    compatibility: ["2008-2013 BMW M3", "E90/E92/E93", "18-inch wheel clearance required"],
    notes: "Shop demo kit with new seals and fresh pads. Ideal for dual-duty track cars.",
    hardware: "Includes calipers, brackets, lines, used rotors, and new pads.",
    defects: "Rotor hats show cosmetic wear.",
    image:
      "https://images.unsplash.com/photo-1607860108855-64acf2078ed9?auto=format&fit=crop&w=1200&q=85",
    images: [
      "https://images.unsplash.com/photo-1607860108855-64acf2078ed9?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1580273916550-e323be2ae537?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1599256872237-5dcc0fbe9668?auto=format&fit=crop&w=900&q=80",
    ],
    comments: ["Do you have measurements for Apex EC-7 clearance?"],
  },
  {
    id: "listing-bilstein",
    title: "Bilstein B16 Coilovers for B9/B9.5 Audi S4",
    category: "Suspension",
    subcategory: "Coilovers",
    brand: "Bilstein",
    product: "B16 DampTronic",
    condition: "Used",
    price: 1280,
    location: "Queens, NY",
    shipping: true,
    pickup: true,
    status: "Active",
    seller: "Neil Barrow",
    sellerUsername: "neilbarrow",
    linkedCarId: "car-s4",
    linkedBuildId: "build-golf-street",
    compatibility: ["B9 Audi S4", "B9.5 Audi S4", "B9.5 quattro"],
    notes: "Comfortable daily setup. Removed to test a static spring and damper package.",
    hardware: "Includes adjustment tools and original box.",
    defects: "Cosmetic wear on collars. Threads move freely.",
    image:
      "https://images.unsplash.com/photo-1613214149922-f1809c99b414?auto=format&fit=crop&w=1200&q=85",
    images: [
      "https://images.unsplash.com/photo-1613214149922-f1809c99b414?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1599256872237-5dcc0fbe9668?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=900&q=80",
    ],
    comments: [],
  },
];

export const currentProfile: Profile = {
  name: "Neil Barrow",
  handle: "@mrawr2",
  tagline: "Product Designer in Fort Lauderdale, Florida",
  bio: "Designer and weekend builder. I document my cars here, from the daily S4 to the long-term build notes that make a setup useful to someone else.",
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
};

export const sellers: Seller[] = [
  {
    id: "seller-neil",
    name: "Neil Barrow",
    username: "neilbarrow",
    type: "Owner / seller",
    location: "New York, NY",
    avatar: "NB",
    rating: "12 saves this month",
    listings: 6,
    cars: 1,
  },
  {
    id: "seller-maya",
    name: "Maya Chen",
    username: "maya",
    type: "Builder",
    location: "Los Angeles, CA",
    avatar: "MC",
    rating: "Fast responder",
    listings: 3,
    cars: 1,
  },
  {
    id: "seller-ridgeline",
    name: "Ridgeline Performance",
    username: "ridgeline",
    type: "Shop",
    location: "Denver, CO",
    avatar: "RP",
    rating: "Verified shop",
    listings: 18,
    cars: 4,
  },
];
