"use client";

import { useId, useRef, useState } from "react";

import { Avatar, Button, Dialog, FormField, Media, ResultNote, TextArea, TextField } from "@/components/ui";
import { useRecoverableAction } from "@/features/commerce/use-recoverable-action";
import { initialsFrom } from "@/components/profile/helpers";
import { uploadImages } from "@/lib/media-upload";

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
  // A lost response keeps the dialog and says so; saving again is safe.
  const [state, action, pending] = useRecoverableAction<ActionState>(updateProfile);

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
    setUploadingAvatar(true);
    try {
      const { uploaded, failed } = await uploadImages({
        files: [file],
        bucket: "avatars",
        pathPrefix: userId,
        maxBytes: 2 * 1024 * 1024,
      });
      if (failed.length) {
        setAvatarError(failed[0].reason);
        return;
      }
      if (uploaded[0]) {
        setAvatarUrl(uploaded[0].url);
        setSubmitted(false);
      }
    } catch {
      setAvatarError("The photo upload was interrupted. Try again.");
    } finally {
      setUploadingAvatar(false);
      if (avatarFileRef.current) avatarFileRef.current.value = "";
    }
  }

  const linkValue = (label: string) => profile.links.find((l) => l.label === label)?.url ?? "";
  const idBase = useId();
  const fid = (name: string) => `${idBase}-${name}`;

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Edit profile
      </Button>

      {/* Shared Dialog primitive: dialog role, Escape, focus trap, scroll
          lock — the hand-rolled sheetwrap had none of the four. */}
      <Dialog open={open} onClose={() => setOpen(false)} label="Profile details">
        <div className="sheet max-h-[85vh] overflow-y-auto text-left">
            <span className="microlabel microlabel--ink">Profile details</span>
            <form
              action={(fd) => {
                setSubmitted(true);
                return action(fd);
              }}
              onChange={() => setSubmitted(false)}
              className="mt-4"
            >
              <input type="hidden" name="avatar_url" value={avatarUrl ?? ""} />
              <FormField id={fid("avatar")} label="Avatar" error={avatarError}>
                <div className="flex items-center gap-4">
                  {avatarUrl ? (
                    <Media src={avatarUrl} alt="Your avatar" className="h-16 w-16 shrink-0 rounded-ctl" role="avatar" />
                  ) : (
                    <Avatar size="lg" initials={initialsFrom(profile.display_name)} />
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => avatarFileRef.current?.click()}
                    loading={uploadingAvatar}
                    pendingLabel="Uploading…"
                  >
                    Change photo
                  </Button>
                  <input
                    id={fid("avatar")}
                    ref={avatarFileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => handleAvatarFile(e.target.files)}
                  />
                </div>
              </FormField>
              <TextField id={fid("display_name")} label="Display name" name="display_name" defaultValue={profile.display_name} required className="max-w-none" />
              <TextField
                id={fid("headline")}
                label="Headline"
                name="headline"
                defaultValue={profile.headline}
                placeholder="e.g. B9 S4 owner, slowly going single-turbo"
                className="max-w-none"
              />
              <TextField id={fid("location")} label="Location" name="location" defaultValue={profile.location} className="max-w-none" />
              <TextArea id={fid("bio")} label="Bio" name="bio" defaultValue={profile.bio} rows={3} />
              <TextField id={fid("link_website")} label="Website" name="link_website" defaultValue={linkValue("website")} placeholder="https://…" className="max-w-none" />
              <TextField id={fid("link_instagram")} label="Instagram" name="link_instagram" defaultValue={linkValue("instagram")} placeholder="https://instagram.com/…" className="max-w-none" />
              <TextField id={fid("link_youtube")} label="YouTube" name="link_youtube" defaultValue={linkValue("youtube")} placeholder="https://youtube.com/…" className="max-w-none" />
              <ResultNote error={state.error} ok={saved ? "Profile saved" : null} />
              {/* Dialog primitive already appends its own Close button below —
                  a second one here duplicated it. */}
              <div className="sheet__actions">
                <Button type="submit" variant="live" loading={pending} pendingLabel="Saving…" className="flex-1">
                  Save profile
                </Button>
              </div>
            </form>
        </div>
      </Dialog>
    </>
  );
}
