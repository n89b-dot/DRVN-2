import type { ChangeEventHandler, ReactNode, Ref } from "react";

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
  value,
  onChange,
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
  value?: string;
  onChange?: ChangeEventHandler<HTMLInputElement>;
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
        value={value}
        onChange={onChange}
        disabled={pending}
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

/* ------------------------------------------------------------------------
 * Person-first conversation grammar (20260928). A conversation is one
 * person; these render a run of that person's (or your) consecutive
 * messages, one message block, and a lifecycle event. Visual only — the
 * feature groups messages into runs and decides what an event says.
 * --------------------------------------------------------------------- */

/**
 * Consecutive messages from one side under a single meta line. `me` aligns
 * the run right and inks its bubbles.
 */
export function MessageRun({
  me = false,
  who,
  when,
  whenLabel,
  about,
  foot,
  children,
}: {
  me?: boolean;
  /** Sender name ("You", "Kaito"). */
  who: ReactNode;
  /** ISO timestamp of the run's first message. */
  when?: string;
  whenLabel?: ReactNode;
  /** What the run is about — a short part name, rendered as a tag. */
  about?: ReactNode;
  /** Under the run — "Seen", "Sending…". */
  foot?: ReactNode;
  /** MessageBubble children. */
  children: ReactNode;
}) {
  return (
    <div className={cx("msgrun", me && "msgrun--me")}>
      <span className="msgrun__meta">
        <span className="msgrun__who">{who}</span>
        {when && (
          <time dateTime={when} suppressHydrationWarning>
            {whenLabel}
          </time>
        )}
        {about && <span className="msgrun__about">{about}</span>}
      </span>
      {children}
      {foot !== undefined && foot !== null && <span className="msgrun__foot">{foot}</span>}
    </div>
  );
}

/** One message block inside a MessageRun — text, photos, or both. */
export function MessageBubble({
  children,
  photos,
  photoAlt = "Photo",
}: {
  children?: ReactNode;
  /** Already-resolved (signed) image URLs; each opens full size. */
  photos?: string[];
  photoAlt?: string;
}) {
  const hasPhotos = Boolean(photos && photos.length);
  return (
    <div className={cx("bubble", hasPhotos && "bubble--photos")}>
      {hasPhotos && (
        <div className="bubble__photos">
          {photos!.map((src, i) => (
            <a key={src} href={src} target="_blank" rel="noreferrer" className="bubble__photo">
              {/* Signed private-bucket URLs expire; next/image would cache
                  them past their lifetime, so these stay plain <img>. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`${photoAlt} ${i + 1}`} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {children !== undefined && children !== null && children !== "" &&
        (hasPhotos ? <span className="bubble__text">{children}</span> : children)}
    </div>
  );
}

/**
 * A lifecycle fact inside a conversation — "Kaito shipped the wheels",
 * "You offered $5,900". Centred and dashed so it can never be mistaken for
 * something a person typed. `live` marks one that asks for your move.
 */
export function ThreadEvent({
  live = false,
  when,
  children,
}: {
  live?: boolean;
  when?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("tevent", live && "tevent--live")} role="note">
      {children}
      {when && <time dateTime={when} className="sr-only">{when}</time>}
    </div>
  );
}
