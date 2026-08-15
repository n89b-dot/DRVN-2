"use client";

import { useRouter } from "next/navigation";
import { useActionState, useOptimistic, useRef, useState, useTransition } from "react";


import { addComment, toggleReaction, type CommentState } from "./actions";
import { ACTIVITY_EMOJIS } from "./constants";

export type ReactionState = Record<string, { count: number; reacted: boolean }>;
export type CommentView = { id: string; authorName: string; initials: string; body: string; date: string };

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
}: {
  postId: string;
  path: string;
  authorName: string;
  isLoggedIn: boolean;
  reactions: ReactionState;
  comments: CommentView[];
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
  const [state, action, pending] = useActionState<CommentState, FormData>(addComment, {});
  const formRef = useRef<HTMLFormElement>(null);

  function goLogin() {
    router.push(`/login?next=${encodeURIComponent(path)}`);
  }

  function onReact(emoji: string) {
    if (!isLoggedIn) return goLogin();
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
    <div className="mt-10 border-t border-[color:var(--rule-mid)] pt-6">
      {comments.length > 0 && (
        <div className="mb-6 grid gap-4">
          {comments.map((comment) => (
            <div key={comment.id} className="msg !py-2">
              <span className="msg__who">
                {comment.authorName} <span className="normal-case tracking-normal">· {comment.date}</span>
              </span>
              <p className="msg__body">{comment.body}</p>
            </div>
          ))}
        </div>
      )}

      <p className="microlabel">Reply to {authorName} — posts publicly on this update</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form
          ref={formRef}
          action={(fd) => {
            if (!isLoggedIn) return goLogin();
            fd.set("post_id", postId);
            fd.set("path", path);
            action(fd);
            formRef.current?.reset();
          }}
          className="search min-w-[200px] flex-1 !py-2"
        >
          <input name="body" required placeholder="Reply directly…" />
          <button type="submit" disabled={pending} className="font-mono text-dim" aria-label="Send reply">
            ↵
          </button>
        </form>

        {ACTIVITY_EMOJIS.map((emoji) => {
          const r = optimisticReactions[emoji] ?? { count: 0, reacted: false };
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => onReact(emoji)}
              // Reacted = selection, and selection is ink in this system
              // (matching .fbtn.is-on) — red stays reserved for live-now.
              className={`chip !gap-1 !py-2 text-base ${r.reacted ? "chip--ink" : ""}`}
            >
              <span className="flex items-center gap-1">
                {emoji}
                {r.count > 0 && <span className="font-mono text-xs">{r.count}</span>}
              </span>
            </button>
          );
        })}
      </div>

      {(state.error || reactError) && (
        <p role="alert" aria-live="polite" className="field__err mt-2">
          {state.error ?? reactError}
        </p>
      )}
    </div>
  );
}
