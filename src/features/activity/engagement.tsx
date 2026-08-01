"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState, useTransition } from "react";


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
  const [local, setLocal] = useState<ReactionState>(reactions);
  const [, startTransition] = useTransition();
  const [state, action, pending] = useActionState<CommentState, FormData>(addComment, {});
  const formRef = useRef<HTMLFormElement>(null);

  function goLogin() {
    router.push(`/login?next=${encodeURIComponent(path)}`);
  }

  function onReact(emoji: string) {
    if (!isLoggedIn) return goLogin();
    setLocal((prev) => {
      const current = prev[emoji] ?? { count: 0, reacted: false };
      const reacted = !current.reacted;
      return {
        ...prev,
        [emoji]: { count: Math.max(0, current.count + (reacted ? 1 : -1)), reacted },
      };
    });
    startTransition(async () => {
      const result = await toggleReaction(postId, emoji, path);
      if ("error" in result && result.error === "login") goLogin();
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
          const r = local[emoji] ?? { count: 0, reacted: false };
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => onReact(emoji)}
              className={`chip !gap-1 !py-2 text-base ${r.reacted ? "chip--live" : ""}`}
            >
              <span className="flex items-center gap-1">
                {emoji}
                {r.count > 0 && <span className="font-mono text-xs">{r.count}</span>}
              </span>
            </button>
          );
        })}
      </div>

      {state.error && (
        <p role="alert" aria-live="polite" className="field__err mt-2">
          {state.error}
        </p>
      )}
    </div>
  );
}
