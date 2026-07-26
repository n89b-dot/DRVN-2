"use client";

import { useActionState, useState } from "react";

import { updateProfile, type ActionState } from "../garage/actions";

type ProfileLink = { label: string; url: string };

const inputClass =
  "h-11 w-full rounded-input border border-border bg-app px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent";

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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-pill border border-border px-5 py-2.5 text-sm text-text-secondary transition hover:text-text-primary"
      >
        Edit profile
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-5"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="max-h-[85vh] w-full max-w-[440px] overflow-y-auto rounded-card border border-border bg-surface p-6">
            <h2 className="text-lg font-semibold text-text-primary">Edit profile</h2>
            <form
              action={(fd) => {
                setSubmitted(true);
                action(fd);
              }}
              className="mt-5 flex flex-col gap-3"
            >
              <input
                name="display_name"
                defaultValue={profile.display_name}
                required
                placeholder="Display name"
                className={inputClass}
              />
              <input
                name="headline"
                defaultValue={profile.headline}
                placeholder="Headline (e.g. Product Designer)"
                className={inputClass}
              />
              <input
                name="location"
                defaultValue={profile.location}
                placeholder="Location"
                className={inputClass}
              />
              <textarea
                name="bio"
                defaultValue={profile.bio}
                rows={3}
                placeholder="Bio"
                className="w-full resize-y rounded-input border border-border bg-app px-3 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
              />
              <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Links
              </p>
              <input name="link_website" defaultValue={linkValue("website")} placeholder="Website URL" className={inputClass} />
              <input name="link_instagram" defaultValue={linkValue("instagram")} placeholder="Instagram URL" className={inputClass} />
              <input name="link_youtube" defaultValue={linkValue("youtube")} placeholder="YouTube URL" className={inputClass} />
              {state.error && <p className="text-sm text-red-400">{state.error}</p>}
              {saved && <p className="text-sm text-success">Saved.</p>}
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-pill px-4 py-2 text-sm text-text-secondary hover:text-text-primary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-pill bg-accent px-5 py-2 text-sm font-semibold text-white transition hover:bg-accent/90"
                >
                  {pending ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
