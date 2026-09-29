"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { Button } from "./button";
import { Icon } from "./icons";

/**
 * The conversation composer (`.chatbox`): an auto-growing field, an optional
 * photo button and one Send, pinned to the bottom of the viewport. On a
 * keyboard-and-mouse device Enter sends and Shift+Enter adds a line; on touch
 * Return always adds a line and Send sends — the way every phone messenger
 * behaves.
 *
 * Visual + keyboard contract only. The owning feature holds the draft,
 * uploads, the send action and its result.
 */
export function ChatComposer({
  value,
  onValueChange,
  onSend,
  canSend,
  pending = false,
  placeholder,
  inputLabel,
  maxLength = 4000,
  onFiles,
  attachLabel = "Add photos",
  attachDisabled = false,
  above,
  below,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSend: () => void;
  /** Whether there is anything to send (text or photos). */
  canSend: boolean;
  pending?: boolean;
  placeholder: string;
  inputLabel: string;
  maxLength?: number;
  /** When set, a photo button opens an image picker and hands over the files. */
  onFiles?: (files: File[]) => void;
  attachLabel?: string;
  attachDisabled?: boolean;
  /** Above the field — what the message is about, photos waiting to send. */
  above?: ReactNode;
  /** Under the field — the send result. */
  below?: ReactNode;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();

  // Grow with the text up to the CSS max-height, then scroll inside.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  function submitsOnEnter() {
    return typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
  }

  return (
    <form
      className="chatbox"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend && !pending) onSend();
      }}
    >
      {above}
      <div className="chatbox__row">
        {onFiles && (
          <label className="chatbox__attach" title={attachLabel}>
            <span className="sr-only">{attachLabel}</span>
            <Icon name="image" />
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={attachDisabled || pending}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (files.length) onFiles(files);
              }}
            />
          </label>
        )}
        <label htmlFor={inputId} className="sr-only">
          {inputLabel}
        </label>
        <textarea
          id={inputId}
          ref={field}
          rows={1}
          className="chatbox__input"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={pending}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            if (!submitsOnEnter()) return;
            event.preventDefault();
            if (canSend && !pending) onSend();
          }}
        />
        <Button type="submit" variant={canSend ? "live" : "ghost"} disabled={!canSend} loading={pending} pendingLabel="Sending…">
          Send
        </Button>
      </div>
      {below}
    </form>
  );
}
