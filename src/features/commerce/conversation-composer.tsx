"use client";

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";

import { ChatComposer, ResultNote } from "@/components/ui";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { uploadImages } from "@/lib/media-upload";
import { deleteStagedIfUnconsumed } from "@/lib/media-staging";

import type { CommerceState } from "./action-types";
import { sendThreadMessage } from "./message-actions";

export type ComposerDeal = { key: string; label: string };

type PendingPhoto = { id: string; preview: string; path: string | null; url: string | null; error?: string };

const MAX_PHOTOS = 4;

/**
 * Reply box for a person-first conversation. Every message is about one of
 * the deals between the two people (the send action still requires an order
 * or offer the sender is party to), so the composer carries an "About" picker
 * defaulting to the most relevant deal. Photos upload privately to
 * `message-photos/<me>/<them>/` and travel with the message as paths.
 *
 * One message identity survives retries until the server confirms it.
 */
export function ConversationComposer({
  meId,
  otherId,
  otherFirstName,
  deals,
  defaultDealKey,
  floating,
}: {
  meId: string;
  otherId: string;
  otherFirstName: string;
  deals: ComposerDeal[];
  defaultDealKey: string | null;
  /** Passed to ChatComposer — floats above the pinned composer. */
  floating?: ReactNode;
}) {
  const router = useRouter();
  const identity = useRef<string | null>(null);
  const inFlight = useRef(false);
  // Controlled fields must not replace what was typed before hydration
  // (see useHydrated): they stay disabled until the page is live.
  const hydrated = useHydrated();
  const [body, setBody] = useState("");
  // The picked topic survives live refreshes; it falls back to the default
  // only when the deal it pointed at is gone.
  const [chosen, setChosen] = useState<string | null>(null);
  const fallbackKey = defaultDealKey && deals.some((d) => d.key === defaultDealKey) ? defaultDealKey : deals[0]?.key ?? "";
  const dealKey = chosen && deals.some((d) => d.key === chosen) ? chosen : fallbackKey;
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<CommerceState>({});
  const topicId = useId();

  // Revoke any local previews still held when the composer unmounts.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  const uploading = photos.some((p) => !p.path && !p.error);
  const ready = photos.filter((p) => p.path);
  const canSend = Boolean(dealKey) && !uploading && (body.trim().length > 0 || ready.length > 0);

  async function addPhotos(files: File[]) {
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setState({ error: `Up to ${MAX_PHOTOS} photos per message.` });
      return;
    }
    const chosen = files.slice(0, room);
    const staged = chosen.map((file) => ({ id: crypto.randomUUID(), preview: URL.createObjectURL(file), path: null, url: null }));
    setPhotos((current) => [...current, ...staged]);
    setState(files.length > room ? { error: `Up to ${MAX_PHOTOS} photos per message — the rest were left out.` } : {});

    const { uploaded, failed } = await uploadImages({
      files: chosen,
      bucket: "message-photos",
      pathPrefix: `${meId}/${otherId}`,
      normalize: true,
    });
    setPhotos((current) =>
      current.map((photo) => {
        const index = staged.findIndex((s) => s.id === photo.id);
        if (index === -1) return photo;
        const file = chosen[index];
        const done = uploaded.find((u) => u.file === file);
        if (done) return { ...photo, path: done.path, url: done.url };
        const miss = failed.find((f) => f.file === file);
        return { ...photo, error: miss?.reason ?? "Photo upload failed." };
      }),
    );
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const photo = current.find((p) => p.id === id);
      if (photo?.url) void deleteStagedIfUnconsumed(photo.url).catch(() => {});
      if (photo) URL.revokeObjectURL(photo.preview);
      return current.filter((p) => p.id !== id);
    });
  }

  // A transition, so a redirect the action already followed — the sign-in
  // redirect when the session has ended, for one — lands in Next's redirect
  // boundary instead of being followed a second time.
  const [, startTransition] = useTransition();

  function send() {
    if (inFlight.current || !canSend) return;
    inFlight.current = true;
    setPending(true);
    setState({});
    identity.current ??= crypto.randomUUID();
    const [kind, id] = dealKey.split(":");
    const data = new FormData();
    data.set("message_id", identity.current);
    data.set("body", body);
    data.set(kind === "order" ? "order_id" : "offer_id", id);
    for (const photo of ready) data.append("attachment", photo.path!);
    startTransition(async () => {
      try {
        const result = await sendThreadMessage({}, data);
        if (result.ok) {
          setBody("");
          photos.forEach((p) => URL.revokeObjectURL(p.preview));
          setPhotos([]);
          identity.current = null;
          setState({});
          router.refresh();
        } else {
          setState(result);
        }
      } catch (error) {
        unstable_rethrow(error);
        setState({ error: "Couldn't confirm your message was sent. Your draft is still here; try again." });
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    });
  }

  if (!deals.length) {
    return (
      <p className="field__hint">
        Messages here are about an order or an offer between you and {otherFirstName}. There isn&apos;t one open to reply to.
      </p>
    );
  }

  return (
    <fieldset disabled={!hydrated} className="contents">
    <ChatComposer
      value={body}
      onValueChange={setBody}
      onSend={() => void send()}
      canSend={canSend}
      pending={pending}
      placeholder={`Message ${otherFirstName}…`}
      inputLabel={`Message ${otherFirstName}`}
      onFiles={(files) => void addPhotos(files)}
      attachDisabled={photos.length >= MAX_PHOTOS}
      floating={floating}
      above={
        <>
          {deals.length > 1 ? (
            <span className="chatbox__topic">
              <label htmlFor={topicId}>About</label>
              <select id={topicId} value={dealKey} onChange={(event) => setChosen(event.target.value)} disabled={pending}>
                {deals.map((deal) => (
                  <option key={deal.key} value={deal.key}>
                    {deal.label}
                  </option>
                ))}
              </select>
            </span>
          ) : (
            <span className="chatbox__topic">About {deals[0].label}</span>
          )}
          {photos.length > 0 && (
            <span className="chatbox__pending">
              {photos.map((photo) => (
                <span key={photo.id} className="chatbox__thumb" title={photo.error ?? undefined}>
                  {/* Local object URL preview — never optimised. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.preview} alt={photo.error ? `Failed: ${photo.error}` : "Photo to send"} style={{ opacity: photo.path ? 1 : 0.5 }} />
                  <button type="button" onClick={() => removePhoto(photo.id)} aria-label="Remove photo">
                    ×
                  </button>
                </span>
              ))}
            </span>
          )}
        </>
      }
      below={<ResultNote error={state.error ?? photos.find((p) => p.error)?.error} />}
    />
    </fieldset>
  );
}
