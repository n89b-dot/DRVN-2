"use client";

import { useActionState, useRef, useState } from "react";

import { Avatar, Media } from "@/components/ui";
import { initialsFrom } from "@/components/profile/helpers";
import { createClient } from "@/lib/supabase/client";

import { updateProfile, type ActionState } from "../garage/actions";

type ProfileLink = { label: string; url: string };

export function ProfileEditor({
  userId,
  profile,
}: {
  userId: string;
  profile: {
    display_name: string;
    headline: string;
    bio: string;
    location: string;
    avatar_url: string | null;
    links: ProfileLink[];
  };
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(updateProfile, {});

  const [submitted, setSubmitted] = useState(false);
  const saved = submitted && !pending && !state.error;

  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarFileRef = useRef<HTMLInputElement>(null);

  async function handleAvatarFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setAvatarError(null);
    if (file.size > 2 * 1024 * 1024) {
      setAvatarError("Image is over 2MB.");
      return;
    }
    setUploadingAvatar(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { contentType: file.type });
      if (uploadError) {
        setAvatarError(uploadError.message);
        return;
      }
      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(path);
      setAvatarUrl(publicUrl);
    } finally {
      setUploadingAvatar(false);
      if (avatarFileRef.current) avatarFileRef.current.value = "";
    }
  }

  const linkValue = (label: string) => profile.links.find((l) => l.label === label)?.url ?? "";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn--ghost">
        Edit profile
      </button>

      {open && (
        <div className="sheetwrap is-open" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="sheet max-h-[85vh] overflow-y-auto text-left">
            <span className="microlabel microlabel--ink">Profile details</span>
            <form
              action={(fd) => {
                setSubmitted(true);
                action(fd);
              }}
              className="mt-4"
            >
              <input type="hidden" name="avatar_url" value={avatarUrl ?? ""} />
              <div className="field">
                <span className="microlabel">Avatar</span>
                <div className="flex items-center gap-4">
                  {avatarUrl ? (
                    <Media src={avatarUrl} alt="Your avatar" className="h-16 w-16 shrink-0 rounded-ctl" />
                  ) : (
                    <Avatar size="h-16 w-16 text-xl" initials={initialsFrom(profile.display_name)} />
                  )}
                  <button
                    type="button"
                    onClick={() => avatarFileRef.current?.click()}
                    disabled={uploadingAvatar}
                    className="btn btn--ghost"
                  >
                    {uploadingAvatar ? "Uploading…" : "Change photo"}
                  </button>
                  <input
                    ref={avatarFileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => handleAvatarFile(e.target.files)}
                  />
                </div>
                {avatarError && (
                  <p role="alert" aria-live="polite" className="field__err">
                    {avatarError}
                  </p>
                )}
              </div>
              <div className="field">
                <span className="microlabel">Display name</span>
                <input name="display_name" defaultValue={profile.display_name} required className="ctl max-w-none" />
              </div>
              <div className="field">
                <span className="microlabel">Headline</span>
                <input
                  name="headline"
                  defaultValue={profile.headline}
                  placeholder="e.g. B9 S4 owner, slowly going single-turbo"
                  className="ctl max-w-none"
                />
              </div>
              <div className="field">
                <span className="microlabel">Location</span>
                <input name="location" defaultValue={profile.location} className="ctl max-w-none" />
              </div>
              <div className="field">
                <span className="microlabel">Bio</span>
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
                <p role="alert" aria-live="polite" className="field__err">
                  {state.error}
                </p>
              )}
              {saved && <span className="chip chip--ok">Profile saved</span>}
              <div className="sheet__actions">
                <button type="submit" disabled={pending} className="btn btn--live flex-1">
                  {pending ? "Saving…" : "Save profile"}
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
