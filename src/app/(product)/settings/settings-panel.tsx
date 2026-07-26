"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { NOTIFICATION_PREFS, NOTIFICATION_PREF_GROUPS, prefEnabled } from "@/lib/notification-prefs";

import { updateNotificationPrefs, updateProfile, type ActionState } from "../garage/actions";

const SECTIONS = ["Account", "Profile", "Notifications", "Billing", "Design system"] as const;
type Section = (typeof SECTIONS)[number];

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

/** iOS-style switch driven by a hidden checkbox so it posts with the form. */
function Toggle({ name, defaultChecked }: { name: string; defaultChecked: boolean }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center">
      <input
        type="checkbox"
        name={name}
        checked={on}
        onChange={(e) => setOn(e.target.checked)}
        className="peer sr-only"
      />
      <span
        className={`h-6 w-11 rounded-full transition ${on ? "bg-accent" : "bg-raised"}`}
      />
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
          on ? "left-[22px]" : "left-0.5"
        }`}
      />
    </label>
  );
}

/** FormField per the design-system spec: uppercase tracking label + dark input. */
function Field({
  label,
  name,
  value,
  type = "text",
  placeholder,
}: {
  label: string;
  name: string;
  value: string;
  type?: "text" | "textarea" | "url";
  placeholder?: string;
}) {
  const inputClass =
    "rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent";
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">{label}</span>
      {type === "textarea" ? (
        <textarea name={name} defaultValue={value} rows={3} placeholder={placeholder} className={`resize-none ${inputClass}`} />
      ) : (
        <input name={name} type={type} defaultValue={value} placeholder={placeholder} className={inputClass} />
      )}
    </label>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-primary">{value}</span>
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
      className="mt-6"
    >
      <div className="grid gap-7">
        {NOTIFICATION_PREF_GROUPS.map((group) => (
          <div key={group}>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
              {group}
            </p>
            <div className="mt-3 grid gap-4">
              {NOTIFICATION_PREFS.filter((p) => p.group === group).map((pref) => (
                <div key={pref.key} className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary">{pref.label}</p>
                    <p className="text-xs text-text-muted">{pref.hint}</p>
                  </div>
                  <Toggle name={`pref_${pref.key}`} defaultChecked={prefEnabled(prefs, pref.key)} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {state.error && <p className="mt-3 text-sm text-red-400">{state.error}</p>}
      {saved && <p className="mt-3 text-sm text-success">Saved.</p>}
      <div className="mt-6 flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-[#1A1D1F] transition hover:bg-white/90"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

/**
 * Settings editor per the design-system SettingsModal pattern: rounded panel,
 * left section nav, right form panel (mockup SettingsScreen).
 */
export function SettingsPanel({
  profile,
  logout,
}: {
  profile: SettingsProfile;
  logout: () => Promise<void>;
}) {
  const [section, setSection] = useState<Section>("Account");
  const [state, action, pending] = useActionState<ActionState, FormData>(updateProfile, {});
  const [saved, setSaved] = useState(false);

  const linkValue = (label: string) => profile.links.find((l) => l.label === label)?.url ?? "";

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-surface">
      <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="min-w-0 border-b border-white/10 p-3 md:border-b-0 md:border-r">
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
            Settings
          </p>
          <div className="flex gap-1 overflow-x-auto md:grid md:gap-0.5">
            {SECTIONS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setSection(item)}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition ${
                  item === section
                    ? "bg-raised text-text-primary"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
          <form action={logout} className="mt-4 hidden border-t border-white/10 px-3 pt-4 md:block">
            <button type="submit" className="text-sm text-text-muted transition hover:text-red-400">
              Log out
            </button>
          </form>
        </nav>

        <div className="min-w-0 p-6 md:p-8">
          <h2 className="text-lg font-semibold text-text-primary">{section}</h2>

          {section === "Account" && (
            <>
              <p className="mt-1 text-sm text-text-muted">Your sign-in identity on DRVN.</p>
              <div className="mt-6 grid gap-3">
                <ReadOnlyRow label="Email" value={profile.email} />
                <ReadOnlyRow label="Username" value={`@${profile.username}`} />
                <ReadOnlyRow label="Display name" value={profile.display_name || "Not set"} />
              </div>
              <form action={logout} className="mt-7 md:hidden">
                <button
                  type="submit"
                  className="rounded-full border border-border px-5 py-2 text-sm text-text-secondary"
                >
                  Log out
                </button>
              </form>
            </>
          )}

          {section === "Profile" && (
            <>
              <p className="mt-1 text-sm text-text-muted">
                Edit the content that appears on your public profile.
              </p>
              <form
                action={(fd) => {
                  setSaved(true);
                  action(fd);
                }}
                className="mt-6 grid gap-5"
              >
                <Field label="Display name" name="display_name" value={profile.display_name} />
                <Field label="Headline" name="headline" value={profile.headline} placeholder="Product Designer" />
                <Field label="Location" name="location" value={profile.location} />
                <Field label="Bio" name="bio" value={profile.bio} type="textarea" />
                <Field label="Website" name="link_website" value={linkValue("website")} placeholder="https://…" />
                <Field label="Instagram" name="link_instagram" value={linkValue("instagram")} placeholder="https://instagram.com/…" />
                <Field label="YouTube" name="link_youtube" value={linkValue("youtube")} placeholder="https://youtube.com/…" />
                {state.error && <p className="text-sm text-red-400">{state.error}</p>}
                {saved && !pending && !state.error && <p className="text-sm text-success">Saved.</p>}
                <div className="flex justify-end gap-3">
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-[#1A1D1F] transition hover:bg-white/90"
                  >
                    {pending ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            </>
          )}

          {section === "Notifications" && (
            <>
              <p className="mt-1 text-sm text-text-muted">
                Choose what shows up on your Notifications page.
              </p>
              <NotificationPrefsForm prefs={profile.notification_prefs} />
            </>
          )}

          {section === "Billing" && (
            <>
              <p className="mt-1 text-sm text-text-muted">
                Payments currently run through a stubbed provider — Stripe Connect payouts plug in
                here without changing checkout.
              </p>
              <Link
                href="/orders"
                className="mt-6 inline-block rounded-full border border-border bg-raised px-4 py-2 text-sm text-text-primary transition hover:bg-raised/80"
              >
                Purchase & sales history →
              </Link>
            </>
          )}

          {section === "Design system" && (
            <>
              <p className="mt-1 text-sm text-text-muted">
                Internal reference for DRVN&apos;s components and tokens (kept during testing).
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Link
                  href="/design-system"
                  className="rounded-full border border-border bg-raised px-4 py-2 text-sm text-text-primary transition hover:bg-raised/80"
                >
                  Open design system →
                </Link>
                <Link
                  href="/mockup"
                  className="rounded-full border border-border px-4 py-2 text-sm text-text-secondary transition hover:text-text-primary"
                >
                  Clickable mockup
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
