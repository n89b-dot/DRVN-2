"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState, useTransition } from "react";

import { Avatar } from "@/components/ui";

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
    <div className="mt-10 border-t border-white/10 pt-6">
      {comments.length > 0 && (
        <div className="mb-6 grid gap-4">
          {comments.map((comment) => (
            <div key={comment.id} className="flex items-start gap-3">
              <Avatar size="h-8 w-8" initials={comment.initials} />
              <div className="min-w-0">
                <p className="text-sm">
                  <span className="font-semibold text-text-primary">{comment.authorName}</span>{" "}
                  <span className="text-xs text-text-muted">{comment.date}</span>
                </p>
                <p className="mt-0.5 text-sm leading-6 text-text-secondary">{comment.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-sm text-text-muted">Send {authorName} a reply about this page</p>

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
          className="flex min-w-[200px] flex-1 items-center rounded-full bg-raised px-4 py-1.5"
        >
          <input
            name="body"
            required
            placeholder="Reply directly…"
            className="h-8 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
          <button type="submit" disabled={pending} className="text-text-muted/60" aria-label="Send reply">
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
              className={`grid h-10 min-w-10 place-items-center gap-1 rounded-full px-2 text-base transition ${
                r.reacted ? "bg-accent/25 ring-1 ring-accent" : "bg-raised hover:bg-raised/70"
              }`}
            >
              <span className="flex items-center gap-1">
                {emoji}
                {r.count > 0 && <span className="text-xs text-text-secondary">{r.count}</span>}
              </span>
            </button>
          );
        })}
      </div>

      {state.error && <p className="mt-2 text-sm text-red-400">{state.error}</p>}
    </div>
  );
}
