import type { ReactNode, Ref } from "react";

import { cx } from "@/lib/format";

/**
 * The Livesheet conversation grammar (`.thread` / `.msg` / `.composer`) as
 * contracts. Four features previously re-typed this markup independently
 * (order messages ×2, offer thread, listing Q&A) and a fifth (activity
 * comments) drifted off it entirely.
 *
 * Feature logic — pagination, day grouping, send actions, permissions,
 * optimistic state — stays with the feature. These components only own the
 * visual and accessibility grammar.
 */

/** Conversation container — ruled message column. */
export function MessageThread({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("thread", className)}>{children}</div>;
}

/** Centered mono divider inside a thread — day buckets, section breaks. */
export function ThreadDivider({ children }: { children: ReactNode }) {
  return (
    <div className="my-2 flex justify-center">
      <span className="microlabel">{children}</span>
    </div>
  );
}

/**
 * One message. `me` right-aligns and tones the row (`.msg--me`) — features
 * decide what "me" means (the current user, or the seller in Q&A).
 */
export function Message({
  me = false,
  who,
  whoEnd,
  when,
  whenLabel,
  body,
  meta,
  className,
  children,
}: {
  me?: boolean;
  /** Sender line ("You", a display name). */
  who: ReactNode;
  /** Trailing slot inside the sender line — a "Seller" chip. */
  whoEnd?: ReactNode;
  /** ISO timestamp — rendered as a `<time>` beside the sender. */
  when?: string;
  /** Visible time text; required when `when` is passed. */
  whenLabel?: ReactNode;
  body: ReactNode;
  /** Dim footer line (`.msg__meta`) — "Posting…", a full timestamp. */
  meta?: ReactNode;
  className?: string;
  /** Extra rows inside the message block — reply controls, attachments. */
  children?: ReactNode;
}) {
  return (
    <div className={cx("msg", me && "msg--me", className)}>
      <span className="msg__who">
        {who}
        {whoEnd}
        {when && (
          <time dateTime={when} className="ml-2 text-dim">
            {whenLabel}
          </time>
        )}
      </span>
      <p className="msg__body">{body}</p>
      {meta !== undefined && meta !== null && <span className="msg__meta">{meta}</span>}
      {children}
    </div>
  );
}

/**
 * The send row (`.composer__row`) — hidden fields, one `.ctl` input, submit.
 * The owning feature supplies the action and pending state (`useActionState`
 * lives with the feature, not here).
 */
export function MessageComposer({
  action,
  formRef,
  hidden,
  name = "body",
  placeholder,
  inputLabel,
  maxLength,
  autoFocus = false,
  pending = false,
  sendLabel = "Send",
  pendingLabel = "Sending…",
  ghost = true,
  block = false,
  className,
  inputClassName,
  after,
}: {
  action: (formData: FormData) => void;
  formRef?: Ref<HTMLFormElement>;
  /** Hidden inputs (ids the action needs). */
  hidden?: Record<string, string>;
  name?: string;
  placeholder: string;
  /** aria-label for the input when no visible label exists nearby. */
  inputLabel?: string;
  maxLength?: number;
  autoFocus?: boolean;
  pending?: boolean;
  sendLabel?: ReactNode;
  pendingLabel?: ReactNode;
  /** Ghost submit (the thread convention); false = contained `.btn`. */
  ghost?: boolean;
  /** Wraps the row in the block `.composer` plate (the Q&A ask box). */
  block?: boolean;
  className?: string;
  inputClassName?: string;
  /** Extra controls after the submit — a Cancel jumplink. */
  after?: ReactNode;
}) {
  const row = (
    <>
      {hidden &&
        Object.entries(hidden).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
      <input
        name={name}
        required
        maxLength={maxLength}
        autoFocus={autoFocus}
        aria-label={inputLabel}
        placeholder={placeholder}
        className={cx("ctl max-w-none flex-1", inputClassName)}
      />
      <button type="submit" disabled={pending} className={ghost ? "btn btn--ghost" : "btn"}>
        {pending ? pendingLabel : sendLabel}
      </button>
      {after}
    </>
  );

  if (block) {
    return (
      <form ref={formRef} action={action} className={cx("composer", className)}>
        <div className="composer__row">{row}</div>
      </form>
    );
  }
  return (
    <form ref={formRef} action={action} className={cx("composer__row", className)}>
      {row}
    </form>
  );
}
