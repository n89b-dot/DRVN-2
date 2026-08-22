"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type MouseEvent } from "react";

import { AuthIntentDialog } from "@/components/ui";
import { Icon } from "@/components/ui/icons";
import { ACTIVITY_EMOJIS } from "@/features/activity/constants";
import { toggleReaction } from "@/features/activity/actions";
import { cx } from "@/lib/format";

import { toggleLike, toggleSave, type SaveTargetType } from "./actions";

/**
 * The engagement strip — like · comment · share · save, one quiet row at the
 * foot of every card (Explore deck, marketplace grid), the Instagram/Twitter
 * grammar in Livesheet's voice. One component so every card kind renders the
 * same row in the same order with the same behaviour:
 *
 *   like    — listings/cars write `likes` (0037, public counts); posts fire
 *             the 🔥 reaction, so the card and the activity page agree.
 *   comment — navigation, not a toggle: the thread lives on the detail sheet.
 *   share   — navigator.share where it exists, clipboard elsewhere.
 *   save    — the private bookmark (`saves`); posts joined the family in 0037.
 *
 * The cards are one big <Link>, so every control stops the event before it
 * navigates. Signed out, the shared auth-intent dialog explains and carries
 * the return path — never a silent no-op.
 */

export type EngagementTarget =
  | { kind: "listing"; id: string }
  | { kind: "car"; id: string }
  | { kind: "post"; id: string };

function stop(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

export function CardEngagement({
  target,
  path,
  isLoggedIn,
  initialLiked,
  likeCount = 0,
  commentHref,
  commentCount = 0,
  shareUrl,
  initialSaved,
  compact = false,
}: {
  target: EngagementTarget;
  /** Route the toggles revalidate — the page this card renders on. */
  path: string;
  isLoggedIn: boolean;
  initialLiked: boolean;
  likeCount?: number;
  /** Where the conversation lives (listing Q&A, post comments). Omit to hide. */
  commentHref?: string;
  commentCount?: number;
  /** Absolute or root-relative URL this card shares. */
  shareUrl: string;
  initialSaved: boolean;
  /** Tighter paddings for the ledger-row cards. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [likes, setLikes] = useState(likeCount);
  const [saved, setSaved] = useState(initialSaved);
  const [shared, setShared] = useState(false);
  const [, startTransition] = useTransition();
  const [askAuth, setAskAuth] = useState(false);

  function requireAuth(e: MouseEvent): boolean {
    if (isLoggedIn) return false;
    stop(e);
    setAskAuth(true);
    return true;
  }

  function onLike(e: MouseEvent) {
    stop(e);
    if (requireAuth(e)) return;
    // Optimistic: the row answers the tap; the action settles the truth.
    const next = !liked;
    setLiked(next);
    setLikes((n) => Math.max(0, n + (next ? 1 : -1)));
    startTransition(async () => {
      const result =
        target.kind === "post"
          ? await toggleReaction(target.id, ACTIVITY_EMOJIS[0], path)
          : await toggleLike(target.kind, target.id, path);
      if ("error" in result) {
        setLiked(!next);
        setLikes((n) => Math.max(0, n + (next ? -1 : 1)));
      }
    });
  }

  function onComment(e: MouseEvent) {
    stop(e);
    if (commentHref) router.push(commentHref);
  }

  function onShare(e: MouseEvent) {
    stop(e);
    const url = shareUrl.startsWith("http")
      ? shareUrl
      : `${window.location.origin}${shareUrl}`;
    if (navigator.share) {
      navigator.share({ url }).catch(() => {});
      return;
    }
    navigator.clipboard?.writeText(url).then(
      () => {
        setShared(true);
        window.setTimeout(() => setShared(false), 1600);
      },
      () => {}
    );
  }

  function onSave(e: MouseEvent) {
    stop(e);
    if (requireAuth(e)) return;
    const next = !saved;
    setSaved(next);
    startTransition(async () => {
      const result = await toggleSave(target.kind as SaveTargetType, target.id, path);
      if ("error" in result) setSaved(!next);
    });
  }

  return (
    <span className={cx("cardeng", compact && "cardeng--compact")}>
      <button
        type="button"
        onClick={onLike}
        className={cx("cardeng__act", liked && "is-on")}
        aria-pressed={liked}
        aria-label={liked ? "Liked — tap to remove" : "Like"}
        title={liked ? "Liked" : "Like"}
      >
        <Icon name="heart" className="cardeng__ico" />
        {likes > 0 && <span className="cardeng__count">{likes}</span>}
      </button>
      {commentHref && (
        <button
          type="button"
          onClick={onComment}
          className="cardeng__act"
          aria-label={commentCount > 0 ? `Comments (${commentCount})` : "Comment"}
          title="Comment"
        >
          <Icon name="comment" className="cardeng__ico" />
          {commentCount > 0 && <span className="cardeng__count">{commentCount}</span>}
        </button>
      )}
      <button
        type="button"
        onClick={onShare}
        className={cx("cardeng__act", shared && "is-on")}
        aria-label="Share"
        title={shared ? "Link copied" : "Share"}
      >
        <Icon name="share" className="cardeng__ico" />
        {shared && <span className="cardeng__count">Copied</span>}
      </button>
      <button
        type="button"
        onClick={onSave}
        className={cx("cardeng__act", "cardeng__act--end", saved && "is-on")}
        aria-pressed={saved}
        aria-label={saved ? "Saved — tap to remove" : "Save"}
        title={saved ? "Saved" : "Save"}
      >
        <Icon name="bookmark" className="cardeng__ico" />
      </button>
      <AuthIntentDialog
        open={askAuth}
        onClose={() => setAskAuth(false)}
        intent="save"
        returnPath={path}
      />
    </span>
  );
}
