/**
 * Seeds rich Build Story Composer showcase content (Aug 2026):
 *  - four new community accounts (lena/marcus/jade/ryo @drvn.test) with cars
 *    (red TTS 8S, Isle of Man Green G80 M4, Arctic White C8 Z06, R34 GT-R)
 *  - a second car for marisol (Brooklyn Grey G80 M4)
 *  - V2-block build updates (mod / before_after / performance / mileage /
 *    divider) across new AND existing accounts so every automotive block is
 *    visible in real posts.
 *
 * Usage: node .seed-stories.mjs <manifest.json>   (image key -> local jpg)
 * Anon-key sign-in (RLS-clean); idempotent by car slug / post title.
 * Password for all: drvn-community-2026. NOT e2e-prefixed (survives sweeps).
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const images = JSON.parse(readFileSync(process.argv[2], "utf8"));
const PASSWORD = "drvn-community-2026";
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

/** People to ensure. `avatar` optional (existing accounts keep theirs). */
const PEOPLE = [
  {
    email: "lena@drvn.test", username: "lena_tts", display_name: "Lena Park",
    headline: "MQB gang. The TTS punches way above its badge.",
    bio: "Product designer by day. One red TTS, one torque wrench, zero regrets. Documenting every stage of the build here.",
    location: "Portland, OR", avatar: "lena-avatar",
    cars: [{
      name: "Scarlet", slug: "scarlet-tts", make: "Audi", model: "TTS", year: 2022,
      color: "Tango Red", tags: ["audi", "tts", "mqb", "quattro"],
      about: "2022 TTS coupé, Tango Red. Daily driven and slowly staged — intake and tune in, suspension next. MQB parts bin is a blessing and a curse.",
      cover: "tts-cover",
      posts: [{
        title: "Stage 1 weekend: intake + tune",
        intro: "Two mods, one Saturday, and the small coupe finally breathes.",
        ago: 2,
        body: [
          { type: "text", style: "normal", text: "Booked the tune months ago and did the intake myself the night before — classic. The 2.0T pulls so much harder past 4k now that the stock airbox feels criminal in hindsight." },
          { type: "mod", action: "installed", modItemId: null, label: "034Motorsport P34 cold air intake", detail: "Open cone, heat shield, silicone inlet" },
          { type: "mod", action: "updated", modItemId: null, label: "APR Stage 1 ECU tune", detail: "93 octane map" },
          { type: "images", urls: ["tts-intake"] },
          { type: "performance", kind: "dyno", entries: [ { label: "Power", value: "302 whp" }, { label: "Torque", value: "358 lb-ft" } ], note: "Mustang dyno, 93 octane, IATs around 20°C" },
          { type: "mileage", value: 28900, unit: "mi" },
          { type: "text", style: "normal", text: "Suspension is next. Debating H&R Ultra Lows vs proper coilovers — the ride quality argument is losing." }
        ],
      }],
    }],
  },
  {
    email: "marcus@drvn.test", username: "marcus_g80", display_name: "Marcus Reid",
    headline: "G80 M4 Comp. Isle of Man Green or nothing.",
    bio: "Atlanta. Washes it more than he drives it (false). The grille grew on me, the torque grew on me faster.",
    location: "Atlanta, GA", avatar: "marcus-avatar",
    cars: [{
      name: "Gruene", slug: "gruene-g80-m4", make: "BMW", model: "M4 Competition", year: 2021,
      color: "Isle of Man Green", tags: ["bmw", "m4", "g80", "s58"],
      about: "2021 M4 Competition in Isle of Man Green. S58 is an all-timer. Wheels and stance sorted; charge pipes and a tune on the shelf waiting for the warranty to lapse.",
      cover: "m4-marcus-cover",
      posts: [{
        title: "Wheels and a drop — Gruene sits right",
        intro: "Bronze on green, the combo that was always going to happen.",
        ago: 4,
        body: [
          { type: "text", style: "normal", text: "The factory 19/20 staggered setup never filled the arches on a car this wide. BC Forged in a satin bronze plus the KW height-adjustable springs and it finally looks like the press car renders." },
          { type: "mod", action: "installed", modItemId: null, label: "BC Forged RZ21 19x9.5 +22 / 20x11 +25", detail: "Satin bronze, square-ish setup" },
          { type: "mod", action: "installed", modItemId: null, label: "KW H.A.S. height-adjustable spring kit", detail: "-22mm front, -18mm rear" },
          { type: "before_after", beforeUrl: "m4-wheels-before", afterUrl: "m4-wheels-after", beforeLabel: "Factory 19s", afterLabel: "BC Forged + drop" },
          { type: "text", style: "normal", text: "Alignment booked for Thursday. Camber plates can wait until track season." }
        ],
      }],
    }],
  },
  {
    email: "jade@drvn.test", username: "jade_z06", display_name: "Jade Whitfield",
    headline: "C8 Z06. Flat-plane crank enjoyer, drag strip regular.",
    bio: "Houston. The LT6 revs to 8,600 and I intend to use all of them. Strip on Sundays, cars and coffee never.",
    location: "Houston, TX", avatar: "jade-avatar",
    cars: [{
      name: "Frost", slug: "frost-c8-z06", make: "Chevrolet", model: "Corvette Z06", year: 2023,
      color: "Arctic White", tags: ["chevrolet", "corvette", "c8", "z06", "lt6"],
      about: "2023 C8 Z06, Z07 aero, Arctic White. Bone stock and staying that way until the warranty says otherwise — the LT6 needs no help, just fuel and tires.",
      cover: "z06-cover",
      posts: [{
        title: "First real pass in the quarter",
        intro: "Stopped babying it. The flat-plane scream past the tree is worth the tire bill.",
        ago: 1,
        body: [
          { type: "text", style: "normal", text: "Third event with the car, first one where I launched it properly. Left on the two-step, short-shifted second, and it still trapped like a rocket. Mid-engine traction is cheating." },
          { type: "images", urls: ["z06-launch"] },
          { type: "performance", kind: "quarter_mile", entries: [ { label: "ET", value: "10.92 s" }, { label: "Trap", value: "127 mph" }, { label: "60 ft", value: "1.68 s" } ], note: "Owner-timed, prepped strip, 28°C" },
          { type: "mileage", value: 3100, unit: "mi" },
          { type: "text", style: "normal", text: "Next time out: drag radials and a proper cooldown lap routine. The brakes were done before the engine was." }
        ],
      }],
    }],
  },
  {
    email: "ryo@drvn.test", username: "ryo_r34", display_name: "Ryo Tanaka",
    headline: "R34 GT-R. Winter teardown season is the best season.",
    bio: "Osaka → Los Angeles. Twenty-year plan: keep the R34 forever. Everything that comes off the car gets documented and sold to a good home.",
    location: "Los Angeles, CA", avatar: "ryo-avatar",
    cars: [{
      name: "Hagane", slug: "hagane-r34", make: "Nissan", model: "Skyline GT-R", year: 2002,
      color: "Gunmetal Grey", tags: ["nissan", "skyline", "r34", "gtr", "rb26"],
      about: "2002 R34 GT-R in Gunmetal Grey, imported 2027-legal the long way. RB26 refresh in progress — single-turbo conversion this winter, wheels off, patience on.",
      cover: "r35-cover",
      posts: [{
        title: "Winter teardown starts — wheels off, turbos out",
        intro: "The RB26 refresh begins. Everything that comes off goes up for sale.",
        ago: 6,
        body: [
          { type: "text", style: "normal", text: "Car's on the lift until spring. Plan is simple: pull the tired factory twins, send the head out for a freshen-up, and go single while it's all apart." },
          { type: "images", urls: ["r34-lift"] },
          { type: "mod", action: "removed", modItemId: null, label: "Factory N1 twin turbos", detail: "62k km, good spare set — listing them" },
          { type: "mod", action: "installed", modItemId: null, label: "Nismo reinforced engine mounts" },
          { type: "divider" },
          { type: "text", style: "normal", text: "If you need OEM R34 bits, watch my listings this month. The good stuff goes fast." }
        ],
      }],
    }],
  },
  // Existing community accounts — new cars/posts only.
  {
    email: "kaito@drvn.test", username: "kaitosgarage", existing: true,
    cars: [{
      slug: "shirayuki-s15", existing: true,
      posts: [{
        title: "Coilovers in — Shirayuki finally sits right",
        intro: "HKS Hipermax in, alignment done, wheel gap gone.",
        ago: 3,
        body: [
          { type: "text", style: "normal", text: "Six years of stock suspension ended this weekend. Went HKS because every S15 I've loved ran them. Install was painless, corner balancing was not." },
          { type: "mod", action: "installed", modItemId: null, label: "HKS Hipermax S coilovers", detail: "8k/6k springs, 35mm drop" },
          { type: "before_after", beforeUrl: "s15-before", afterUrl: "s15-after", beforeLabel: "Stock height", afterLabel: "Hipermax, -35mm" },
          { type: "mileage", value: 135400, unit: "km" },
          { type: "text", style: "normal", text: "Next: a proper alignment printout post, because numbers or it didn't happen." }
        ],
      }],
    }],
  },
  {
    email: "marisol@drvn.test", username: "apexmarisol", existing: true,
    cars: [
      {
        slug: "lucille-e46-m3", existing: true,
        posts: [{
          title: "Lucille on the rollers — baseline before headers",
          intro: "Numbers first, mods second. Baseline dyno day for the E46.",
          ago: 5,
          body: [
            { type: "text", style: "normal", text: "Before the headers and tune go in next month I wanted an honest baseline on the same dyno I'll use after. 21 years old and she still pulls clean to 8k." },
            { type: "images", urls: ["e46-dyno"] },
            { type: "performance", kind: "dyno", entries: [ { label: "Power", value: "288 whp" }, { label: "Torque", value: "251 lb-ft" } ], note: "Stock airbox, 93 octane — baseline pull" },
            { type: "divider" },
            { type: "text", style: "normal", text: "Headers, section 1, and a Alpha N tune booked for October. Target is 315 at the wheels without touching the redline." }
          ],
        }],
      },
      {
        name: "Nimbus", slug: "nimbus-g80-m4", make: "BMW", model: "M4 Competition", year: 2022,
        color: "Brooklyn Grey", tags: ["bmw", "m4", "g80", "s58"],
        about: "The modern counterpoint to Lucille. 2022 M4 Competition in Brooklyn Grey — the daily that lets the E46 stay special.",
        cover: "m4-marisol-cover",
        posts: [{
          title: "Delivery day — meet Nimbus",
          intro: "Twenty years of M3 ownership finally bought the modern one.",
          ago: 8,
          body: [
            { type: "text", style: "normal", text: "Told myself for years the E46 was all the M car I needed. Then the S58 happened. Lucille keeps the weekends; Nimbus takes the commute, the rain, and the road trips." },
            { type: "images", urls: ["m4-delivery"] },
            { type: "text", style: "normal", text: "First order of business: coding the exhaust flap to stay open. Second: learning to love the grille. One of these is done already." }
          ],
        }],
      },
    ],
  },
  {
    email: "felix@drvn.test", username: "felix_gt3", existing: true,
    cars: [{
      slug: "signal-992-gt3", existing: true,
      posts: [{
        title: "Chasing the Cup car — lap day notes",
        intro: "Signal's third track day: new PB and a masterclass from a 992 Cup up ahead.",
        ago: 2,
        body: [
          { type: "text", style: "normal", text: "Perfect 14°C morning. Spent two sessions behind an actual Cup car and learned more about trail braking in forty minutes than in a year of solo lapping." },
          { type: "images", urls: ["gt3-pit", "gt3-corner"] },
          { type: "performance", kind: "lap", entries: [ { label: "Best lap", value: "2:01.4" }, { label: "Tyres", value: "Cup 2 R" }, { label: "Sessions", value: "4 x 20 min" } ], note: "Owner-timed via AiM Solo" },
          { type: "text", style: "normal", text: "PCCBs still fade-free after four sessions. The GT3 asks for more driver; working on delivering." }
        ],
      }],
    }],
  },
];

function client() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
}

async function uploadImage(sb, bucket, path, key) {
  const file = images[key];
  if (!file) throw new Error(`manifest missing image key: ${key}`);
  const buf = readFileSync(file);
  const { error } = await sb.storage.from(bucket).upload(path, buf, { contentType: "image/jpeg", upsert: true });
  if (error && !/already exists/i.test(error.message)) throw new Error(`upload ${bucket}/${path}: ${error.message}`);
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
  if (!userId) throw new Error(`${person.email}: no user id`);
  console.log(`\n== ${person.username} (${userId})`);

  if (!person.existing) {
    const avatarUrl = await uploadImage(sb, "avatars", `${userId}/seed-avatar.jpg`, person.avatar);
    const { error: profErr } = await sb.from("profiles").update({
      username: person.username, display_name: person.display_name, headline: person.headline,
      bio: person.bio, location: person.location, avatar_url: avatarUrl,
    }).eq("id", userId);
    if (profErr) throw new Error(`profile: ${profErr.message}`);
    console.log("   profile ok");
  }

  for (const car of person.cars) {
    let carId;
    const existing = await sb.from("cars").select("id").eq("slug", car.slug).maybeSingle();
    if (existing.data) {
      carId = existing.data.id;
      console.log(`   car ${car.slug} exists`);
    } else {
      if (car.existing) throw new Error(`expected existing car ${car.slug}`);
      const ins = await sb.from("cars").insert({
        owner_id: userId, slug: car.slug, name: car.name, make: car.make, model: car.model,
        year: car.year, color: car.color, about: car.about, tags: car.tags, is_public: true,
      }).select("id").single();
      if (ins.error) throw new Error(`car ${car.slug}: ${ins.error.message}`);
      carId = ins.data.id;
      console.log(`   car ${car.slug} created`);
    }
    if (car.cover) {
      const coverUrl = await uploadImage(sb, "car-images", `${userId}/${carId}/seed-cover.jpg`, car.cover);
      await sb.from("cars").update({ cover_image_url: coverUrl }).eq("id", carId);
      const dup = await sb.from("car_images").select("id").eq("car_id", carId).eq("url", coverUrl).maybeSingle();
      if (!dup.data) await sb.from("car_images").insert({ car_id: carId, url: coverUrl, position: 0 });
    }

    for (const post of car.posts ?? []) {
      const dup = await sb.from("activity_posts").select("id").eq("car_id", carId).eq("title", post.title).maybeSingle();
      if (dup.data) { console.log(`   post "${post.title}" exists`); continue; }

      // Resolve image keys inside blocks to uploaded public URLs.
      const resolved = [];
      const galleryUrls = [];
      for (const block of post.body) {
        if (block.type === "images") {
          const urls = [];
          for (const key of block.urls) {
            const url = await uploadImage(sb, "activity-images", `${userId}/${carId}/seed-${key}.jpg`, key);
            urls.push(url); galleryUrls.push(url);
          }
          resolved.push({ ...block, urls });
        } else if (block.type === "before_after") {
          const beforeUrl = await uploadImage(sb, "activity-images", `${userId}/${carId}/seed-${block.beforeUrl}.jpg`, block.beforeUrl);
          const afterUrl = await uploadImage(sb, "activity-images", `${userId}/${carId}/seed-${block.afterUrl}.jpg`, block.afterUrl);
          resolved.push({ ...block, beforeUrl, afterUrl });
        } else {
          resolved.push(block);
        }
      }

      const postIns = await sb.from("activity_posts").insert({
        car_id: carId, author_id: userId, title: post.title, intro: post.intro,
        body: resolved, published_at: daysAgo(post.ago),
      }).select("id").single();
      if (postIns.error) throw new Error(`post ${post.title}: ${postIns.error.message}`);
      for (const [i, url] of galleryUrls.entries()) {
        await sb.from("activity_images").insert({ post_id: postIns.data.id, url, position: i });
      }
      console.log(`   post "${post.title}" ok (${resolved.length} blocks)`);
    }
  }
  await sb.auth.signOut();
}
console.log("\nDone.");
