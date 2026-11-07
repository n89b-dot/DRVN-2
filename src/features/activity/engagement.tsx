"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";

import { AuthIntentDialog, Button, CursorPagination, Message } from "@/components/ui";
import { ReportButton } from "@/features/moderation/report-button";
import { useHydrated } from "@/lib/hooks/useHydrated";

import { addComment, deleteComment, toggleReaction } from "./actions";
import { ACTIVITY_EMOJIS } from "./constants";

export type ReactionState = Record<string, { count: number; reacted: boolean }>;
export type CommentView = {
  id: string;
  authorName: string;
  initials: string;
  body: string;
  date: string;
  /** The viewer wrote it, or wrote the post it's under. */
  canDelete?: boolean;
  /** The viewer wrote it — no Report link on your own reply. */
  mine?: boolean;
};

/** "Delete" under a reply — two taps, because it can't be undone. */
function DeleteReply({ commentId, path }: { commentId: string; path: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteComment(commentId, path);
      if ("error" in result) {
        setError(result.error === "login" ? "Sign in again to delete this." : result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      {confirming ? (
        <>
          <button type="button" className="jumplink" onClick={remove} disabled={pending}>
            {pending ? "Deleting…" : "Delete reply"}
          </button>
          <button type="button" className="jumplink" onClick={() => setConfirming(false)} disabled={pending}>
            Keep
          </button>
        </>
      ) : (
        <button type="button" className="jumplink" onClick={() => setConfirming(true)}>
          Delete
        </button>
      )}
      {error && (
        <span role="alert" className="field__err">
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * Functional reply composer + emoji reactions on an activity post
 * (mockup ActivityDetailScreen). Reactions persist to activity_reactions;
 * replies persist to activity_comments.
 */
export function ActivityEngagement({
  postId,
  path,
  authorName,
  isLoggedIn,
  reactions,
  comments,
  replyCount = comments.length,
  earlierRepliesHref = null,
  latestRepliesHref = null,
}: {
  postId: string;
  path: string;
  authorName: string;
  isLoggedIn: boolean;
  reactions: ReactionState;
  /** One page of replies, oldest first. */
  comments: CommentView[];
  /** Every reply on the post, not just this page. */
  replyCount?: number;
  /** The page of replies before these; null when these reach the first. */
  earlierRepliesHref?: string | null;
  /** Back to the newest replies, when this is an earlier page. */
  latestRepliesHref?: string | null;
}) {
  const router = useRouter();
  // Optimistic with rollback: the count moves instantly, and if the server
  // rejects the toggle React reverts to the source-of-truth `reactions` prop
  // automatically — the old manual useState copy left a wrong count on screen
  // after a failure, forever.
  const [optimisticReactions, applyToggle] = useOptimistic<ReactionState, string>(
    reactions,
    (prev, emoji) => {
      const current = prev[emoji] ?? { count: 0, reacted: false };
      const reacted = !current.reacted;
      return {
        ...prev,
        [emoji]: { count: Math.max(0, current.count + (reacted ? 1 : -1)), reacted },
      };
    }
  );
  const [reactError, setReactError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // The reply box is controlled and only empties once the reply is saved: a
  // failed send keeps what was typed, with the reason under it.
  // Controlled fields must not replace what was typed before hydration
  // (see useHydrated): they stay disabled until the page is live.
  const ready = useHydrated();
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [pending, startReply] = useTransition();
  // Signed out, a reply or a reaction explains itself in the shared
  // auth-intent dialog instead of bouncing straight to /login (which also
  // threw away a typed reply).
  const [askAuth, setAskAuth] = useState<"reply" | "react" | null>(null);

  function goLogin() {
    router.push(`/login?next=${encodeURIComponent(path)}`);
  }

  function onReact(emoji: string) {
    if (!isLoggedIn) return setAskAuth("react");
    setReactError(null);
    startTransition(async () => {
      applyToggle(emoji);
      const result = await toggleReaction(postId, emoji, path);
      if ("error" in result && result.error) {
        if (result.error === "login") goLogin();
        else setReactError("That reaction didn't save — try again.");
      }
    });
  }

  return (
    <div id="replies" className="mt-10 border-t border-[color:var(--rule-mid)] pt-6">
      {/* A busy post's replies come a page at a time (N56): the count is
          every reply, and earlier ones are a link away. */}
      {replyCount > comments.length && (
        <p className="microlabel mb-3">
          {replyCount} replies · showing {comments.length}
        </p>
      )}
      <CursorPagination
        className="!mt-0 mb-4"
        label="Replies"
        newestHref={latestRepliesHref}
        olderHref={earlierRepliesHref}
        newestLabel="← Latest replies"
        olderLabel="Earlier replies →"
      />
      {comments.length > 0 && (
        <div className="mb-6 grid gap-4">
          {comments.map((comment) => (
            <Message
              key={comment.id}
              className="!py-2"
              who={
                <>
                  {comment.authorName}{" "}
                  <span className="normal-case tracking-normal">· {comment.date}</span>
                </>
              }
              body={comment.body}
              meta={
                comment.canDelete || !comment.mine ? (
                  <span className="inline-flex flex-wrap items-center gap-3">
                    {comment.canDelete && <DeleteReply commentId={comment.id} path={path} />}
                    {!comment.mine && (
                      <ReportButton
                        subjectType="comment"
                        subjectId={comment.id}
                        subjectLabel="this reply"
                        isLoggedIn={isLoggedIn}
                      />
                    )}
                  </span>
                ) : undefined
              }
            />
          ))}
        </div>
      )}

      {/* Reactions get their own row above the reply — four across fits a
          phone, where they used to wrap one onto a line of its own beside
          the input. */}
      <div className="reactrow" role="group" aria-label="React to this update">
        {ACTIVITY_EMOJIS.map((emoji) => {
          const r = optimisticReactions[emoji] ?? { count: 0, reacted: false };
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => onReact(emoji)}
              aria-pressed={r.reacted}
              // Reacted = selection, and selection is ink in this system
              // (matching .fbtn.is-on) — red stays reserved for live-now.
              className={`chip reactchip ${r.reacted ? "chip--ink" : ""}`}
            >
              <span className="reactchip__glyph">{emoji}</span>
              {r.count > 0 && <span className="reactchip__n">{r.count}</span>}
            </button>
          );
        })}
      </div>

      <p className="microlabel mt-6">Reply to {authorName} — posts publicly on this update</p>

      <div className="mt-3">
        {!isLoggedIn ? (
          <Button variant="ghost" className="w-full" onClick={() => setAskAuth("reply")}>
            Sign in to reply
          </Button>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!isLoggedIn) return goLogin();
              const body = reply.trim();
              if (!body || pending) return;
              const fd = new FormData();
              fd.set("post_id", postId);
              fd.set("path", path);
              fd.set("body", body);
              setReplyError(null);
              startReply(async () => {
                try {
                  const result = await addComment({}, fd);
                  if (result.error) {
                    setReplyError(result.error);
                    return;
                  }
                  setReply("");
                  router.refresh();
                } catch {
                  setReplyError("Your reply didn't send. It's still here — try again.");
                }
              });
            }}
            className="search w-full !py-2"
          >
            <input
              name="body"
              required
              placeholder="Reply directly…"
              disabled={!ready}
              value={reply}
              onChange={(event) => setReply(event.target.value)}
            />
            <button type="submit" disabled={pending} className="font-mono text-dim" aria-label="Send reply">
              ↵
            </button>
          </form>
        )}
      </div>

      {(replyError || reactError) && (
        <p role="alert" aria-live="polite" className="field__err mt-2">
          {replyError ?? reactError}
        </p>
      )}

      <AuthIntentDialog
        open={askAuth !== null}
        onClose={() => setAskAuth(null)}
        intent={askAuth ?? "reply"}
        returnPath={path}
        resume={false}
      />
    </div>
  );
}
