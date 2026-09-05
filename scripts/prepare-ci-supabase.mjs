// Write local-only runtime values to GitHub's secret-masked environment file.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const destination = process.env.GITHUB_ENV;
if (!destination) throw new Error("This bootstrap requires GitHub Actions");
const raw = execFileSync("npx", ["--yes", "supabase@2.116.0", "status", "-o", "env"], { encoding: "utf8" });
const values = Object.fromEntries(raw.split("\n").flatMap(line => { const m = line.match(/^([A-Z_]+)="?(.*?)"?$/); return m ? [[m[1], m[2]]] : []; }));
const key = values.SERVICE_ROLE_KEY, anon = values.ANON_KEY;
if (!key || !anon) throw new Error("Local Supabase did not return test keys");
const settings = {
 NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon,
 NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, SUPABASE_SECRET_KEY: key,
 E2E_TEST_PROJECT_REF: "local-drvn-remediation", NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000", E2E_BASE_URL: "http://127.0.0.1:3000",
 GUEST_RECEIPT_SECRET: randomBytes(32).toString("hex"), CRON_SECRET: randomBytes(32).toString("hex"),
};
for (const [name,value] of Object.entries(settings)) {
 if (/KEY|SECRET/.test(name)) console.log(`::add-mask::${value}`);
 appendFileSync(destination, `${name}=${value}\n`);
}
