"use client";

import { useRouter } from "next/navigation";
import { useActionState, useOptimistic, useRef, useState, useTransition } from "react";


import { AuthIntentDialog, Button, Message } from "@/components/ui";

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
    <div className="mt-10 border-t border-[color:var(--rule-mid)] pt-6">
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
            ref={formRef}
            action={(fd) => {
              if (!isLoggedIn) return goLogin();
              fd.set("post_id", postId);
              fd.set("path", path);
              action(fd);
              formRef.current?.reset();
            }}
            className="search w-full !py-2"
          >
            <input name="body" required placeholder="Reply directly…" />
            <button type="submit" disabled={pending} className="font-mono text-dim" aria-label="Send reply">
              ↵
            </button>
          </form>
        )}
      </div>

      {(state.error || reactError) && (
        <p role="alert" aria-live="polite" className="field__err mt-2">
          {state.error ?? reactError}
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
