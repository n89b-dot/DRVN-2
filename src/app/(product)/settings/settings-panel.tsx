"use client";

import Link from "next/link";
import { useActionState, useCallback, useState, useSyncExternalStore } from "react";

import { ActionFooter, Button, ScrollActiveIntoView } from "@/components/ui";
import { NOTIFICATION_PREFS, NOTIFICATION_PREF_GROUPS, prefEnabled } from "@/lib/notification-prefs";
import type { SavedCard } from "@/lib/payments/customers";

import { updateNotificationPrefs, updateProfile, type ActionState } from "../garage/actions";
import { startConnectOnboarding } from "./payouts-actions";
import { DeleteAccount } from "./delete-account";
import { PaymentMethods } from "./payment-methods";
import { PasswordSection } from "./password-section";

type ProfileLink = { label: string; url: string };
export type SettingsProfile = {
  email: string;
  username: string;
  display_name: string;
  headline: string;
  bio: string;
  location: string;
  links: ProfileLink[];
  notification_prefs: unknown;
};

/** Ruled control row — label column, control in the value column. */
function CtlLine({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="bline bline--ctl">
      <span className="bline__label">{label}</span>
      {children}
      {hint && <span className="bline__note">{hint}</span>}
    </label>
  );
}

function ReadOnlyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="bline">
      <span className="bline__label">{label}</span>
      <span className="bline__val !text-body">{value}</span>
    </div>
  );
}

function NotificationPrefsForm({ prefs }: { prefs: unknown }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    updateNotificationPrefs,
    {}
  );
  const [submitted, setSubmitted] = useState(false);
  const saved = submitted && !pending && !state.error;

  return (
    <form
      action={(fd) => {
        setSubmitted(true);
        action(fd);
      }}
    >
      {NOTIFICATION_PREF_GROUPS.map((group) => (
        <div key={group}>
          <div className="bsec">
            <span className="microlabel microlabel--live">{group}</span>
          </div>
          {NOTIFICATION_PREFS.filter((p) => p.group === group).map((pref) => (
            <label
              key={pref.key}
              className="flex cursor-pointer items-center justify-between gap-4 border-b border-[color:var(--rule-soft)] py-3"
            >
              <span className="min-w-0">
                <span className="block font-mono text-micro uppercase tracking-[0.08em]">
                  {pref.label}
                </span>
                <span className="order__meta block">{pref.hint}</span>
              </span>
              <input
                type="checkbox"
                name={`pref_${pref.key}`}
                defaultChecked={prefEnabled(prefs, pref.key)}
                className="sq shrink-0"
              />
            </label>
          ))}
        </div>
      ))}
      {state.error && (
        <p role="alert" aria-live="polite" className="field__err mt-3">
          {state.error}
        </p>
      )}
      <ActionFooter status={saved ? { kind: "ok", message: "Preferences saved" } : null}>
        <Button type="submit" loading={pending} pendingLabel="Saving…">
          Save preferences
        </Button>
      </ActionFooter>
    </form>
  );
}

/**
 * The configuration sheet — one continuous ruled page with jumprow anchors
 * (Livesheet's tab replacement). Nothing files until you save.
 */

const SETTINGS_SECTIONS = [
  { id: "account", label: "Account" },
  { id: "keeper", label: "Profile" },
  { id: "signals", label: "Notifications" },
  { id: "payments", label: "Payments" },
  { id: "payouts", label: "Payouts" },
  { id: "danger", label: "Danger zone" },
] as const;
type SectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export type ConnectSummary = {
  stripeConfigured: boolean;
  hasAccount: boolean;
  payoutsEnabled: boolean;
};

/** Settings → Payments — Stripe Connect onboarding state and entry point. */
function PayoutSetup({ connect }: { connect: ConnectSummary }) {
  const [state, action, pending] = useActionState<{ error?: string }, FormData>(
    async () => (await startConnectOnboarding()) ?? {},
    {}
  );

  if (!connect.stripeConfigured) return null;

  return (
    <div className="mt-4 border-t border-[color:var(--rule-soft)] pt-4">
      <div className="flex items-center justify-between gap-4">
        <span className="microlabel microlabel--ink">Payouts</span>
        {connect.payoutsEnabled ? (
          <span className="chip chip--ok">Payouts enabled</span>
        ) : connect.hasAccount ? (
          <span className="chip">Setup incomplete</span>
        ) : (
          <span className="chip">Not set up</span>
        )}
      </div>
      <p className="field__hint mt-2 max-w-[62ch]">
        {connect.payoutsEnabled
          ? "Your Stripe account can receive payouts. Sale proceeds transfer automatically when a buyer's payment settles."
          : "Selling needs somewhere for the money to go. Stripe verifies your details and holds your bank account — DRVN never sees either. Until this is done, listings can't be published."}
      </p>
      <form action={action} className="mt-3">
        <Button type="submit" variant="live" loading={pending} pendingLabel="Opening Stripe…">
          {connect.payoutsEnabled
            ? "Update payout details"
            : connect.hasAccount
              ? "Finish payout setup"
              : "Set up payouts"}
        </Button>
      </form>
      {state.error && (
        <p role="alert" aria-live="polite" className="field__err mt-3">
          {state.error}
        </p>
      )}
    </div>
  );
}

export function SettingsPanel({
  profile,
  logout,
  savedCards,
  connect,
  paymentsLive,
  payoutsSection,
}: {
  profile: SettingsProfile;
  logout: () => Promise<void>;
  savedCards: SavedCard[];
  connect: ConnectSummary;
  paymentsLive: boolean;
  /** Settings → Payouts, server-rendered (the ledger needs server data). */
  payoutsSection?: React.ReactNode;
}) {
  // One section at a time (Mobbin pass: Contra / Cloudflare / Perplexity —
  // a rail plus a single active panel is what makes settings navigable).
  // The hash is the state, so /settings#signals deep links keep working.
  const activeHash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash.slice(1),
    () => ""
  );
  const active: SectionId = SETTINGS_SECTIONS.some((x) => x.id === activeHash)
    ? (activeHash as SectionId)
    : "account";
  const show = useCallback((id: SectionId) => {
    window.location.hash = id;
  }, []);

  const [state, action, pending] = useActionState<ActionState, FormData>(updateProfile, {});
  const [saved, setSaved] = useState(false);

  const linkValue = (label: string) => profile.links.find((l) => l.label === label)?.url ?? "";

  return (
    <div>
      <header className="pagehead pagehead--task">
        <span className="microlabel">Settings</span>
        <h1>Settings.</h1>
        <p className="sub">
          Profile, notifications, payouts — change what you need and hit save. Nothing sticks
          until you do.
        </p>
      </header>

      <div className="grid items-start gap-6 md:grid-cols-[200px_1fr]">
        <nav
          aria-label="Settings sections"
          className="sectionnav"
        >
          {SETTINGS_SECTIONS.map((x, index) => (
            <button
              key={x.id}
              type="button"
              onClick={() => show(x.id)}
              aria-current={active === x.id ? "true" : undefined}
              className={`rounded-ctl px-3 py-2 text-left font-mono text-micro uppercase tracking-[0.08em] whitespace-nowrap ${
                active === x.id
                  ? "bg-[color:var(--paper-deep)] font-semibold text-ink"
                  : "text-dim hover:text-ink"
              }`}
            >
              <span
                aria-hidden="true"
                className={`mr-2 ${active === x.id ? "text-live" : "opacity-50"}`}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              {x.label}
            </button>
          ))}
          <ScrollActiveIntoView selector="[aria-current]" />
        </nav>

        <div className="deck !mt-0">
        {active === "account" && (
        <section id="account" className="tile">
          <div className="tile__head">
            <span className="microlabel microlabel--ink">Account — your sign-in identity</span>
          </div>
          <ReadOnlyLine
            label="Username"
            value={profile.username ? `@${profile.username}` : "Not set"}
          />
          <ReadOnlyLine label="Display name" value={profile.display_name || "Not set"} />
          <div className="mt-4 border-t border-[color:var(--rule-soft)] pt-4">
            <PasswordSection currentEmail={profile.email} />
          </div>
          <form action={logout} className="mt-6">
            <Button type="submit" variant="ghost">
              Log out
            </Button>
          </form>
        </section>
        )}

        {active === "keeper" && (
        <section id="keeper" className="tile">
          <div className="tile__head">
            <span className="microlabel microlabel--ink">Profile — shown publicly on your listings and builds</span>
            <Link href={`/u/${profile.username}`} className="microlabel mono hover:text-live">
              View public profile →
            </Link>
          </div>
          <form
            action={(fd) => {
              setSaved(true);
              action(fd);
            }}
          >
            <CtlLine label="Display name">
              <input name="display_name" defaultValue={profile.display_name} required className="ctl" />
            </CtlLine>
            <CtlLine label="Headline">
              <input name="headline" defaultValue={profile.headline} placeholder="e.g. B9 S4 owner, slowly going single-turbo" className="ctl" />
            </CtlLine>
            <CtlLine label="Location">
              <input name="location" defaultValue={profile.location} className="ctl" />
            </CtlLine>
            <CtlLine label="Bio">
              <textarea name="bio" defaultValue={profile.bio} rows={3} className="ctl" />
            </CtlLine>
            <CtlLine label="Website">
              <input name="link_website" defaultValue={linkValue("website")} placeholder="https://…" className="ctl" />
            </CtlLine>
            <CtlLine label="Instagram">
              <input name="link_instagram" defaultValue={linkValue("instagram")} placeholder="https://instagram.com/…" className="ctl" />
            </CtlLine>
            <CtlLine label="YouTube">
              <input name="link_youtube" defaultValue={linkValue("youtube")} placeholder="https://youtube.com/…" className="ctl" />
            </CtlLine>
            {state.error && (
              <p role="alert" aria-live="polite" className="field__err mt-3">
                {state.error}
              </p>
            )}
            <ActionFooter
              status={saved && !pending && !state.error ? { kind: "ok", message: "Profile saved" } : null}
            >
              <Button type="submit" variant="live" loading={pending} pendingLabel="Saving…">
                Save profile
              </Button>
            </ActionFooter>
          </form>
        </section>
        )}

        {active === "signals" && (
        <section id="signals" className="tile">
          <div className="tile__head">
            <span className="microlabel microlabel--ink">Notifications — what reaches you</span>
          </div>
          <NotificationPrefsForm prefs={profile.notification_prefs} />
        </section>
        )}

        {active === "payments" && (
        <section id="payments" className="tile tile--deep">
          <div className="tile__head">
            <span className="microlabel microlabel--ink">Payments &amp; fees</span>
            {!paymentsLive && <span className="chip">Test mode</span>}
          </div>
          <p className="field__hint max-w-[62ch]">
            {paymentsLive
              ? "Payments run live through Stripe. Stripe Connect payouts plug into the same seam."
              : "Payments run through a test provider — no money moves yet. Stripe Connect payouts plug into the same seam."}
          </p>
          <div className="mt-3">
            <div className="sheet__row">
              <span>DRVN fee on a sale</span>
              <b>10%</b>
            </div>
            <div className="sheet__row">
              <span>Fee on shipping</span>
              <b>None</b>
            </div>
            <div className="sheet__row">
              <span>Cost to list</span>
              <b>Free</b>
            </div>
          </div>
          <p className="field__hint mt-3 max-w-[62ch]">
            The buyer pays the asking price plus your shipping; DRVN&apos;s fee comes out of your
            payout, so what you list is what they see.
          </p>
          <div className="mt-4 flex flex-wrap gap-4">
            <Link href="/orders" className="jumplink">
              Purchase &amp; sales history →
            </Link>
            <Link href="/fees" className="jumplink">
              Full fee schedule →
            </Link>
          </div>
          <PayoutSetup connect={connect} />
          <PaymentMethods cards={savedCards} />
        </section>
        )}

        {active === "payouts" && payoutsSection}

        {active === "danger" && (
        <section id="danger" className="tile">
          <div className="tile__head">
            <span className="microlabel microlabel--ink">Your data</span>
          </div>
          <p className="field__hint max-w-[62ch]">
            Download everything DRVN holds about you — profile, cars, listings, orders, offers,
            messages you&apos;ve sent — as one JSON file.
          </p>
          <div className="mb-6 mt-3">
            <a href="/api/account/export" download className="btn btn--ghost">
              Download my data
            </a>
          </div>
          <div className="tile__head">
            <span className="microlabel microlabel--ink">Delete your account</span>
          </div>
          <p className="field__hint max-w-[62ch]">
            Deleting your account removes your cars, listings and uploads. Orders you&apos;ve
            bought or sold stay on the other party&apos;s record, with your name replaced.
          </p>
          <div className="mt-4">
            <DeleteAccount />
          </div>
        </section>
        )}
        </div>
      </div>
    </div>
  );
}
