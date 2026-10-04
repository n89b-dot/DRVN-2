/**
 * Seeds three fleshed-out community accounts — profiles, cars, build updates
 * with photos, and live listings — through the anon-key client so every row
 * passes the same RLS the app does. Idempotent-ish: signs in if the account
 * already exists, and skips cars/posts/listings that already exist by name.
 *
 * Usage: node .seed-community.mjs <manifest.json>
 * The manifest maps image keys → local file paths (downloaded generations).
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

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error("pass the image manifest path");
/** @type {Record<string, string>} key → local image file */
const images = JSON.parse(readFileSync(manifestPath, "utf8"));

const PASSWORD = "drvn-community-2026";

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

const PEOPLE = [
  {
    email: "kaito@drvn.test",
    username: "kaitosgarage",
    display_name: "Kaito Nakamura",
    headline: "SR20 lifer. If it doesn't rev to 8k I'm not interested.",
    bio: "Wrenching out of a two-car garage in Yokohama. S15 daily-tracked, parts hoard slowly being set free.",
    location: "Yokohama, JP",
    avatar: "kaito-avatar",
    cars: [
      {
        name: "Shirayuki",
        slug: "shirayuki-s15",
        make: "Nissan",
        model: "Silvia",
        year: 1999,
        color: "Pearl white",
        about:
          "Spec-R with the usual story: bought stock, promised to keep it stock, currently on coilovers with a built head on the bench.",
        tags: ["s15", "sr20det", "track", "jdm"],
        cover: "kaito-car",
        gallery: ["kaito-car"],
        posts: [
          {
            title: "Head's back from the machine shop",
            intro:
              "Fresh valve job, new stem seals, decked flat. The SR goes back together this month — cams are staying stock until the bottom end proves itself.",
            image: "kaito-post-engine",
            ago: 2,
          },
          {
            title: "Coilovers in, alignment booked",
            intro: "Swapped the blown rears in the driveway. Ride height is a placeholder until corner weights.",
            image: "kaito-post-coilover",
            ago: 9,
          },
        ],
        listings: [
          {
            title: "Rays bronze 17x9 +22 square set, tires included",
            description:
              "Ran one season on the S15. Two wheels have light curb rash photographed up close. Tires are 240 treadwear with half life left. No bends, no repairs — holds pressure fine.",
            category: "wheels-tires",
            subcategory: "wheels",
            condition: "used",
            grade: "b",
            price_cents: 168000,
            shipping_cents: 12000,
            image: "kaito-listing-wheels",
            location: "Yokohama, JP",
          },
          {
            title: "Garrett GT2871R, 40k km, shaft play in spec",
            description:
              "Pulled during the build for a bigger single. Light shaft play well within spec, no contact marks on the wheels. Oil lines included, manifold not.",
            category: "performance",
            subcategory: "turbo",
            condition: "used",
            grade: "b",
            price_cents: 62000,
            shipping_cents: 4500,
            image: "kaito-listing-turbo",
            location: "Yokohama, JP",
          },
        ],
      },
    ],
  },
  {
    email: "marisol@drvn.test",
    username: "apexmarisol",
    display_name: "Marisol Vega",
    headline: "Chasing tenths at COTA. The M3 eats consumables so I don't have to.",
    bio: "Track-day regular out of Austin. E46 M3 built for lapping days — everything I pull off it ends up for sale here.",
    location: "Austin, TX",
    avatar: "marisol-avatar",
    cars: [
      {
        name: "Lucille",
        slug: "lucille-e46-m3",
        make: "BMW",
        model: "M3",
        year: 2003,
        color: "Titanium silver",
        about:
          "One-owner E46 M3 turned track rat. Cage, buckets, big brakes; still on the stock S54 because it refuses to die.",
        tags: ["e46", "m3", "track", "cota"],
        cover: "marisol-car",
        gallery: ["marisol-car"],
        posts: [
          {
            title: "Brakes done before the enduro",
            intro:
              "New rotors and pads all around, fresh RBF600 through the lines. Bedding procedure tomorrow morning before the weekend.",
            image: "marisol-post-brakes",
            ago: 4,
          },
          {
            title: "Bucket and harness in at last",
            intro: "Side mounts took two attempts, but the seating position is finally right. Harness angles checked against the bar.",
            image: "marisol-post-seat",
            ago: 16,
          },
        ],
        listings: [
          {
            title: "E46 M3 front sport seats, black leather, pair",
            description:
              "Out of the car for buckets. Driver bolster shows honest wear, photographed. Rails and airbag connectors intact, no rips or tears.",
            category: "interior-lighting",
            subcategory: "seats",
            condition: "used",
            grade: "b",
            price_cents: 95000,
            shipping_cents: 18000,
            image: "marisol-listing-seats",
            location: "Austin, TX",
          },
          {
            title: "Big brake kit — 355mm rotors, 4-pot calipers, lines",
            description:
              "Complete front kit, one season of track use. Rotors have life left, calipers rebuilt with new seals before removal. Pads included are down to half.",
            category: "brakes-suspension",
            subcategory: "big-brake-kits",
            condition: "used",
            grade: "a",
            price_cents: 145000,
            shipping_cents: 9500,
            image: "marisol-listing-brakes",
            location: "Austin, TX",
          },
        ],
      },
    ],
  },
  {
    email: "tommy@drvn.test",
    username: "brickyard_tommy",
    display_name: "Tommy Eriksen",
    headline: "Keeping fast wagons alive in the rain.",
    bio: "Portland garage gremlin. Turbo Volvos, rust repair, and the occasional parts purge. If it's square and boosted I've probably owned one.",
    location: "Portland, OR",
    avatar: "tommy-avatar",
    cars: [
      {
        name: "Greta",
        slug: "greta-850r",
        make: "Volvo",
        model: "850R",
        year: 1996,
        color: "Red",
        about:
          "Actual R-car wagon, actual rust. Getting the shell right before the fun stuff — the 5-cylinder already pulls like it's angry about something.",
        tags: ["volvo", "850r", "wagon", "turbo"],
        cover: "tommy-car",
        gallery: ["tommy-car"],
        posts: [
          {
            title: "Rear arch rust cut out and welded",
            intro:
              "Found the usual crust behind the liner. Cut back to clean metal, welded in fresh steel, seam sealed. Paint next dry weekend.",
            image: "tommy-post-rust",
            ago: 6,
          },
          {
            title: "Intercooler piping finally sealed",
            intro: "Chased a boost leak for two weeks. It was the one clamp I swore I'd already checked.",
            image: "tommy-post-piping",
            ago: 20,
          },
        ],
        listings: [
          {
            title: "Thule roof box + rack, fits most wagons",
            description:
              "Off the 850 after a camping summer. Sun-faded but no cracks, both locks work with keys. Rack feet included for square rails.",
            category: "exterior-body",
            subcategory: "mirrors-trim",
            condition: "used",
            grade: "c",
            price_cents: 22000,
            shipping_cents: 0,
            image: "tommy-listing-roofbox",
            location: "Portland, OR",
          },
          {
            title: "IPD front + rear sway bar set, 850/S70/V70",
            description:
              "The classic upgrade. Bushings have life left, bars are straight with surface patina only. Sold because the new car came with them fitted.",
            category: "brakes-suspension",
            subcategory: "sway-bars",
            condition: "used",
            grade: "b",
            price_cents: 34000,
            shipping_cents: 6500,
            image: "tommy-listing-sways",
            location: "Portland, OR",
          },
        ],
      },
    ],
  },
];

function client() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
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
  // Sign in, or sign up on first run.
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
    // Car (skip if the slug is already taken by us).
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
      const url = await uploadImage(
        sb,
        "activity-images",
        `${userId}/${carId}/seed-${post.image}.jpg`,
        post.image
      );
      const publishedAt = daysAgo(post.ago);
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
          published_at: publishedAt,
        })
        .select("id")
        .single();
      if (postIns.error) throw new Error(`post ${post.title}: ${postIns.error.message}`);
      const imgIns = await sb
        .from("activity_images")
        .insert({ post_id: postIns.data.id, url, position: 0 });
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
          currency: "USD",
          location: listing.location,
          status: "active",
        })
        .select("id")
        .single();
      if (ins.error) throw new Error(`listing ${listing.title}: ${ins.error.message}`);
      const url = await uploadImage(
        sb,
        "listing-images",
        `${userId}/seed-${listing.image}.jpg`,
        listing.image
      );
      const imgIns = await sb
        .from("listing_images")
        .insert({ listing_id: ins.data.id, url, position: 0 });
      if (imgIns.error) throw new Error(`listing image ${listing.title}: ${imgIns.error.message}`);
      console.log(`   listing "${listing.title}" ok`);
    }
  }
  await sb.auth.signOut();
}

console.log("\nSeed complete.");
