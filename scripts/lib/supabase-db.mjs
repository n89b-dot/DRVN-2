// The one way the repo's scripts reach a hosted Supabase database directly
// (OS-W10, readiness N131 and N246): a named target from the committed
// allow-list, checked against the env file, over TLS that verifies the
// server's certificate against Supabase's own root CA and its hostname.
//
// There is no "skip verification" switch. A certificate that doesn't chain to
// the shipped Supabase root, or that names another host, fails the
// connection; so does a server that won't speak TLS.
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Supabase Root 2021 CA, the root every project's database certificate chains
// to (Supabase Intermediate 2021 CA → db.<ref>.supabase.co). Downloaded from
// the dashboard's Database Settings → SSL Configuration ("Download
// certificate", prod-ca-2021.crt). Valid to 26 April 2031.
export const SUPABASE_ROOT_CA_PATH = path.join(repoRoot, "supabase/certs/supabase-root-2021-ca.crt");
export const SUPABASE_ROOT_CA_SHA256 =
  "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA";

export const TARGETS_PATH = path.join(repoRoot, "supabase/migration-targets.json");

/** The shipped root CA, refused unless it is exactly the pinned certificate. */
export function loadSupabaseRootCa(file = SUPABASE_ROOT_CA_PATH) {
  const pem = readFileSync(file, "utf8");
  const cert = new X509Certificate(pem);
  if (cert.fingerprint256 !== SUPABASE_ROOT_CA_SHA256 || !cert.ca) {
    throw new Error(`${file} is not the pinned Supabase Root 2021 CA (sha256 ${cert.fingerprint256})`);
  }
  return pem;
}

/**
 * TLS options for a direct connection to `host`. `ca` replaces Node's default
 * trust store, so only certificates issued under that root are accepted, and
 * the hostname is checked against the certificate's names.
 */
export function verifiedTls(host, ca = loadSupabaseRootCa()) {
  return {
    ca,
    servername: host,
    rejectUnauthorized: true,
    checkServerIdentity: (name, cert) => tls.checkServerIdentity(name, cert),
  };
}

/** `SUPABASE_DB_PASSWORD` and the project ref from an env file's text. */
export function readDbEnv(text) {
  const password = text.match(/^SUPABASE_DB_PASSWORD=(.+)$/m)?.[1]?.trim();
  const ref = text.match(/^NEXT_PUBLIC_SUPABASE_URL=https:\/\/([a-z0-9]+)\.supabase\.co\/?\s*$/m)?.[1];
  return { password, ref };
}

/**
 * A Supabase session-pooler host: `aws-<n>-<region>.pooler.supabase.com`.
 * Its certificate is `*.pooler.supabase.com`, issued under the same pinned
 * Supabase Root 2021 CA as the direct host's (checked 9 Nov 2026 by a TLS
 * handshake that sent no password), so the same verification applies.
 */
export const POOLER_HOST = /^aws-\d+-[a-z]{2}-[a-z]+-\d+\.pooler\.supabase\.com$/;

/** The two ways to reach a project's database. */
export const ROUTES = ["direct", "pooler"];

/**
 * The committed allow-list: `{ targets: { <name>: { ref, note, pooler?,
 * statusRoute? } } }`. `pooler` pins the project's session-pooler host;
 * `statusRoute: "pooler"` makes read-only `--status` use it by default.
 */
export function loadTargets(file = TARGETS_PATH) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const targets = parsed?.targets;
  if (!targets || typeof targets !== "object") throw new Error(`${file} has no "targets" object`);
  for (const [name, target] of Object.entries(targets)) {
    if (!/^[a-z0-9]{20}$/.test(target?.ref ?? "")) throw new Error(`${file}: target ${name} has no valid project ref`);
    if (target.pooler !== undefined && !POOLER_HOST.test(target.pooler)) {
      throw new Error(`${file}: target ${name} has a pooler that is not a Supabase session-pooler host`);
    }
    if (target.statusRoute !== undefined && !ROUTES.includes(target.statusRoute)) {
      throw new Error(`${file}: target ${name} statusRoute must be one of ${ROUTES.join(", ")}`);
    }
    if (target.statusRoute === "pooler" && !target.pooler) {
      throw new Error(`${file}: target ${name} has statusRoute "pooler" but no pooler host`);
    }
  }
  return targets;
}

/**
 * Files allowed to run risky SQL (truncate or drop a table, dynamic SQL the
 * text doesn't show to be safe) on a populated database: `{ <file name>:
 * { sha256, reason } }`. An entry covers only those exact bytes.
 */
export function loadDynamicSqlAllowed(file = TARGETS_PATH) {
  const allowed = JSON.parse(readFileSync(file, "utf8"))?.dynamicSqlAllowed ?? {};
  for (const [name, entry] of Object.entries(allowed)) {
    if (!/^[0-9a-f]{64}$/.test(entry?.sha256 ?? "") || !entry?.reason) {
      throw new Error(`${file}: dynamicSqlAllowed.${name} needs a sha256 and a reason`);
    }
  }
  return allowed;
}

/**
 * The named target, only when it is on the allow-list AND is the project the
 * env file points at. Naming the target is the operator's explicit choice;
 * the env file alone never decides where a script writes.
 */
export function resolveTarget({ targets, name, envRef, route = "direct" }) {
  const names = Object.keys(targets).join(", ");
  if (!name) throw new Error(`name the target with --target <name> (allowed: ${names})`);
  const target = Object.hasOwn(targets, name) ? targets[name] : undefined;
  if (!target) {
    throw new Error(`target "${name}" is not in supabase/migration-targets.json (allowed: ${names})`);
  }
  if (!envRef) throw new Error("the env file has no NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co");
  if (target.ref !== envRef) {
    throw new Error(`target "${name}" is project ${target.ref}, but the env file points at ${envRef}: refusing`);
  }
  if (!ROUTES.includes(route)) throw new Error(`--route must be one of ${ROUTES.join(", ")}, not "${route}"`);
  if (route === "pooler") {
    if (!target.pooler) {
      throw new Error(`target "${name}" has no pooler host in supabase/migration-targets.json: use the direct route`);
    }
    // Session mode (port 5432) on the pinned pooler host. The user name
    // carries the project ref, which is how the pooler finds the project.
    return { name, ref: target.ref, note: target.note ?? "", route, host: target.pooler, user: `postgres.${target.ref}` };
  }
  return { name, ref: target.ref, note: target.note ?? "", route, host: `db.${target.ref}.supabase.co`, user: "postgres" };
}

/**
 * node-postgres client settings for the target's connection: the direct host
 * by default, or the session pooler (`user` from resolveTarget). Both verify
 * the certificate against the pinned root and the host name.
 */
export function directClientConfig({ host, password, ca, port = 5432, user = "postgres", applicationName = "drvn-script" }) {
  return {
    host,
    port,
    user,
    password,
    database: "postgres",
    ssl: verifiedTls(host, ca),
    application_name: applicationName,
    connectionTimeoutMillis: 15_000,
  };
}
