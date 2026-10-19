"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { AgentResultCard } from "@/components/commerce";
import { Button, ButtonLink, ChatComposer, FilterButton, MessageBubble, MessageRun, MessageThread, ResultNote } from "@/components/ui";
import { confirmBuildChange } from "./build";
import type { ResolvedCard } from "./cards";
import { sendAgentMessage, type ChatMessage } from "./chat";
import type { ChatAbout } from "./chat-load";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { uploadImages } from "@/lib/media-upload";

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** Starters above the composer (design 02): each fills the box, never sends. They follow what you opened it from. */
const STARTERS = ["Will this fit my car?", "What do parts like this sell for?", "Update my build", "Find parts for my car", "What's my agent doing?"];
/** A3d's jobs, once their step is open. */
const JOB_STARTERS = ["Paste my build", "List the parts that came off", "List this part from my photos", "Post an update"];
const MAX_PHOTOS = 4;
function startersFor(about: ChatAbout | null, jobs: boolean): string[] {
  if (!about) return jobs ? [...STARTERS.slice(0, 3), ...JOB_STARTERS, ...STARTERS.slice(3)] : STARTERS;
  if (about.kind === "car") return ["Update my build", "Find parts for my car", "What's on this car?"];
  return about.mine ? ["What do parts like this sell for?", "How is this listing doing?"] : ["Will this fit my car?", "What do parts like this sell for?"];
}

/**
 * The agent thread on /agent and in the desktop side panel (A3c): the member's messages and the agent's
 * replies, the listings a reply pointed at as result cards, starters and the
 * composer. One message, one model turn, stored server-side
 * (src/features/agent/chat.ts). The agent looks things up and explains; it
 * never sets a price or a limit from here — those stay on the listing and
 * offer pages.
 */
export function AgentChat({
  initial,
  about = null,
  jobs = false,
  userId,
}: {
  initial: ChatMessage[];
  about?: ChatAbout | null;
  /** The jobs step is open (A3d): its starters, and photos on a message. */
  jobs?: boolean;
  /** For the photo uploads' folder (the member's own). */
  userId?: string;
}) {
  const [messages, setMessages] = useState(initial);
  // What the next message is about: the opener's listing or car, until the
  // member clears it. A new opener (the panel reopened from elsewhere) resets it.
  const [context, setContext] = useState(about);
  const [contextFrom, setContextFrom] = useState(about);
  if (about?.id !== contextFrom?.id) {
    setContextFrom(about);
    setContext(about);
  }
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sent = useRef(false);
  const section = useRef<HTMLElement>(null);
  // Photos waiting to send (A3d): uploaded on pick, re-encoded server-side
  // (no location data), sent with the next message.
  const [photos, setPhotos] = useState<{ id: string; preview: string; url: string | null; error?: string }[]>([]);
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.preview)), []);
  const uploading = photos.some((photo) => !photo.url && !photo.error);
  const ready = photos.flatMap((photo) => (photo.url ? [photo.url] : []));

  async function addPhotos(files: File[]) {
    if (!userId) return;
    const room = MAX_PHOTOS - photos.length;
    const chosen = files.slice(0, Math.max(0, room));
    if (!chosen.length) return setError(`Up to ${MAX_PHOTOS} photos per message.`);
    const staged = chosen.map((file) => ({ id: crypto.randomUUID(), preview: URL.createObjectURL(file), url: null }));
    setPhotos((current) => [...current, ...staged]);
    setError(files.length > chosen.length ? `Up to ${MAX_PHOTOS} photos per message — the rest were left out.` : null);
    const { uploaded, failed } = await uploadImages({ files: chosen, bucket: "listing-images", pathPrefix: userId, normalize: true });
    setPhotos((current) =>
      current.map((photo) => {
        const index = staged.findIndex((s) => s.id === photo.id);
        if (index === -1) return photo;
        const done = uploaded.find((u) => u.file === chosen[index]);
        if (done) return { ...photo, url: done.url };
        return { ...photo, error: failed.find((f) => f.file === chosen[index])?.reason ?? "Photo upload failed." };
      }),
    );
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const photo = current.find((p) => p.id === id);
      if (photo) URL.revokeObjectURL(photo.preview);
      return current.filter((p) => p.id !== id);
    });
  }

  // After a send, bring the reply into view: the page's end, where the
  // composer settles under the thread instead of covering the newest line.
  useEffect(() => {
    if (!sent.current) return;
    sent.current = false;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = still ? "auto" : "smooth";
    // In the side panel its own body scrolls; on /agent, the page.
    const scroller = section.current?.closest(".sidepanel__body");
    if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior });
    else window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
  }, [messages]);

  function send() {
    const text = draft.trim();
    if ((!text && !ready.length) || pending || uploading) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await sendAgentMessage({ text, about: context ? { kind: context.kind, id: context.id } : undefined, images: ready });
        if (result.error) setError(result.error);
        if (result.messages?.length) {
          sent.current = true;
          setMessages((current) => [...current, ...result.messages!]);
          setDraft("");
          photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
          setPhotos([]);
        }
      } catch (caught) {
        unstable_rethrow(caught);
        setError("Couldn't reach your agent. Your message is still here; try again.");
      }
    });
  }

  return (
    <section ref={section} className="agentchat mt-6" aria-label="Chat with your agent">
      {messages.length > 0 && (
        <MessageThread>
          {messages.map((message) => (
            <MessageRun key={message.id} me={message.role === "member"} who={message.role === "member" ? "You" : "Agent"} when={message.created_at} whenLabel={time(message.created_at)}>
              <MessageBubble photos={message.images.length ? message.images : undefined}>{message.body}</MessageBubble>
              {message.cards.map((card) =>
                card.kind === "listing" ? (
                  <AgentResultCard
                    key={card.id}
                    eyebrow="Listing"
                    title={card.title}
                    meta={formatPrice(card.priceCents)}
                    image={{ src: card.image ?? undefined, alt: card.title }}
                    href={card.href}
                  />
                ) : card.kind === "listing_draft" ? (
                  <AgentResultCard
                    key={card.id}
                    eyebrow="Listing from your photos"
                    title={card.title}
                    meta={`${card.photos} ${card.photos === 1 ? "photo" : "photos"} · you add the price and condition`}
                    image={card.image ? { src: card.image, alt: card.title } : undefined}
                    href={card.href}
                  />
                ) : card.kind === "update_draft" ? (
                  <AgentResultCard
                    key={card.id}
                    eyebrow={`Update for your ${card.carName}`}
                    title={card.title}
                    meta="A draft in the update composer; you publish it"
                    image={card.image ? { src: card.image, alt: card.title } : undefined}
                    href={card.href}
                  />
                ) : card.kind === "list_part" ? (
                  <AgentResultCard
                    key={card.id}
                    eyebrow={card.listed ? "Listed" : "Came off your " + card.carName}
                    title={card.part}
                    meta={card.listed ? "Open the listing" : "List it: fitment from your car; you add condition and photos"}
                    href={card.href}
                  />
                ) : (
                  <BuildChangeCard key={card.id} card={card} />
                ),
              )}
            </MessageRun>
          ))}
        </MessageThread>
      )}

      <div className="agentchat__starters mt-4 flex flex-wrap gap-2" role="group" aria-label="Starters">
        {startersFor(context, jobs).map((starter) => (
          <FilterButton key={starter} onClick={() => setDraft(starter)}>
            {starter}
          </FilterButton>
        ))}
      </div>

      <ChatComposer
        value={draft}
        onValueChange={setDraft}
        onSend={send}
        canSend={(draft.trim().length > 0 || ready.length > 0) && !uploading}
        onFiles={jobs && userId ? (files) => void addPhotos(files) : undefined}
        attachLabel="Add photos of the part or your car"
        attachDisabled={photos.length >= MAX_PHOTOS}
        pending={pending}
        placeholder="Ask your agent…"
        inputLabel="Message your agent"
        above={
          context || photos.length ? (
            <>
              {context && (
                <div className="chatbox__topic">
                  <span>
                    About: <b className="text-ink">{context.label}</b>
                    {context.kind === "listing" && (context.mine ? ", your listing" : "")}
                  </span>
                  <Button variant="quiet" onClick={() => setContext(null)} aria-label={`Stop asking about ${context.label}`}>
                    ✕
                  </Button>
                </div>
              )}
              {photos.length > 0 && (
                <span className="chatbox__pending">
                  {photos.map((photo) => (
                    <span key={photo.id} className="chatbox__thumb" title={photo.error ?? undefined}>
                      {/* Local object URL preview — never optimised. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.preview} alt={photo.error ? `Failed: ${photo.error}` : "Photo to send"} style={{ opacity: photo.url ? 1 : 0.5 }} />
                      <button type="button" onClick={() => removePhoto(photo.id)} aria-label="Remove photo">
                        ×
                      </button>
                    </span>
                  ))}
                </span>
              )}
            </>
          ) : undefined
        }
        below={<ResultNote error={error ?? photos.find((photo) => photo.error)?.error ?? null} />}
      />
    </section>
  );
}

/**
 * A build draft as a confirm card (design 05): the exact change, then
 * Confirm or Edit. Confirm saves it through the mods editor's own save; Edit
 * opens the editor with it filled in. "Update my build" offers to list the
 * part that came off once saved; "Paste your build" says how many lines the
 * parser wasn't sure of, which the editor flags.
 */
function BuildChangeCard({ card }: { card: Extract<ResolvedCard, { kind: "build_change" | "build_list" }> }) {
  const [applied, setApplied] = useState(card.applied);
  const [sellHref, setSellHref] = useState(card.kind === "build_change" ? card.sellHref : null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await confirmBuildChange(card.id);
        if (result.error) setError(result.error);
        if (result.ok) {
          setApplied(true);
          setSellHref(result.sellHref ?? null);
        }
      } catch (caught) {
        unstable_rethrow(caught);
        setError("Couldn't save that. Try again, or open the editor.");
      }
    });
  }

  const list = card.kind === "build_list";
  const title = list ? `${card.lines} ${card.lines === 1 ? "line" : "lines"} for your ${card.carName}` : card.part;
  const meta = list
    ? applied
      ? "On your build"
      : card.toCheck
        ? `${card.toCheck} to check: Edit flags them in the editor`
        : "Ready to add to your build"
    : applied
      ? card.replaces
        ? `On your ${card.carName}; ${card.replaces} came off`
        : `On your ${card.carName}`
      : card.replaces
        ? `Add to your ${card.carName}; mark ${card.replaces} removed`
        : `Add to your ${card.carName}`;
  const image = !list && card.image ? { src: card.image, alt: card.part } : undefined;
  return (
    <div className="grid gap-2">
      <AgentResultCard
        eyebrow={applied ? "Build updated" : list ? "Paste your build" : "Update your build"}
        title={title}
        meta={meta}
        image={image}
        href={applied ? card.href : card.editHref}
        action={
          applied ? (
            sellHref ? (
              <ButtonLink href={sellHref} variant="ghost">
                List the old one
              </ButtonLink>
            ) : undefined
          ) : (
            <div className="flex gap-2">
              <Button variant="live" onClick={confirm} loading={pending} pendingLabel="Saving…">
                Confirm
              </Button>
              <ButtonLink href={card.editHref} variant="ghost">
                Edit
              </ButtonLink>
            </div>
          )
        }
      />
      <ResultNote error={error} />
    </div>
  );
}
