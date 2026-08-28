"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { BeforeAfter, Media } from "@/components/ui";
import { MOD_ACTIONS, PERFORMANCE_KINDS, youtubeId } from "@/lib/activity-blocks";
import { useUploadQueue } from "@/lib/use-upload-queue";
import { cx } from "@/lib/format";

import type { ComposerContext } from "./extensions";

/**
 * React node views for the composer's block set. Every block sits in the
 * same BlockShell chrome: a mono grip (native ProseMirror drag), ↑/↓ moves
 * and ✕ — visible on hover/focus, always visible on coarse pointers. The
 * display side reuses the public renderer's idioms so authoring looks like
 * the published result.
 */

function BlockShell({
  props,
  label,
  children,
}: {
  props: NodeViewProps;
  label: string;
  children: ReactNode;
}) {
  const { editor, getPos, node } = props;

  const move = (direction: -1 | 1) => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const { doc } = editor.state;
    const resolved = doc.resolve(pos);
    const index = resolved.index(0);
    const target = index + direction;
    if (target < 0 || target >= doc.childCount) return;
    // Compute the insertion position after removing this node.
    const chain = editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize });
    let insertAt = 0;
    for (let i = 0, seen = 0; i < doc.childCount; i += 1) {
      if (i === index) continue; // skip self — it's being removed
      if (seen === target) break;
      insertAt += doc.child(i).nodeSize;
      seen += 1;
    }
    chain.insertContentAt(insertAt, node.toJSON()).run();
  };

  const remove = () => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  };

  return (
    <NodeViewWrapper className="cblock" data-drag-handle={undefined}>
      <div className="cblock__rail" contentEditable={false}>
        <span
          className="cblock__grip"
          data-drag-handle
          title={`Drag to move this ${label}`}
          aria-hidden="true"
        >
          ⋮⋮
        </span>
        <button type="button" className="cblock__tool" aria-label={`Move ${label} up`} onClick={() => move(-1)}>
          ↑
        </button>
        <button type="button" className="cblock__tool" aria-label={`Move ${label} down`} onClick={() => move(1)}>
          ↓
        </button>
        <button type="button" className="cblock__tool cblock__tool--x" aria-label={`Remove ${label}`} onClick={remove}>
          ✕
        </button>
      </div>
      <div className="cblock__body" contentEditable={false}>
        {children}
      </div>
    </NodeViewWrapper>
  );
}

function ctx(props: NodeViewProps): ComposerContext {
  return props.extension.options as ComposerContext;
}

/* ---------------- gallery ---------------- */

export function GalleryView(props: NodeViewProps) {
  const { carId, userId } = ctx(props);
  const urls: string[] = props.node.attrs.urls ?? [];
  const inputRef = useRef<HTMLInputElement>(null);
  const setUrls = (next: string[]) => props.updateAttributes({ urls: next });

  const queue = useUploadQueue({
    bucket: "activity-images",
    pathPrefix: `${userId}/${carId}`,
    onUploaded: ({ url }) => {
      const current: string[] = props.node.attrs.urls ?? [];
      props.updateAttributes({ urls: [...current, url] });
    },
  });
  const pending = queue.items.filter((item) => item.status !== "done");

  const moveImage = (index: number, direction: -1 | 1) => {
    const next = [...urls];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setUrls(next);
  };

  return (
    <BlockShell props={props} label="photo gallery">
      <div className={`grid gap-3 ${urls.length + pending.length > 1 ? "grid-cols-2" : ""}`}>
        {urls.map((url, index) => (
          <figure key={url} className="cgal__item">
            <Media src={url} alt={`Photo ${index + 1}`} className="h-40 w-full rounded-ctl" role="feature" />
            <span className="cgal__tools">
              <button type="button" className="cblock__tool" aria-label="Move photo earlier" onClick={() => moveImage(index, -1)}>
                ←
              </button>
              <button type="button" className="cblock__tool" aria-label="Move photo later" onClick={() => moveImage(index, 1)}>
                →
              </button>
              <button
                type="button"
                className="cblock__tool cblock__tool--x"
                aria-label="Remove photo"
                onClick={() => setUrls(urls.filter((u) => u !== url))}
              >
                ✕
              </button>
            </span>
          </figure>
        ))}
        {pending.map((item) => (
          <figure key={item.id} className={cx("cgal__item", "cgal__item--pending")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.previewUrl} alt="" className="h-40 w-full rounded-ctl object-cover" />
            <span className={cx("cgal__state", item.status === "failed" && "cgal__state--failed")}>
              {item.status === "failed" ? (
                <>
                  <span>{item.error}</span>
                  <span className="flex gap-2">
                    {item.retryable && (
                      <button type="button" className="jumplink" onClick={() => queue.retry(item.id)}>
                        Retry
                      </button>
                    )}
                    <button type="button" className="jumplink" onClick={() => queue.remove(item.id)}>
                      Remove
                    </button>
                  </span>
                </>
              ) : (
                "Uploading…"
              )}
            </span>
          </figure>
        ))}
      </div>
      <button type="button" className="drop mt-3" onClick={() => inputRef.current?.click()}>
        + Add photos
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) queue.addFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </BlockShell>
  );
}

/* ---------------- youtube ---------------- */

export function YoutubeView(props: NodeViewProps) {
  const url: string = props.node.attrs.url ?? "";
  const videoId: string | null = props.node.attrs.videoId || youtubeId(url);
  return (
    <BlockShell props={props} label="video">
      <input
        className="ctl max-w-none"
        placeholder="Paste a YouTube link…"
        value={url}
        onChange={(event) =>
          props.updateAttributes({
            url: event.target.value,
            videoId: youtubeId(event.target.value) ?? "",
          })
        }
      />
      {url && !videoId && (
        <p className="field__err !flex mt-2">That doesn&rsquo;t look like a YouTube link.</p>
      )}
      {videoId && (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}`}
          title="Video preview"
          className="mt-3 aspect-video w-full rounded-ctl"
          allowFullScreen
        />
      )}
    </BlockShell>
  );
}

/* ---------------- mod change ---------------- */

export function ModChangeView(props: NodeViewProps) {
  const { mods } = ctx(props);
  const { action, modItemId, label, detail } = props.node.attrs as {
    action: string;
    modItemId: string | null;
    label: string;
    detail: string | null;
  };

  return (
    <BlockShell props={props} label="modification">
      <div className="flex flex-wrap items-end gap-2">
        <label className="field !mb-0 w-36">
          <span className="microlabel">Change</span>
          <select
            className="ctl max-w-none"
            value={action}
            onChange={(event) => props.updateAttributes({ action: event.target.value })}
          >
            {MOD_ACTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field !mb-0 min-w-0 flex-1 basis-[220px]">
          <span className="microlabel">Part</span>
          {mods.length > 0 ? (
            <select
              className="ctl max-w-none"
              value={modItemId ?? ""}
              onChange={(event) => {
                const mod = mods.find((m) => m.id === event.target.value);
                props.updateAttributes({
                  modItemId: mod?.id ?? null,
                  label: mod?.label ?? label,
                });
              }}
            >
              <option value="">Type it below…</option>
              {mods.map((mod) => (
                <option key={mod.id} value={mod.id}>
                  {mod.label}
                </option>
              ))}
            </select>
          ) : null}
          {(mods.length === 0 || !modItemId) && (
            <input
              className={cx("ctl max-w-none", mods.length > 0 && "mt-2")}
              placeholder="e.g. KW V3 Coilovers"
              value={modItemId ? "" : label}
              onChange={(event) => props.updateAttributes({ label: event.target.value, modItemId: null })}
            />
          )}
        </label>
        <label className="field !mb-0 min-w-0 flex-1 basis-[180px]">
          <span className="microlabel">Note — optional</span>
          <input
            className="ctl max-w-none"
            placeholder="replacing the H&R springs"
            value={detail ?? ""}
            onChange={(event) => props.updateAttributes({ detail: event.target.value || null })}
          />
        </label>
      </div>
      {action === "removed" && modItemId && (
        // The Build → Marketplace bridge (brief §I): everything DRVN knows
        // about this part prefills the listing. Quiet link, never a prompt.
        <a
          className="jumplink mt-2 inline-block"
          href={`/sell?car=${ctx(props).carId}&mod=${modItemId}`}
          target="_blank"
          rel="noreferrer"
        >
          Sell this part →
        </a>
      )}
    </BlockShell>
  );
}

/* ---------------- before / after ---------------- */

function BaSlot({
  label,
  url,
  carId,
  userId,
  onUrl,
}: {
  label: string;
  url: string;
  carId: string;
  userId: string;
  onUrl: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const queue = useUploadQueue({
    bucket: "activity-images",
    pathPrefix: `${userId}/${carId}`,
    onUploaded: ({ url: uploaded }) => onUrl(uploaded),
  });
  const pending = queue.items.find((item) => item.status === "uploading" || item.status === "queued");
  const failed = queue.items.find((item) => item.status === "failed");
  return (
    <div className="min-w-0 flex-1">
      <span className="microlabel">{label}</span>
      {url ? (
        <div className="relative">
          <Media src={url} alt={label} className="h-36 w-full rounded-ctl" role="feature" />
          <button
            type="button"
            className="cblock__tool cblock__tool--x absolute right-2 top-2"
            aria-label={`Replace ${label} photo`}
            onClick={() => onUrl("")}
          >
            ✕
          </button>
        </div>
      ) : (
        <button type="button" className="drop w-full" onClick={() => inputRef.current?.click()}>
          {pending ? "Uploading…" : `+ ${label} photo`}
        </button>
      )}
      {failed && (
        <p className="field__err !flex mt-1">
          {failed.error}{" "}
          {failed.retryable && (
            <button type="button" className="jumplink" onClick={() => queue.retry(failed.id)}>
              Retry
            </button>
          )}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          if (event.target.files?.[0]) queue.addFiles([event.target.files[0]]);
          event.target.value = "";
        }}
      />
    </div>
  );
}

export function BeforeAfterView(props: NodeViewProps) {
  const { carId, userId } = ctx(props);
  const { beforeUrl, afterUrl, beforeLabel, afterLabel } = props.node.attrs as {
    beforeUrl: string;
    afterUrl: string;
    beforeLabel: string | null;
    afterLabel: string | null;
  };
  const ready = beforeUrl && afterUrl;

  return (
    <BlockShell props={props} label="before/after">
      {ready ? (
        <BeforeAfter
          beforeUrl={beforeUrl}
          afterUrl={afterUrl}
          beforeLabel={beforeLabel ?? undefined}
          afterLabel={afterLabel ?? undefined}
        />
      ) : (
        <div className="flex flex-wrap gap-3">
          <BaSlot
            label="Before"
            url={beforeUrl}
            carId={carId}
            userId={userId}
            onUrl={(url) => props.updateAttributes({ beforeUrl: url })}
          />
          <BaSlot
            label="After"
            url={afterUrl}
            carId={carId}
            userId={userId}
            onUrl={(url) => props.updateAttributes({ afterUrl: url })}
          />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          className="ctl min-w-0 flex-1"
          placeholder="Before label — optional"
          value={beforeLabel ?? ""}
          onChange={(event) => props.updateAttributes({ beforeLabel: event.target.value || null })}
        />
        <input
          className="ctl min-w-0 flex-1"
          placeholder="After label — optional"
          value={afterLabel ?? ""}
          onChange={(event) => props.updateAttributes({ afterLabel: event.target.value || null })}
        />
        {ready && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => props.updateAttributes({ beforeUrl: "", afterUrl: "" })}
          >
            Change photos
          </button>
        )}
      </div>
    </BlockShell>
  );
}

/* ---------------- performance result ---------------- */

export function PerformanceView(props: NodeViewProps) {
  const { kind, entries, note } = props.node.attrs as {
    kind: string;
    entries: { label: string; value: string }[];
    note: string | null;
  };
  const setEntries = (next: { label: string; value: string }[]) =>
    props.updateAttributes({ entries: next });

  return (
    <BlockShell props={props} label="performance result">
      <div className="flex flex-wrap items-end gap-2">
        <label className="field !mb-0 w-40">
          <span className="microlabel">Result type</span>
          <select
            className="ctl max-w-none"
            value={kind}
            onChange={(event) => props.updateAttributes({ kind: event.target.value })}
          >
            {PERFORMANCE_KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <span className="microlabel !mb-2 text-dim">Owner-reported</span>
      </div>
      <div className="mt-2 grid gap-2">
        {entries.map((entry, index) => (
          <div key={index} className="flex gap-2">
            <input
              className="ctl w-36"
              placeholder="Power"
              aria-label={`Result ${index + 1} label`}
              value={entry.label}
              onChange={(event) =>
                setEntries(entries.map((e, i) => (i === index ? { ...e, label: event.target.value } : e)))
              }
            />
            <input
              className="ctl min-w-0 flex-1"
              placeholder="412 whp"
              aria-label={`Result ${index + 1} value`}
              value={entry.value}
              onChange={(event) =>
                setEntries(entries.map((e, i) => (i === index ? { ...e, value: event.target.value } : e)))
              }
            />
            <button
              type="button"
              className="cblock__tool cblock__tool--x self-center"
              aria-label={`Remove result ${index + 1}`}
              onClick={() => setEntries(entries.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
        ))}
        {entries.length < 8 && (
          <button
            type="button"
            className="btn btn--ghost self-start"
            onClick={() => setEntries([...entries, { label: "", value: "" }])}
          >
            + Add a number
          </button>
        )}
      </div>
      <input
        className="ctl mt-2 max-w-none"
        placeholder="Context — optional (93 octane, Dynojet, Sebring…)"
        value={note ?? ""}
        onChange={(event) => props.updateAttributes({ note: event.target.value || null })}
      />
    </BlockShell>
  );
}

/* ---------------- mileage milestone ---------------- */

export function MileageView(props: NodeViewProps) {
  const { value, unit } = props.node.attrs as { value: number; unit: "mi" | "km" };
  const [raw, setRaw] = useState(value > 0 ? String(value) : "");
  return (
    <BlockShell props={props} label="mileage milestone">
      <div className="flex items-end gap-2">
        <label className="field !mb-0 w-44">
          <span className="microlabel">On the clock</span>
          <input
            className="ctl max-w-none"
            inputMode="numeric"
            placeholder="41,842"
            value={raw}
            onChange={(event) => {
              setRaw(event.target.value);
              const parsed = Number(event.target.value.replace(/[^0-9]/g, ""));
              props.updateAttributes({ value: Number.isFinite(parsed) ? parsed : 0 });
            }}
          />
        </label>
        <label className="field !mb-0 w-24">
          <span className="microlabel">Unit</span>
          <select
            className="ctl max-w-none"
            value={unit}
            onChange={(event) => props.updateAttributes({ unit: event.target.value })}
          >
            <option value="mi">mi</option>
            <option value="km">km</option>
          </select>
        </label>
      </div>
    </BlockShell>
  );
}
