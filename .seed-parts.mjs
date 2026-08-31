/**
 * Seeds mod_items (the car sheet's parts list) for community/story cars.
 * Service-key writes; idempotent: skips any car that already has mod_items.
 * Lists agree with each car's build updates (the mods posted about exist here).
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY);

// [group, brand, product, part_number?]
const LISTS = {
  "scarlet-tts": [
    ["Performance", "034Motorsport", "P34 cold air intake", "034-108-1009"],
    ["Performance", "APR", "Stage 1 ECU tune — 93 octane"],
    ["Performance", "APR", "Turbo muffler delete", "MS100141"],
    ["Drivetrain", "DSG", "Factory S tronic — APR TCU tune planned"],
    ["Wheels & Tires", "Audi", 'OEM 20" 5-arm-star, Anthracite'],
    ["Wheels & Tires", "Michelin", "Pilot Sport 4S 255/30R20"],
    ["Interior", "Rennline", "Phone mount, magnetic"],
  ],
  "gruene-g80-m4": [
    ["Wheels & Tires", "BC Forged", "RZ21 19x9.5 +22 / 20x11 +25 — satin bronze"],
    ["Wheels & Tires", "Michelin", "Pilot Sport 4S 275/35 & 305/30"],
    ["Suspension", "KW", "H.A.S. height-adjustable spring kit", "253100AN"],
    ["Performance", "BMW M", "M Performance exhaust — flap coded open"],
    ["Exterior", "BMW M", "M Performance carbon front splitter"],
    ["Exterior", "IND", "Painted reflector deletes"],
    ["Interior", "BMW M", "M Carbon bucket seats — factory option"],
  ],
  "nimbus-g80-m4": [
    ["Exterior", "XPEL", "Ultimate Plus PPF — full front"],
    ["Interior", "BMW", "iDrive coding — exhaust flap, folding mirrors"],
    ["Wheels & Tires", "BMW M", "OEM 826M forged, double-spoke"],
  ],
  "frost-c8-z06": [
    ["Performance", "Chevrolet", "LT6 5.5L flat-plane V8 — stock"],
    ["Exterior", "Chevrolet", "Z07 carbon aero package — factory"],
    ["Wheels & Tires", "Chevrolet", "OEM spider-design forged alloys"],
    ["Wheels & Tires", "Michelin", "Pilot Sport Cup 2 R ZP — Z07 spec"],
    ["Brakes", "Chevrolet", "Carbon-ceramic brakes — Z07 package"],
    ["Interior", "Chevrolet", "Competition sport buckets"],
  ],
  "hagane-r34": [
    ["Performance", "Nissan", "RB26DETT — head out for refresh"],
    ["Performance", "Garrett", "Single turbo conversion — in progress"],
    ["Performance", "Tomei", "Expreme Ti titanium exhaust", "TB6090-NS05C"],
    ["Drivetrain", "Nismo", "Reinforced engine mounts", "11220-RS580"],
    ["Drivetrain", "Nismo", "Coppermix twin-plate clutch"],
    ["Suspension", "Öhlins", "DFV coilovers"],
    ["Brakes", "Brembo", "OEM Brembo calipers — refreshed, gold"],
    ["Wheels & Tires", "Volk Racing", "TE37SL 18x10.5 +15 — matte black"],
  ],
  "shirayuki-s15": [
    ["Suspension", "HKS", "Hipermax S coilovers — 8k/6k", "80300-AN002"],
    ["Suspension", "Cusco", "Front strut tower bar"],
    ["Performance", "HKS", "Super SQV IV blow-off valve"],
    ["Performance", "Apexi", "Power FC — base map"],
    ["Wheels & Tires", "Work", "Emotion CR Kai 18x9.5 +22 — bronze"],
    ["Drivetrain", "Nismo", "2-way mechanical LSD"],
    ["Interior", "Bride", "Zeta III — driver side"],
  ],
  "lucille-e46-m3": [
    ["Performance", "BMW", "S54 3.2 — stock, headers booked October"],
    ["Suspension", "Koni", "Yellow Sport dampers + Eibach springs"],
    ["Brakes", "StopTech", "Stainless lines, ATE Typ 200 fluid"],
    ["Wheels & Tires", "BMW", 'OEM 19" M double-spoke 67'],
    ["Interior", "BMW", "Individual — original spec preserved"],
  ],
  "signal-992-gt3": [
    ["Performance", "Porsche", "4.0 GT3 — bone stock, PCCB"],
    ["Wheels & Tires", "Michelin", "Pilot Sport Cup 2 R — track set"],
    ["Brakes", "Porsche", "PCCB carbon-ceramics — factory"],
    ["Suspension", "Porsche", "Front axle lift"],
    ["Interior", "AiM", "Solo 2 DL lap timer"],
    ["Interior", "Porsche", "Full bucket seats — 918 style"],
  ],
  "greta-850r": [
    ["Performance", "Volvo", "B5234T5 — 250 bhp, stock turbo"],
    ["Performance", "do88", "Performance intercooler"],
    ["Suspension", "Bilstein", "B8 dampers + factory Nivomat delete"],
    ["Wheels & Tires", "Volvo", "OEM Volans 17in — refinished"],
  ],
  "rosso-458-speciale": [
    ["Performance", "Capristo", "Valved titanium exhaust — full system"],
    ["Suspension", "Novitec", "Sport springs"],
    ["Wheels & Tires", "Ferrari", "OEM forged 20in — spare set listed"],
    ["Exterior", "Ferrari", "Nart racing stripe — factory"],
  ],
  "verde-performante": [
    ["Performance", "Akrapovič", "Slip-on line titanium"],
    ["Brakes", "Pagid", "RSC1 track pads"],
    ["Wheels & Tires", "Lamborghini", "OEM Narvi forged — Bronzo"],
    ["Exterior", "Lamborghini", "Forged composite ALA aero — factory"],
  ],
  "evo-ix-tarmac": [
    ["Performance", "HKS", "GT-RS turbo kit"],
    ["Performance", "Link", "G4X standalone ECU"],
    ["Suspension", "MCA", "Reds — tarmac spec"],
    ["Drivetrain", "Exedy", "Hyper Single clutch"],
    ["Wheels & Tires", "Enkei", "RPF1 17x9 +22"],
  ],
};

for (const [slug, rows] of Object.entries(LISTS)) {
  const { data: car } = await s.from("cars").select("id").eq("slug", slug).maybeSingle();
  if (!car) { console.log(`skip ${slug}: no car`); continue; }
  const { count } = await s.from("mod_items").select("id", { count: "exact", head: true }).eq("car_id", car.id);
  if (count > 0) { console.log(`skip ${slug}: already has ${count} mods`); continue; }
  const { error } = await s.from("mod_items").insert(rows.map(([group_label, brand, product, part_number], position) => ({
    car_id: car.id, group_label, brand, product, part_number: part_number ?? null,
    raw_text: `${brand} ${product}`, position,
  })));
  if (error) throw new Error(`${slug}: ${error.message}`);
  console.log(`ok ${slug}: ${rows.length} parts`);
}
console.log("Done.");
