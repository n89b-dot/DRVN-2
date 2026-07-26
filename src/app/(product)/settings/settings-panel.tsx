"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { NOTIFICATION_PREFS, NOTIFICATION_PREF_GROUPS, prefEnabled } from "@/lib/notification-prefs";

import { updateNotificationPrefs, updateProfile, type ActionState } from "../garage/actions";

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
      <span className="bline__val !text-[15px]">{value}</span>
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
            <label key={pref.key} className="bline bline--ctl cursor-pointer">
              <span className="bline__label">{pref.label}</span>
              <span className="bline__note !col-start-2 !row-start-1">{pref.hint}</span>
              <span className="bline__checks">
                <input
                  type="checkbox"
                  name={`pref_${pref.key}`}
                  defaultChecked={prefEnabled(prefs, pref.key)}
                  className="sq"
                />
              </span>
            </label>
          ))}
        </div>
      ))}
      {state.error && (
        <p className="field__err mt-3" style={{ display: "flex" }}>
          {state.error}
        </p>
      )}
      <div className="mt-4 flex items-center justify-end gap-3">
        {saved && <span className="chip chip--ok">Signals saved</span>}
        <button type="submit" disabled={pending} className="btn">
          {pending ? "Filing…" : "Save signals"}
        </button>
      </div>
    </form>
  );
}

/**
 * The configuration sheet — one continuous ruled page with jumprow anchors
 * (Livesheet's tab replacement). Nothing files until you save.
 */
export function SettingsPanel({
  profile,
  logout,
}: {
  profile: SettingsProfile;
  logout: () => Promise<void>;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateProfile, {});
  const [saved, setSaved] = useState(false);

  const linkValue = (label: string) => profile.links.find((l) => l.label === label)?.url ?? "";

  return (
    <div>
      <header className="pagehead">
        <span className="microlabel">Configuration sheet</span>
        <h1>Your sheet, configured.</h1>
        <p className="sub">
          Everything the sheet assumes about you, ruled onto one page. Nothing files until you
          save.
        </p>
        <div className="jumprow">
          <span className="microlabel">On this sheet</span>
          <a className="jumplink" href="#account">
            Account
          </a>
          <a className="jumplink" href="#keeper">
            Keeper
          </a>
          <a className="jumplink" href="#signals">
            Signals
          </a>
          <a className="jumplink" href="#payments">
            Payments
          </a>
          <a className="jumplink" href="#reference">
            Reference
          </a>
        </div>
      </header>

      <div className="deck">
        <section id="account" className="tile">
          <div className="tile__head">
            <span className="microlabel microlabel--ink">Account — your sign-in identity</span>
          </div>
          <ReadOnlyLine label="Email" value={profile.email} />
          <ReadOnlyLine label="Username" value={`@${profile.username}`} />
          <ReadOnlyLine label="Display name" value={profile.display_name || "—"} />
          <form action={logout} className="mt-4">
            <button type="submit" className="btn btn--ghost">
              Log out
            </button>
          </form>
        </section>

        <section id="keeper" className="tile">
          <div className="tile__head">
            <span className="microlabel microlabel--ink">Keeper details — shown on your public sheet</span>
            <Link href={`/u/${profile.username}`} className="microlabel mono hover:text-live">
              View keeper sheet →
            </Link>
          </div>
          <form
            action={(fd) => {
              setSaved(true);
              action(fd);
            }}
          >
            <CtlLine label="Keeper name">
              <input name="display_name" defaultValue={profile.display_name} required className="ctl" />
            </CtlLine>
            <CtlLine label="Headline">
              <input name="headline" defaultValue={profile.headline} placeholder="One car, drawn honestly" className="ctl" />
            </CtlLine>
            <CtlLine label="Location">
              <input name="location" defaultValue={profile.location} className="ctl" />
            </CtlLine>
            <CtlLine label="Sheet note">
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
              <p className="field__err mt-3" style={{ display: "flex" }}>
                {state.error}
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-3">
              {saved && !pending && !state.error && <span className="chip chip--ok">Sheet saved</span>}
              <button type="submit" disabled={pending} className="btn btn--live">
                {pending ? "Filing…" : "Save the sheet"}
              </button>
            </div>
          </form>
        </section>

        <section id="signals" className="tile">
          <div className="tile__head">
            <span className="microlabel microlabel--ink">Signals — what the sheet shouts about</span>
          </div>
          <NotificationPrefsForm prefs={profile.notification_prefs} />
        </section>

        <section id="payments" className="tile tile--deep">
          <div className="tile__head">
            <span className="microlabel microlabel--ink">Payments</span>
            <span className="chip">Stubbed</span>
          </div>
          <p className="field__hint max-w-[62ch]">
            Payments currently run through a stubbed provider — Stripe Connect payouts plug in here
            without changing checkout.
          </p>
          <div className="mt-4">
            <Link href="/orders" className="jumplink">
              Purchase &amp; sales history →
            </Link>
          </div>
        </section>

        <section id="reference" className="tile tile--deep">
          <div className="tile__head">
            <span className="microlabel microlabel--ink">Reference</span>
          </div>
          <p className="field__hint max-w-[62ch]">
            Internal reference for DRVN&apos;s components and tokens (kept during testing).
          </p>
          <div className="mt-4 flex flex-wrap gap-4">
            <Link href="/design-system" className="jumplink">
              Open design system →
            </Link>
            <Link href="/mockup" className="jumplink">
              Clickable mockup →
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
