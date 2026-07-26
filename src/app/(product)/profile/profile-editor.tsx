"use client";

import { useActionState, useState } from "react";

import { updateProfile, type ActionState } from "../garage/actions";

type ProfileLink = { label: string; url: string };

export function ProfileEditor({
  profile,
}: {
  profile: {
    display_name: string;
    headline: string;
    bio: string;
    location: string;
    links: ProfileLink[];
  };
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(updateProfile, {});

  const [submitted, setSubmitted] = useState(false);
  const saved = submitted && !pending && !state.error;

  const linkValue = (label: string) => profile.links.find((l) => l.label === label)?.url ?? "";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn--ghost">
        Edit sheet
      </button>

      {open && (
        <div className="sheetwrap is-open" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="sheet max-h-[85vh] overflow-y-auto text-left">
            <span className="microlabel microlabel--ink">Keeper details</span>
            <form
              action={(fd) => {
                setSubmitted(true);
                action(fd);
              }}
              className="mt-4"
            >
              <div className="field">
                <span className="microlabel">Keeper name</span>
                <input name="display_name" defaultValue={profile.display_name} required className="ctl max-w-none" />
              </div>
              <div className="field">
                <span className="microlabel">Headline</span>
                <input
                  name="headline"
                  defaultValue={profile.headline}
                  placeholder="One car, drawn honestly"
                  className="ctl max-w-none"
                />
              </div>
              <div className="field">
                <span className="microlabel">Location</span>
                <input name="location" defaultValue={profile.location} className="ctl max-w-none" />
              </div>
              <div className="field">
                <span className="microlabel">Sheet note</span>
                <textarea name="bio" defaultValue={profile.bio} rows={3} className="ctl" />
              </div>
              <div className="field">
                <span className="microlabel">Website</span>
                <input name="link_website" defaultValue={linkValue("website")} placeholder="https://…" className="ctl max-w-none" />
              </div>
              <div className="field">
                <span className="microlabel">Instagram</span>
                <input name="link_instagram" defaultValue={linkValue("instagram")} placeholder="https://instagram.com/…" className="ctl max-w-none" />
              </div>
              <div className="field">
                <span className="microlabel">YouTube</span>
                <input name="link_youtube" defaultValue={linkValue("youtube")} placeholder="https://youtube.com/…" className="ctl max-w-none" />
              </div>
              {state.error && (
                <p className="field__err" style={{ display: "flex" }}>
                  {state.error}
                </p>
              )}
              {saved && <span className="chip chip--ok">Sheet saved</span>}
              <div className="sheet__actions">
                <button type="submit" disabled={pending} className="btn btn--live flex-1">
                  {pending ? "Filing…" : "Save the sheet"}
                </button>
                <button type="button" onClick={() => setOpen(false)} className="btn btn--ghost">
                  Close
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
