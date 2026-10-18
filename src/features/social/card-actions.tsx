"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type MouseEvent, type ReactNode } from "react";

import { AnimatePresence, motion } from "motion/react";

import { AuthIntentDialog } from "@/components/ui";
import { Icon } from "@/components/ui/icons";
import { press, transitions } from "@/lib/motion";
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
 * Each control is its own interactive element beside the card's link (never
 * inside it); `stop()` stays as belt-and-braces against any ancestor
 * handler. Signed out, the shared auth-intent dialog explains and carries
 * the return path — never a silent no-op.
 *
 * The icons are ambiguous cold, so every action names itself on hover and
 * on keyboard focus through the stylesheet's `data-tip` tooltip — above the
 * control, no layout shift, and off on touch, where the accessible name and
 * the 40px target do the job. (Native `title` is gone: it doubled the
 * tooltip and never showed for keyboard users.)
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
  trailing,
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
  /** A context-owned control after the save button (a listing's cart
   *  button). Rendered inside the strip so it shares its floor. */
  trailing?: ReactNode;
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [likes, setLikes] = useState(likeCount);
  const [saved, setSaved] = useState(initialSaved);
  const [shared, setShared] = useState(false);
  const [pending, startTransition] = useTransition();
  const [askAuth, setAskAuth] = useState(false);
  // Which control asked: a like used to open "Sign in to save this —
  // Saved parts live on your account" on a build.
  const [authIntent, setAuthIntent] = useState<"like" | "save">("save");
  const [error, setError] = useState<string | null>(null);

  function requireAuth(e: MouseEvent, intent: "like" | "save"): boolean {
    if (isLoggedIn) return false;
    stop(e);
    setAuthIntent(intent);
    setAskAuth(true);
    return true;
  }

  function onLike(e: MouseEvent) {
    stop(e);
    if (requireAuth(e, "like")) return;
    // Optimistic: the row answers the tap; the action settles the truth.
    const next = !liked;
    setError(null);
    setLiked(next);
    setLikes((n) => Math.max(0, n + (next ? 1 : -1)));
    startTransition(async () => {
      try {
        const result =
          target.kind === "post"
            ? await toggleReaction(target.id, ACTIVITY_EMOJIS[0], path, next)
            : await toggleLike(target.kind, target.id, path, next);
        if (!("error" in result)) return;
        setLiked(!next);
        setLikes((n) => Math.max(0, n + (next ? -1 : 1)));
        setError(result.error === "login" ? "Sign in again to like this." : "Couldn't update that like. Try again.");
      } catch {
        setLiked(!next);
        setLikes((n) => Math.max(0, n + (next ? -1 : 1)));
        setError("Couldn't update that like. Try again.");
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
    if (requireAuth(e, "save")) return;
    const next = !saved;
    setError(null);
    setSaved(next);
    startTransition(async () => {
      try {
        const result = await toggleSave(target.kind as SaveTargetType, target.id, path, next);
        if ("error" in result) {
          setSaved(!next);
          setError(result.error === "login" ? "Sign in again to save this." : "Couldn't update that save. Try again.");
        }
      } catch {
        setSaved(!next);
        setError("Couldn't update that save. Try again.");
      }
    });
  }

  return (
    <span className={cx("cardeng", compact && "cardeng--compact")}>
      <motion.button
        type="button"
        onClick={onLike}
        disabled={pending}
        className={cx("cardeng__act", liked && "is-on")}
        aria-pressed={liked}
        aria-label={liked ? "Liked — tap to remove" : "Like"}
        data-tip={liked ? "Liked" : "Like"}
        {...press}
      >
        {/* Turning a like ON gets a mechanical settle; removing one doesn't
            celebrate. */}
        <motion.span
          className="inline-flex"
          animate={liked ? { scale: [1, 1.2, 1] } : { scale: 1 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        >
          <Icon name="heart" className="cardeng__ico" />
        </motion.span>
        {likes > 0 && <span className="cardeng__count">{likes}</span>}
      </motion.button>
      {commentHref && (
        <motion.button
          type="button"
          onClick={onComment}
          className="cardeng__act"
          aria-label={commentCount > 0 ? `Comments (${commentCount})` : "Comment"}
          data-tip="Comment"
          {...press}
        >
          <Icon name="comment" className="cardeng__ico" />
          {commentCount > 0 && <span className="cardeng__count">{commentCount}</span>}
        </motion.button>
      )}
      <motion.button
        type="button"
        onClick={onShare}
        className={cx("cardeng__act", shared && "is-on")}
        aria-label="Share"
        data-tip={shared ? "Link copied" : "Share"}
        {...press}
      >
        <Icon name="share" className="cardeng__ico" />
        <AnimatePresence>
          {shared && (
            <motion.span
              className="cardeng__count"
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0, transition: transitions.fast }}
              exit={{ opacity: 0, transition: transitions.fast }}
            >
              Copied
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
      <motion.button
        type="button"
        onClick={onSave}
        disabled={pending}
        className={cx("cardeng__act", "cardeng__act--end", saved && "is-on")}
        aria-pressed={saved}
        aria-label={saved ? "Saved — tap to remove" : "Save"}
        data-tip={saved ? "Saved" : "Save"}
        {...press}
      >
        <motion.span
          className="inline-flex"
          animate={saved ? { scale: [1, 1.2, 1] } : { scale: 1 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        >
          <Icon name="bookmark" className="cardeng__ico" />
        </motion.span>
      </motion.button>
      {trailing}
      {error && (
        <span role="alert" aria-live="polite" className="field__err">
          {error}
        </span>
      )}
      <AuthIntentDialog
        open={askAuth}
        onClose={() => setAskAuth(false)}
        intent={authIntent}
        subject={target.kind === "listing" ? "part" : target.kind === "car" ? "build" : "update"}
        returnPath={path}
        resume={authIntent === "save"}
      />
    </span>
  );
}
