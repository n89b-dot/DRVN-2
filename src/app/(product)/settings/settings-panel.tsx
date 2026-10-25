"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useState, useSyncExternalStore } from "react";

import {
  ActionFooter,
  Button,
  DataRow,
  PageHead,
  ScrollActiveIntoView,
  Select,
  TextArea,
  TextField,
  TileHead,
} from "@/components/ui";
import { NOTIFICATION_PREFS, NOTIFICATION_PREF_GROUPS, prefEnabled } from "@/lib/notification-prefs";
import type { SavedCard } from "@/lib/payments/customers";

import { updateNotificationPrefs, updateProfile, type ActionState } from "../garage/actions";
import type { ConnectSummary } from "./payout-setup";
import { DeleteAccount } from "./delete-account";
import { ExportAccount } from "./export-account";
import { PaymentMethods } from "./payment-methods";
import { PasswordSection } from "./password-section";
import { COUNTRIES, countryByCode } from "@/lib/geo/regions";

type ProfileLink = { label: string; url: string };
export type SettingsProfile = {
  email: string;
  username: string;
  display_name: string;
  headline: string;
  bio: string;
  location: string;
  country: string | null;
  region: string | null;
  default_offer_floor_pct: number | null;
  store_note: string | null;
  links: ProfileLink[];
  notification_prefs: unknown;
};

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
      onChange={() => setSubmitted(false)}
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

// Payouts is not a section: the payout account and the money ledger live on
// /payouts (the Selling family's money page) and Payments links there — the
// same ledger used to render in both places.
const SETTINGS_SECTIONS = [
  { id: "account", label: "Account" },
  { id: "profile", label: "Profile" },
  { id: "notifications", label: "Notifications" },
  { id: "privacy", label: "Privacy" },
  { id: "agent", label: "Agent" },
  { id: "payments", label: "Payments" },
  { id: "shipping", label: "Shipping" },
  { id: "shop", label: "Shop" },
  { id: "danger", label: "Danger zone" },
] as const;
type SectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/** Hashes that shipped under older section ids — old links still land. */
const LEGACY_SECTIONS: Record<string, SectionId> = {
  keeper: "profile",
  signals: "notifications",
};

function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export type { ConnectSummary };

/** Settings → Payments' pointer to the payout account, which lives on /payouts. */
function PayoutPointer({ connect }: { connect: ConnectSummary }) {
  return (
    <div className="mt-4 border-t border-[color:var(--rule-soft)] pt-4">
      <div className="flex items-center justify-between gap-4">
        <span className="microlabel microlabel--ink">Payout account</span>
        {!connect.stripeConfigured ? (
          <span className="chip">Test mode</span>
        ) : connect.unavailable ? (
          <span className="chip">Unavailable</span>
        ) : connect.payoutsEnabled ? (
          <span className="chip chip--ok">Payouts enabled</span>
        ) : connect.hasAccount ? (
          <span className="chip chip--live">Setup incomplete</span>
        ) : (
          <span className="chip chip--live">Not set up</span>
        )}
      </div>
      <p className="mt-2">
        <Link href="/payouts" className="jumplink">
          {connect.stripeConfigured && !connect.unavailable && !connect.payoutsEnabled
            ? "Set up payouts →"
            : "Payouts and earnings →"}
        </Link>
      </p>
    </div>
  );
}

export function SettingsPanel({
  profile,
  logout,
  savedCards,
  connect,
  paymentsLive,
  privacySection,
  agentSection,
  shippingSection,
  shopSection,
}: {
  profile: SettingsProfile;
  logout: () => Promise<void>;
  savedCards: SavedCard[];
  connect: ConnectSummary;
  paymentsLive: boolean;
  /** Settings → Privacy, server-rendered (reads the consent cookie + row). */
  privacySection?: React.ReactNode;
  /** Settings → Agent (AG-7), server-rendered; absent while the agent isn't open to members. */
  agentSection?: React.ReactNode;
  /** Settings → Shipping, server-rendered (0051 fulfillment profile). */
  shippingSection?: React.ReactNode;
  /** Settings → Shop, server-rendered (0056 shop profile). */
  shopSection?: React.ReactNode;
}) {
  // One section at a time (Mobbin pass: Contra / Cloudflare / Perplexity —
  // a rail plus a single active panel is what makes settings navigable).
  // The hash is the state, so /settings#signals deep links keep working.
  const activeHash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash.slice(1),
    () => ""
  );
  const router = useRouter();
  // The ledger moved to /payouts; an old /settings#payouts link follows it.
  useEffect(() => {
    if (activeHash === "payouts") router.replace("/payouts");
  }, [activeHash, router]);
  const active: SectionId = SETTINGS_SECTIONS.some((x) => x.id === activeHash)
    ? (activeHash as SectionId)
    : (LEGACY_SECTIONS[activeHash] ?? "account");
  const show = useCallback((id: SectionId) => {
    window.location.hash = id;
  }, []);

  const linkValue = (label: string) => profile.links.find((l) => l.label === label)?.url ?? "";
  const [state, action, pending] = useActionState<ActionState, FormData>(updateProfile, {});
  const [saved, setSaved] = useState(false);
  const [profileDraft, setProfileDraft] = useState(() => ({
    display_name: profile.display_name,
    headline: profile.headline,
    location: profile.location,
    // H-2: coarse on purpose — a country and a region, never a town. Local
    // wants the right ballpark; anything finer is location sharing.
    country: profile.country ?? "",
    region: profile.region ?? "",
    // P-9: a default for the sell form, not a rule applied to live listings.
    store_note: profile.store_note ?? "",
    default_offer_floor_pct: profile.default_offer_floor_pct
      ? String(profile.default_offer_floor_pct)
      : "",
    bio: profile.bio,
    link_website: linkValue("website"),
    link_instagram: linkValue("instagram"),
    link_youtube: linkValue("youtube"),
  }));
  const setProfileField = (field: keyof typeof profileDraft, value: string) => {
    setProfileDraft(current => ({ ...current, [field]: value }));
    setSaved(false);
  };
  return (
    <div>
      <PageHead
        className="pagehead--task"
        eyebrow="Settings"
        title="Settings."
        sub="Change what you need and hit save — nothing sticks until you do."
      />

      <div className="grid items-start gap-6 md:grid-cols-[200px_1fr]">
        {/* Compact widths pick a section from a native select: eight
            sideways-scrolling tabs showed two and a half of them, and the
            rest were undiscoverable. The rail returns at md. */}
        <Select
          id="settings-section"
          label="Section"
          value={active}
          onChange={(event) => show(event.target.value as SectionId)}
          fieldClassName="sectionjump !mb-0"
          className="max-w-none"
        >
          {SETTINGS_SECTIONS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </Select>
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
          <DataRow
            label="Username"
            value={profile.username ? `@${profile.username}` : "Not set"}
          />
          <DataRow label="Display name" value={profile.display_name || "Not set"} />
          <div className="mt-4 border-t border-[color:var(--rule-soft)] pt-4">
            <PasswordSection currentEmail={profile.email} />
          </div>
        </section>
        )}

        {active === "profile" && (
        <section id="profile" className="tile">
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
            onChange={() => setSaved(false)}
            className="mt-2"
          >
            <TextField
              id="profile-display_name"
              name="display_name"
              label="Display name"
              required
              value={profileDraft.display_name}
              onChange={(event) => setProfileField("display_name", event.target.value)}
            />
            <TextField
              id="profile-headline"
              name="headline"
              label="Headline"
              optional
              value={profileDraft.headline}
              onChange={(event) => setProfileField("headline", event.target.value)}
              placeholder="e.g. B9 S4 owner, slowly going single-turbo"
            />
            <TextField
              id="profile-location"
              name="location"
              label="Location"
              optional
              value={profileDraft.location}
              onChange={(event) => setProfileField("location", event.target.value)}
            />
            <div className="field--row mb-4">
              <Select
                id="profile-country"
                name="country"
                label="Country"
                value={profileDraft.country}
                onChange={(event) => {
                  setProfileField("country", event.target.value);
                  // A region belongs to its country; changing one clears the
                  // other rather than leaving an impossible pair behind.
                  setProfileField("region", "");
                }}
                fieldClassName="!mb-0"
              >
                <option value="">Not saying</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
              {(countryByCode(profileDraft.country)?.regions.length ?? 0) > 0 && (
                <Select
                  id="profile-region"
                  name="region"
                  label="Region"
                  value={profileDraft.region}
                  onChange={(event) => setProfileField("region", event.target.value)}
                  hint="Shows the Local tab on Home."
                  fieldClassName="!mb-0"
                >
                  <option value="">Anywhere in the country</option>
                  {countryByCode(profileDraft.country)!.regions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            <TextField
              id="profile-offer_floor"
              name="default_offer_floor_pct"
              label="Lowest offer, by default"
              optional
              type="number"
              min={10}
              max={100}
              inputMode="numeric"
              value={profileDraft.default_offer_floor_pct}
              onChange={(event) => setProfileField("default_offer_floor_pct", event.target.value)}
              placeholder="e.g. 80 (% of the asking price)"
              hint="Prefills the sell form. Never changes a listing that's already live."
            />
            <TextField
              id="profile-store_note"
              name="store_note"
              label="Store note"
              optional
              maxLength={180}
              value={profileDraft.store_note}
              onChange={(event) => setProfileField("store_note", event.target.value)}
              placeholder="e.g. Posted within two days, boxed properly."
              hint="One line above your parts — how you pack, when you post. Up to 180 characters."
            />
            <TextArea
              id="profile-bio"
              name="bio"
              label="Bio"
              optional
              rows={3}
              value={profileDraft.bio}
              onChange={(event) => setProfileField("bio", event.target.value)}
            />
            <TextField
              id="profile-link_website"
              name="link_website"
              label="Website"
              optional
              value={profileDraft.link_website}
              onChange={(event) => setProfileField("link_website", event.target.value)}
              placeholder="https://…"
            />
            <div className="field--row">
              <TextField
                id="profile-link_instagram"
                name="link_instagram"
                label="Instagram"
                optional
                value={profileDraft.link_instagram}
                onChange={(event) => setProfileField("link_instagram", event.target.value)}
                placeholder="https://instagram.com/…"
                fieldClassName="!mb-0"
              />
              <TextField
                id="profile-link_youtube"
                name="link_youtube"
                label="YouTube"
                optional
                value={profileDraft.link_youtube}
                onChange={(event) => setProfileField("link_youtube", event.target.value)}
                placeholder="https://youtube.com/…"
                fieldClassName="!mb-0"
              />
            </div>
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

        {active === "notifications" && (
        <section id="notifications" className="tile">
          <div className="tile__head">
            <span className="microlabel microlabel--ink">Notifications — what reaches you</span>
          </div>
          <NotificationPrefsForm prefs={profile.notification_prefs} />
        </section>
        )}

        {active === "privacy" && privacySection}

        {active === "agent" &&
          (agentSection ?? (
            <section id="agent" className="tile">
              <TileHead label="Agent" />
              <p className="field__hint max-w-[62ch]">Your agent isn&apos;t available yet. This is where you&apos;ll choose how far it may go.</p>
            </section>
          ))}

        {active === "payments" && (
        <section id="payments" className="tile tile--deep">
          <div className="tile__head">
            <span className="microlabel microlabel--ink">Payments &amp; fees</span>
            {!paymentsLive && <span className="chip">Test mode</span>}
          </div>
          <p className="field__hint max-w-[62ch]">
            {paymentsLive
              ? "Payments run live through Stripe."
              : "Test mode — no real money moves yet."}
          </p>
          <div className="mt-3">
            <div className="sheet__row">
              <span>DRVN fee on a sale</span>
              <b>10%</b>
            </div>
            <div className="sheet__row">
              <span>Charged on</span>
              <b>Price + shipping</b>
            </div>
            <div className="sheet__row">
              <span>Cost to list</span>
              <b>Free</b>
            </div>
          </div>
          <p className="field__hint mt-3 max-w-[62ch]">
            The buyer pays the asking price plus your shipping. DRVN&apos;s 10% is taken on that
            whole amount and comes out of your payout, so what you list is what they see.
          </p>
          <div className="mt-4 flex flex-wrap gap-4">
            <Link href="/orders" className="jumplink">
              Purchase &amp; sales history →
            </Link>
            <Link href="/fees" className="jumplink">
              Full fee schedule →
            </Link>
          </div>
          <PayoutPointer connect={connect} />
          <PaymentMethods cards={savedCards} />
        </section>
        )}

        {active === "shipping" && shippingSection}

        {active === "shop" && shopSection}

        {active === "danger" && (
        <section id="danger" className="tile">
          <div className="tile__head">
            <span className="microlabel microlabel--ink">Your data</span>
          </div>
          <p className="field__hint max-w-[62ch]">
            Request a private package of your account, content, both sides of your conversations
            and transactions, delivery records, and authorized evidence. Large packages resume
            safely and expire after seven days.
          </p>
          <div className="mb-6 mt-3">
            <ExportAccount />
          </div>
          <div className="tile__head">
            <span className="microlabel microlabel--ink">Delete your account</span>
          </div>
          <p className="field__hint max-w-[62ch]">
            Deleting removes your profile, posts, photos and listings. If you have an order still
            in progress, deletion waits until it&apos;s settled. Records of past sales are kept
            without your name where the law requires it.
          </p>
          <div className="mt-4">
            <DeleteAccount />
          </div>
        </section>
        )}
        </div>
      </div>

      {/* Signing out isn't an account edit — it sat inside the Account form
          as a third identical grey button. It closes the page instead. */}
      <form
        action={logout}
        className="mt-10 flex items-center justify-between gap-4 border-t border-[color:var(--rule-soft)] pt-6"
      >
        <span className="microlabel min-w-0 break-all">Signed in as {profile.email}</span>
        <Button type="submit" variant="ghost" className="shrink-0">
          Log out
        </Button>
      </form>
    </div>
  );
}
