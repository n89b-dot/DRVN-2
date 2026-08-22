/**
 * Seeds three supercar community accounts (dario / imani / felix @drvn.test)
 * the same way `.seed-community.mjs` does — anon-key sign-in, RLS-clean,
 * idempotent by car slug / post title / listing title — and then, with the
 * service key, attaches generated photos to the existing image-less rows
 * (Dana Rossi's Lancia, Matthias Kessler's Evo, and their listings) whose
 * owners we can't sign in as.
 *
 * Usage: node .seed-supercars.mjs <manifest.json>
 * Manifest maps image keys → local jpg paths.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SERVICE_KEY = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error("pass the image manifest path");
const images = JSON.parse(readFileSync(manifestPath, "utf8"));

const PASSWORD = "drvn-community-2026";
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

const PEOPLE = [
  {
    email: "dario@drvn.test",
    username: "dario_speciale",
    display_name: "Dario Conti",
    headline: "458 Speciale owner. Naturally aspirated or nothing.",
    bio: "Modena-born, London-based. One Speciale, far too many spare parts. Everything I pull off the car goes up here rather than gathering dust.",
    location: "London, UK",
    avatar: "dario-avatar",
    cars: [
      {
        name: "Rosso",
        slug: "rosso-458-speciale",
        make: "Ferrari",
        model: "458 Speciale",
        year: 2015,
        color: "Rosso Corsa",
        about:
          "Bought with 9k miles and driven properly since. Capristo exhaust, Novitec springs, otherwise left alone — the 4.5 V8 doesn't need help.",
        tags: ["ferrari", "458", "speciale", "v8"],
        cover: "dario-car",
        gallery: ["dario-car"],
        posts: [
          {
            title: "Brakes off for the ceramic inspection",
            intro:
              "Annual check on the carbon ceramics. Pads measured, discs weighed — all still well within Ferrari's limits. Back together by the weekend.",
            image: "dario-post-lift",
            ago: 3,
          },
          {
            title: "Titanium tips finally on",
            intro: "Swapped the valved rear boxes for the full titanium system. Cold start is antisocial in the best way.",
            image: "dario-post-tips",
            ago: 12,
          },
        ],
        listings: [
          {
            title: "Ferrari 458 Speciale forged 20in wheels, OEM set of four",
            description:
              "Factory forged wheels off the Speciale, removed for an aftermarket set. Two small kerb marks on the front-left, photographed. Straight and true, no repairs.",
            category: "wheels-tires",
            subcategory: "wheels",
            condition: "used",
            grade: "a",
            price_cents: 680000,
            shipping_cents: 24000,
            image: "dario-listing-wheels",
            location: "London, UK",
          },
          {
            title: "Capristo valved exhaust, 458 Italia / Speciale",
            description:
              "Full Capristo system with valve controller, 8k miles. Replaced with a titanium setup. No cracks at the welds, tips show light heat colour only.",
            category: "performance",
            subcategory: "exhaust",
            condition: "used",
            grade: "a",
            price_cents: 420000,
            shipping_cents: 18000,
            image: "dario-listing-exhaust",
            location: "London, UK",
          },
        ],
      },
    ],
  },
  {
    email: "imani@drvn.test",
    username: "imani_v10",
    display_name: "Imani Okafor",
    headline: "Performante on track days, Performante on school runs.",
    bio: "Miami-based, track-curious. The Huracán is a daily that happens to do lapping days. Parts come off as they get upgraded.",
    location: "Miami, FL",
    avatar: "imani-avatar",
    cars: [
      {
        name: "Verde",
        slug: "verde-performante",
        make: "Lamborghini",
        model: "Huracán Performante",
        year: 2018,
        color: "Verde Mantis",
        about:
          "Performante with the forged composite aero. Akrapovič slip-on, track pads, and a running argument with the ALA system about what counts as downforce.",
        tags: ["lamborghini", "huracan", "performante", "v10"],
        cover: "imani-car",
        gallery: ["imani-car"],
        posts: [
          {
            title: "V10 service — plugs and coils",
            intro:
              "Engine cover off for the 4-year service. Plugs looked healthy, did the coils while I was in there. Also found where the rattle was coming from.",
            image: "imani-post-engine",
            ago: 5,
          },
          {
            title: "First lapping day of the season",
            intro: "Homestead in the heat. Tyres went off after four laps, lesson learned about pressures.",
            image: "imani-post-track",
            ago: 18,
          },
        ],
        listings: [
          {
            title: "Huracán Performante forged carbon rear wing, OEM",
            description:
              "Factory forged composite wing, removed for a taller aftermarket unit. No chips or cracks, ALA ducting intact. Comes with the mounting hardware.",
            category: "exterior-body",
            subcategory: "spoilers-wings",
            condition: "used",
            grade: "a",
            price_cents: 890000,
            shipping_cents: 30000,
            image: "imani-listing-wing",
            location: "Miami, FL",
          },
          {
            title: "Akrapovič slip-on titanium, Huracán LP610 / Performante",
            description:
              "Titanium slip-on with carbon tips, one season. Light blue heat tint on the welds as expected. Sold because the next exhaust is a full system.",
            category: "performance",
            subcategory: "exhaust",
            condition: "used",
            grade: "b",
            price_cents: 310000,
            shipping_cents: 15000,
            image: "imani-listing-exhaust",
            location: "Miami, FL",
          },
        ],
      },
    ],
  },
  {
    email: "felix@drvn.test",
    username: "felix_gt3",
    display_name: "Felix Brandt",
    headline: "992 GT3, Nordschleife regular. Everything documented.",
    bio: "Engineer by day, Ring taxi passenger by reputation. The GT3 gets used hard and maintained harder; take-off parts are listed as they come off.",
    location: "Cologne, DE",
    avatar: "felix-avatar",
    cars: [
      {
        name: "Signal",
        slug: "signal-992-gt3",
        make: "Porsche",
        model: "911 GT3",
        year: 2022,
        color: "Signal Yellow",
        about:
          "992 GT3 manual, Clubsport package. Full bucket seats, Cup 2 R on a second set of wheels, stock everything else because it's already right.",
        tags: ["porsche", "992", "gt3", "nurburgring"],
        cover: "felix-car",
        gallery: ["felix-car"],
        posts: [
          {
            title: "Seats out for the harness bar",
            intro:
              "Both buckets out to fit the Clubsport harness bar. Took the chance to clean carpets nobody has seen since Zuffenhausen.",
            image: "felix-post-interior",
            ago: 4,
          },
          {
            title: "Wet Nordschleife, still worth it",
            intro: "Rain all morning, dried by the afternoon. Cup 2s in the wet are a character-building experience.",
            image: "felix-post-ring",
            ago: 21,
          },
        ],
        listings: [
          {
            title: "Porsche 992 GT3 full bucket seats, carbon, pair",
            description:
              "Factory carbon full buckets, removed for 18-way comfort seats for longer trips. Bolsters are unmarked, no sun fade. Side airbags and rails included.",
            category: "interior-lighting",
            subcategory: "seats",
            condition: "used",
            grade: "a",
            price_cents: 1150000,
            shipping_cents: 35000,
            image: "felix-listing-seats",
            location: "Cologne, DE",
          },
          {
            title: "992 GT3 centre-lock wheels with Michelin Cup 2, set of four",
            description:
              "Factory centre-locks with Cup 2s at about 5mm tread. Ring miles only, no kerb strikes. Centre-lock nuts included, wrench not.",
            category: "wheels-tires",
            subcategory: "wheels",
            condition: "used",
            grade: "b",
            price_cents: 520000,
            shipping_cents: 28000,
            image: "felix-listing-wheels",
            location: "Cologne, DE",
          },
        ],
      },
    ],
  },
];

/** Existing rows we can only reach with the service key. */
const FIXUPS = {
  cars: [
    { slug: "lancia-delta-hf-integrale", image: "fix-lancia-cover" },
    { slug: "evo-ix-tarmac", image: "fix-evo-cover" },
  ],
  listings: [
    { title: "Öhlins Road & Track coilovers, 12k miles", image: "fix-ohlins" },
    { title: "KW Variant 2 coilovers — Delta HF fitment", image: "fix-kw" },
    { title: "Sabelt bucket seat — driver side", image: "fix-sabelt" },
    { title: "AP Racing CP9660 front kit — 362 mm", image: "fix-apracing" },
  ],
};

function client(key = ANON_KEY) {
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
}

async function uploadImage(sb, bucket, path, key) {
  const file = images[key];
  if (!file) throw new Error(`manifest missing image key: ${key}`);
  const buf = readFileSync(file);
  const { error } = await sb.storage
    .from(bucket)
    .upload(path, buf, { contentType: "image/jpeg", upsert: true });
  if (error && !`${error.message}`.includes("already exists")) {
    throw new Error(`upload ${bucket}/${path}: ${error.message}`);
  }
  return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

for (const person of PEOPLE) {
  const sb = client();
  let auth = await sb.auth.signInWithPassword({ email: person.email, password: PASSWORD });
  if (auth.error) {
    auth = await sb.auth.signUp({ email: person.email, password: PASSWORD });
    if (auth.error) throw new Error(`${person.email}: ${auth.error.message}`);
  }
  const userId = auth.data.user?.id;
  if (!userId) throw new Error(`${person.email}: no user id (email confirmation on?)`);
  console.log(`\n== ${person.display_name} (${userId})`);

  const avatarUrl = await uploadImage(sb, "avatars", `${userId}/seed-avatar.jpg`, person.avatar);
  const { error: profErr } = await sb
    .from("profiles")
    .update({
      username: person.username,
      display_name: person.display_name,
      headline: person.headline,
      bio: person.bio,
      location: person.location,
      avatar_url: avatarUrl,
    })
    .eq("id", userId);
  if (profErr) throw new Error(`profile: ${profErr.message}`);
  console.log("   profile ok");

  for (const car of person.cars) {
    let carId;
    const existing = await sb.from("cars").select("id").eq("slug", car.slug).maybeSingle();
    if (existing.data) {
      carId = existing.data.id;
      console.log(`   car ${car.name} exists`);
    } else {
      const ins = await sb
        .from("cars")
        .insert({
          owner_id: userId,
          slug: car.slug,
          name: car.name,
          make: car.make,
          model: car.model,
          year: car.year,
          color: car.color,
          about: car.about,
          tags: car.tags,
          is_public: true,
        })
        .select("id")
        .single();
      if (ins.error) throw new Error(`car ${car.name}: ${ins.error.message}`);
      carId = ins.data.id;
    }

    const coverUrl = await uploadImage(sb, "car-images", `${userId}/${carId}/seed-cover.jpg`, car.cover);
    await sb.from("cars").update({ cover_image_url: coverUrl }).eq("id", carId);
    for (const [i, key] of car.gallery.entries()) {
      const url = await uploadImage(sb, "car-images", `${userId}/${carId}/seed-gallery-${i}.jpg`, key);
      const dup = await sb.from("car_images").select("id").eq("car_id", carId).eq("url", url).maybeSingle();
      if (!dup.data) await sb.from("car_images").insert({ car_id: carId, url, position: i });
    }
    console.log(`   car ${car.name} ok`);

    for (const post of car.posts) {
      const dup = await sb
        .from("activity_posts")
        .select("id")
        .eq("car_id", carId)
        .eq("title", post.title)
        .maybeSingle();
      if (dup.data) {
        console.log(`   post "${post.title}" exists`);
        continue;
      }
      const url = await uploadImage(sb, "activity-images", `${userId}/${carId}/seed-${post.image}.jpg`, post.image);
      const postIns = await sb
        .from("activity_posts")
        .insert({
          car_id: carId,
          author_id: userId,
          title: post.title,
          intro: post.intro,
          body: [
            { type: "text", style: "normal", text: post.intro },
            { type: "images", urls: [url] },
          ],
          published_at: daysAgo(post.ago),
        })
        .select("id")
        .single();
      if (postIns.error) throw new Error(`post ${post.title}: ${postIns.error.message}`);
      const imgIns = await sb.from("activity_images").insert({ post_id: postIns.data.id, url, position: 0 });
      if (imgIns.error) throw new Error(`post image ${post.title}: ${imgIns.error.message}`);
      console.log(`   post "${post.title}" ok`);
    }

    for (const listing of car.listings) {
      const dup = await sb
        .from("listings")
        .select("id")
        .eq("seller_id", userId)
        .eq("title", listing.title)
        .maybeSingle();
      if (dup.data) {
        console.log(`   listing "${listing.title}" exists`);
        continue;
      }
      const ins = await sb
        .from("listings")
        .insert({
          seller_id: userId,
          source_car_id: carId,
          title: listing.title,
          description: listing.description,
          category: listing.category,
          condition: listing.condition,
          grade: listing.grade,
          price_cents: listing.price_cents,
          shipping_cents: listing.shipping_cents,
          allows_collection: true,
          currency: "usd",
          location: listing.location,
          status: "active",
        })
        .select("id")
        .single();
      if (ins.error) throw new Error(`listing ${listing.title}: ${ins.error.message}`);
      const url = await uploadImage(sb, "listing-images", `${userId}/seed-${listing.image}.jpg`, listing.image);
      const imgIns = await sb.from("listing_images").insert({ listing_id: ins.data.id, url, position: 0 });
      if (imgIns.error) throw new Error(`listing image ${listing.title}: ${imgIns.error.message}`);
      console.log(`   listing "${listing.title}" ok`);
    }
  }
  await sb.auth.signOut();
}

// ---- fix-ups on rows owned by accounts we can't sign in as ----
if (!SERVICE_KEY) {
  console.log("\nNo service key — skipping fix-ups.");
} else {
  const admin = client(SERVICE_KEY);
  console.log("\n== fix-ups (service key)");
  for (const fix of FIXUPS.cars) {
    const { data: car } = await admin
      .from("cars")
      .select("id, owner_id, cover_image_url")
      .eq("slug", fix.slug)
      .maybeSingle();
    if (!car) {
      console.log(`   car ${fix.slug} not found`);
      continue;
    }
    if (car.cover_image_url) {
      console.log(`   car ${fix.slug} already has a cover`);
      continue;
    }
    const url = await uploadImage(admin, "car-images", `${car.owner_id}/${car.id}/seed-cover.jpg`, fix.image);
    await admin.from("cars").update({ cover_image_url: url }).eq("id", car.id);
    const dup = await admin.from("car_images").select("id").eq("car_id", car.id).eq("url", url).maybeSingle();
    if (!dup.data) await admin.from("car_images").insert({ car_id: car.id, url, position: 0 });
    console.log(`   car ${fix.slug} cover ok`);
  }
  for (const fix of FIXUPS.listings) {
    const { data: listing } = await admin
      .from("listings")
      .select("id, seller_id")
      .eq("title", fix.title)
      .maybeSingle();
    if (!listing) {
      console.log(`   listing "${fix.title}" not found`);
      continue;
    }
    const { data: has } = await admin.from("listing_images").select("id").eq("listing_id", listing.id).limit(1);
    if (has?.length) {
      console.log(`   listing "${fix.title}" already has a photo`);
      continue;
    }
    const url = await uploadImage(admin, "listing-images", `${listing.seller_id}/seed-${fix.image}.jpg`, fix.image);
    const ins = await admin.from("listing_images").insert({ listing_id: listing.id, url, position: 0 });
    if (ins.error) throw new Error(`listing image ${fix.title}: ${ins.error.message}`);
    console.log(`   listing "${fix.title}" photo ok`);
  }
}

console.log("\nSeed complete.");
