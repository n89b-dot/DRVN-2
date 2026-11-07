#!/usr/bin/env node
/**
 * Creates or updates the two Stripe webhook endpoints DRVN needs.
 *
 *   platform  events on DRVN's own account -> STRIPE_WEBHOOK_SECRET
 *   connect   events on sellers' connected accounts (account.updated)
 *             -> STRIPE_CONNECT_WEBHOOK_SECRET
 *
 * Both point at <origin>/api/stripe/webhook. The route accepts an event signed
 * with either secret (src/app/api/stripe/webhook/route.ts).
 *
 * Usage (from the repo root):
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/owner/stripe-webhooks.mjs --origin https://staging.example.com
 *   ... --apply                 make the changes (default is a dry run)
 *   ... --live                  allow an sk_live_/rk_live_ key (and require one)
 *   ... --adopt-platform we_... treat this existing endpoint as the platform one
 *   ... --adopt-connect we_...  treat this existing endpoint as the Connect one
 *
 * The key is read from the environment only, never from argv (argv ends up in
 * shell history and process lists). The origin can also come from
 * DRVN_SITE_ORIGIN or NEXT_PUBLIC_SITE_URL.
 *
 * Dry run: with a key, it lists existing endpoints (read-only) and prints the
 * plan. Without a key, it prints the plan as if no endpoints existed.
 * Nothing is written to Stripe unless --apply is passed.
 *
 * Idempotent: endpoints this script made carry metadata drvn_endpoint =
 * platform|connect and are found by URL + that label, then updated. Stripe's
 * API does not say whether an existing endpoint is a Connect endpoint, so an
 * unlabelled endpoint at the same URL is never guessed at: the script stops
 * and asks you to adopt it (after checking "Listening to" in the Dashboard)
 * or delete it.
 */
import { fileURLToPath } from "node:url";

export const WEBHOOK_PATH = "/api/stripe/webhook";
/** The API version the app pins (STRIPE_API_VERSION in
 *  src/lib/payments/stripe.ts, N539); kept equal by
 *  src/lib/payments/stripe-api-version.test.ts. */
export const STRIPE_API_VERSION = "2026-07-29.dahlia";
export const LABEL_KEY = "drvn_endpoint";

/**
 * Exactly the event types dispatchStripeEvent (src/lib/payments/settlement.ts)
 * has a case for. stripe-webhooks.test.mjs fails if this drifts from the code.
 * payment_intent.payment_failed is acknowledged as irrelevant there but is
 * still listed, matching the runbook.
 */
export const PLATFORM_EVENTS = Object.freeze([
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.requires_action",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.closed",
  "account.updated",
]);

/** Sellers' Express accounts: the only Connect event the app acts on. */
export const CONNECT_EVENTS = Object.freeze(["account.updated"]);

export const ROLES = Object.freeze({
  platform: {
    connect: false,
    events: PLATFORM_EVENTS,
    envVar: "STRIPE_WEBHOOK_SECRET",
    description: "DRVN platform: payments, refunds, disputes",
  },
  connect: {
    connect: true,
    events: CONNECT_EVENTS,
    envVar: "STRIPE_CONNECT_WEBHOOK_SECRET",
    description: "DRVN Connect: seller account.updated",
  },
});

export function parseArgs(argv, env = {}) {
  const options = { apply: false, live: false, origin: null, adopt: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (!next || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--apply") options.apply = true;
    else if (arg === "--live") options.live = true;
    else if (arg === "--origin") options.origin = value();
    else if (arg === "--adopt-platform") options.adopt.platform = value();
    else if (arg === "--adopt-connect") options.adopt.connect = value();
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  options.origin = normalizeOrigin(options.origin ?? env.DRVN_SITE_ORIGIN ?? env.NEXT_PUBLIC_SITE_URL ?? "");
  for (const id of Object.values(options.adopt)) {
    if (!/^we_[A-Za-z0-9]+$/.test(id)) throw new Error(`Not a webhook endpoint id: ${id}`);
  }
  if (options.adopt.platform && options.adopt.platform === options.adopt.connect) {
    throw new Error("One endpoint can't be both the platform and the Connect endpoint");
  }
  return options;
}

/** The canonical origin: https, no credentials, path, query or fragment. */
export function normalizeOrigin(raw) {
  if (!raw) throw new Error("Pass --origin https://<site> (or set DRVN_SITE_ORIGIN)");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a URL: ${raw}`);
  }
  if (url.protocol !== "https:") throw new Error("The origin must be https:// (Stripe delivers only to public HTTPS endpoints)");
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("Pass the origin only, e.g. https://staging.example.com — no path, query or credentials");
  }
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Stripe can't reach localhost; use scripts/dev-stripe-listen.sh for local development");
  }
  return url.origin;
}

export function endpointUrl(origin) {
  return `${normalizeOrigin(origin)}${WEBHOOK_PATH}`;
}

/** Refuses live keys unless --live, and a test key when --live was asked for. */
export function checkKey(key, { live }) {
  if (!key) return { mode: null };
  const match = /^(sk|rk)_(test|live)_/.exec(key);
  if (!match) throw new Error("STRIPE_SECRET_KEY must be an sk_ or rk_ key");
  const mode = match[2];
  if (mode === "live" && !live) throw new Error("Refusing a live key without --live");
  if (mode === "test" && live) throw new Error("--live was passed but the key is a test key");
  return { mode };
}

const sameEvents = (a, b) => a.length === b.length && [...a].sort().every((event, i) => event === [...b].sort()[i]);
const sameUrl = (a, b) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/**
 * Pure planning step. `existing` is the list of endpoints on the account
 * (id, url, enabled_events, metadata, status, api_version, description).
 * Returns { actions, blockers, notes }; an action is create, update or none.
 */
export function planEndpoints({ existing, url, apiVersion, adopt = {} }) {
  const blockers = [];
  const notes = [];
  const actions = [];
  const atUrl = existing.filter((endpoint) => sameUrl(endpoint.url, url));
  const claimed = new Set();

  for (const [role, spec] of Object.entries(ROLES)) {
    let match = null;
    const adoptedId = adopt[role];
    if (adoptedId) {
      match = existing.find((endpoint) => endpoint.id === adoptedId) ?? null;
      if (!match) {
        blockers.push(`--adopt-${role} ${adoptedId}: no such endpoint on this account`);
        continue;
      }
      const label = match.metadata?.[LABEL_KEY];
      if (label && label !== role) {
        blockers.push(`--adopt-${role} ${adoptedId}: that endpoint is labelled "${label}"`);
        continue;
      }
      notes.push(`${role}: adopting ${adoptedId} as you asked. Stripe's API can't confirm it listens to ${spec.connect ? "connected accounts" : "your account"} — check "Listening to" in the Dashboard.`);
    } else {
      const labelled = atUrl.filter((endpoint) => endpoint.metadata?.[LABEL_KEY] === role);
      if (labelled.length > 1) {
        blockers.push(`${role}: ${labelled.length} endpoints at ${url} carry the ${role} label (${labelled.map((e) => e.id).join(", ")}). Delete the extras in the Dashboard.`);
        continue;
      }
      match = labelled[0] ?? null;
    }
    if (match) claimed.add(match.id);

    if (!match) {
      actions.push({
        role,
        kind: "create",
        params: {
          url,
          enabled_events: [...spec.events],
          connect: spec.connect,
          description: spec.description,
          metadata: { [LABEL_KEY]: role },
          ...(apiVersion ? { api_version: apiVersion } : {}),
        },
      });
      continue;
    }

    const changes = {};
    if (!sameUrl(match.url, url)) changes.url = url;
    if (!sameEvents(match.enabled_events ?? [], spec.events)) changes.enabled_events = [...spec.events];
    if (match.status === "disabled") changes.disabled = false;
    if (match.metadata?.[LABEL_KEY] !== role) changes.metadata = { [LABEL_KEY]: role };
    if (match.description !== spec.description) changes.description = spec.description;
    if (apiVersion && match.api_version && match.api_version !== apiVersion) {
      notes.push(`${role}: ${match.id} sends API version ${match.api_version}; the app pins ${apiVersion}. The version can't be changed on an existing endpoint — to align it, delete the endpoint and re-run (you'll get a new secret).`);
    }
    actions.push(
      Object.keys(changes).length
        ? { role, kind: "update", id: match.id, params: changes, before: match.enabled_events ?? [] }
        : { role, kind: "none", id: match.id }
    );
  }

  const unlabelled = atUrl.filter((endpoint) => !claimed.has(endpoint.id) && !endpoint.metadata?.[LABEL_KEY]);
  if (unlabelled.length) {
    blockers.push(
      `Found ${unlabelled.length} unlabelled endpoint(s) at ${url}: ${unlabelled
        .map((e) => `${e.id} [${(e.enabled_events ?? []).join(", ")}]`)
        .join("; ")}. Open each in Dashboard → Developers → Webhooks, read "Listening to", then re-run with --adopt-platform <id> / --adopt-connect <id>, or delete it. Creating new endpoints beside it would leave one whose secret the app doesn't have.`
    );
  }
  const elsewhere = existing.filter((endpoint) => endpoint.metadata?.[LABEL_KEY] && !sameUrl(endpoint.url, url) && !claimed.has(endpoint.id));
  for (const endpoint of elsewhere) {
    notes.push(`${endpoint.id} is labelled ${endpoint.metadata[LABEL_KEY]} but points at ${endpoint.url}. Left alone; delete it if that site is gone.`);
  }
  return { actions, blockers, notes };
}

export function describePlan({ actions, blockers, notes }, { apply }) {
  const lines = [];
  for (const action of actions) {
    const spec = ROLES[action.role];
    if (action.kind === "create") {
      lines.push(`${apply ? "CREATE" : "would CREATE"} ${action.role} endpoint (connect: ${spec.connect}) ${action.params.url}`);
      lines.push(`    events: ${action.params.enabled_events.join(", ")}`);
    } else if (action.kind === "update") {
      lines.push(`${apply ? "UPDATE" : "would UPDATE"} ${action.role} endpoint ${action.id}: ${Object.keys(action.params).join(", ")}`);
      if (action.params.enabled_events) {
        const added = action.params.enabled_events.filter((event) => !action.before.includes(event));
        const removed = action.before.filter((event) => !action.params.enabled_events.includes(event));
        if (added.length) lines.push(`    add: ${added.join(", ")}`);
        if (removed.length) lines.push(`    remove: ${removed.join(", ")}`);
      }
    } else {
      lines.push(`ok      ${action.role} endpoint ${action.id} already matches`);
    }
  }
  for (const note of notes) lines.push(`note: ${note}`);
  for (const blocker of blockers) lines.push(`BLOCKED: ${blocker}`);
  return lines.join("\n");
}

async function listEndpoints(stripe) {
  const all = [];
  for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) all.push(endpoint);
  return all;
}

const HELP = `Usage: STRIPE_SECRET_KEY=sk_test_... node scripts/owner/stripe-webhooks.mjs --origin https://<site> [--apply] [--live] [--adopt-platform we_...] [--adopt-connect we_...]`;

async function main() {
  const options = parseArgs(process.argv.slice(2), process.env);
  if (options.help) {
    console.log(HELP);
    return;
  }
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  const { mode } = checkKey(key, options);
  const url = endpointUrl(options.origin);
  if (options.apply && !key) throw new Error("--apply needs STRIPE_SECRET_KEY in the environment");

  let stripe = null;
  let apiVersion = null;
  if (key) {
    const { default: Stripe } = await import("stripe");
    stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION, timeout: 20_000, maxNetworkRetries: 2 });
    apiVersion = STRIPE_API_VERSION;
  }
  console.log(`Stripe ${mode ? `${mode} mode` : "(no key: offline preview)"} · endpoint ${url}${options.apply ? "" : " · DRY RUN"}`);

  const existing = stripe ? await listEndpoints(stripe) : [];
  const plan = planEndpoints({ existing, url, apiVersion, adopt: options.adopt });
  console.log(describePlan(plan, options));
  if (plan.blockers.length) {
    process.exitCode = 1;
    return;
  }
  if (!options.apply) {
    console.log("\nDry run: nothing changed. Re-run with --apply to make these changes.");
    return;
  }

  const secrets = [];
  for (const action of plan.actions) {
    const spec = ROLES[action.role];
    if (action.kind === "create") {
      const created = await stripe.webhookEndpoints.create(action.params);
      console.log(`created ${action.role} endpoint ${created.id}`);
      secrets.push({ role: action.role, envVar: spec.envVar, id: created.id, secret: created.secret });
    } else if (action.kind === "update") {
      await stripe.webhookEndpoints.update(action.id, action.params);
      console.log(`updated ${action.role} endpoint ${action.id}`);
      secrets.push({ role: action.role, envVar: spec.envVar, id: action.id, secret: null });
    } else {
      secrets.push({ role: action.role, envVar: spec.envVar, id: action.id, secret: null });
    }
  }

  console.log("\nSigning secrets — put each in the hosting provider's environment for this site, then redeploy:");
  for (const entry of secrets) {
    if (entry.secret) {
      console.log(`  ${entry.envVar}=${entry.secret}`);
    } else {
      console.log(`  ${entry.envVar}: unchanged. Stripe only shows a secret at creation; reveal it in Dashboard → Developers → Webhooks → ${entry.id} → Signing secret.`);
    }
  }
  console.log("\nStore them in the password manager, never in the repo or chat. Then send a test event from each endpoint and confirm a 200.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  });
}
