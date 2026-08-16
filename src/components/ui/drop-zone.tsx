"use client";

import { useRef, useState } from "react";

import { cx } from "@/lib/format";

/**
 * The documented `.drop` pattern with its behavior attached: click or
 * Enter/Space opens the file picker, dragging files over it highlights, a
 * drop hands the files to the caller. Keeps the drag highlight steady while
 * the pointer crosses the zone's own children (dragleave fires on every
 * child crossing — the relatedTarget guard is the fix), and exposes a real
 * busy state to assistive tech instead of silently ignoring activation.
 */
export function DropZone({
  onFiles,
  busy,
  accept = "image/*",
  multiple = true,
  title,
  busyTitle = "Uploading…",
  body,
  className,
}: {
  onFiles: (files: FileList) => void;
  /** Upload in flight — activation and drops are refused, and announced as such. */
  busy?: boolean;
  accept?: string;
  multiple?: boolean;
  title: string;
  busyTitle?: string;
  body: string;
  className?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          // Same file re-selected later must fire onChange again.
          e.target.value = "";
        }}
      />
      <div
        role="button"
        tabIndex={0}
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        aria-label={`${title} — click to choose files, or drag them here`}
        onClick={() => !busy && fileRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !busy) {
            e.preventDefault();
            fileRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!busy && e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
        }}
        className={cx("drop", dragOver && "is-over", busy && "opacity-55 cursor-progress", className)}
      >
        <span className="drop__mark" aria-hidden="true">
          {busy ? "…" : "+"}
        </span>
        <h4>{busy ? busyTitle : title}</h4>
        <p>{body}</p>
      </div>
    </>
  );
}
