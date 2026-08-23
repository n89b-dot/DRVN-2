"use client";

import { useRef, useState } from "react";

import { Media } from "@/components/ui";
import { youtubeId, type ActivityBlock } from "@/lib/activity-blocks";
import { deleteStagedIfUnconsumed, recordStagedUpload } from "@/lib/media-staging";
import { createClient } from "@/lib/supabase/client";

export type BlockDraft = { key: string } & ActivityBlock;

const BLOCK_MENU = [
  { type: "text" as const, label: "Text", hint: "A paragraph or heading" },
  { type: "images" as const, label: "Photos", hint: "Upload one or more images" },
  { type: "embed" as const, label: "YouTube embed", hint: "Paste a YouTube link" },
];

function newBlock(type: "text" | "images" | "embed"): BlockDraft {
  const key = crypto.randomUUID();
  if (type === "text") return { key, type, style: "normal", text: "" };
  if (type === "images") return { key, type, urls: [] };
  return { key, type, provider: "youtube", url: "", videoId: "" };
}

/**
 * The one block-insert affordance: a full-width "Add a block" row at the
 * end of the draft. New blocks always start at the bottom; the ↑↓ controls
 * place them. One way in — the per-seam inserts multiplied "add" costumes
 * on screen until no single one read as the way.
 */
function InsertBlock({ onInsert }: { onInsert: (type: "text" | "images" | "embed") => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative mt-1">
      <button type="button" onClick={() => setOpen((o) => !o)} className="btn btn--ghost w-full">
        + Add a block — text, photos or YouTube
      </button>
      {open && (
        <div className="tile absolute bottom-full left-1/2 z-20 mb-1.5 w-64 -translate-x-1/2 !p-1.5" style={{ boxShadow: "0 1px 0 var(--dimline)" }}>
          {BLOCK_MENU.map((option) => (
            <button
              key={option.type}
              type="button"
              onClick={() => {
                onInsert(option.type);
                setOpen(false);
              }}
              className="block w-full rounded-ctl px-3 py-2 text-left transition hover:bg-paper-deep"
            >
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className="block font-mono text-xs text-dim">{option.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const inputClass = "ctl max-w-none";

/**
 * The read.cv-style block editor — text/photos/YouTube blocks, reorderable,
 * serialized into a hidden `blocks` field. Shared between the create
 * composer and the rich edit path so a published multi-block post can have
 * its photos and text edited the same way it was written.
 */
export function ActivityBlockEditor({
  carId,
  userId,
  name = "blocks",
  initialBlocks,
}: {
  carId: string;
  userId: string;
  /** Hidden-input field name the serialized blocks are posted under. */
  name?: string;
  /** Existing blocks to seed the editor with, e.g. when editing a post. */
  initialBlocks?: ActivityBlock[];
}) {
  const [blocks, setBlocks] = useState<BlockDraft[]>(() =>
    initialBlocks && initialBlocks.length
      ? initialBlocks.map((b) => ({ key: crypto.randomUUID(), ...b }))
      : [newBlock("text")]
  );
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRefs = useRef(new Map<string, HTMLInputElement>());

  function patch(key: string, updater: (b: BlockDraft) => BlockDraft) {
    setBlocks((all) => all.map((b) => (b.key === key ? updater(b) : b)));
  }

  function move(key: string, delta: -1 | 1) {
    setBlocks((all) => {
      const index = all.findIndex((b) => b.key === key);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= all.length) return all;
      const next = [...all];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function insertAt(index: number, type: "text" | "images" | "embed") {
    setBlocks((all) => [...all.slice(0, index), newBlock(type), ...all.slice(index)]);
  }

  async function uploadImages(key: string, files: FileList | null) {
    if (!files?.length) return;
    setUploadError(null);
    setUploadingKey(key);
    const supabase = createClient();
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
          setUploadError(`${file.name} is over 10MB.`);
          continue;
        }
        const ext = file.name.split(".").pop() ?? "jpg";
        const path = `${userId}/${carId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage
          .from("activity-images")
          .upload(path, file, { contentType: file.type });
        if (error) {
          setUploadError(error.message);
          continue;
        }
        const { publicUrl } = supabase.storage.from("activity-images").getPublicUrl(path).data;
        // Ledger the upload for GC (0029) — fire-and-forget, never blocking.
        void recordStagedUpload("activity-images", path, publicUrl).catch(() => {});
        urls.push(publicUrl);
      }
      if (urls.length) {
        patch(key, (b) => (b.type === "images" ? { ...b, urls: [...b.urls, ...urls] } : b));
      }
    } finally {
      setUploadingKey(null);
    }
  }

  function serializedBlocks(): string {
    return JSON.stringify(
      blocks
        .map((draft) => {
          const { key, ...block } = draft;
          void key;
          return block;
        })
        .filter((b) =>
          b.type === "text" ? b.text.trim() : b.type === "images" ? b.urls.length : b.videoId
        )
    );
  }

  return (
    <div>
      <input type="hidden" name={name} value={serializedBlocks()} />

      {/* gap, not per-seam spacers — the seams are gone. */}
      <div className="flex flex-col gap-3">
        {blocks.map((block, index) => (
          <div key={block.key}>
            {/* The block's edge is always drawn — a writing area you have to
                hover to find isn't a writing area — and it sharpens on
                focus so the active block reads apart from its neighbours. */}
            <div className="group relative rounded-r border border-[color:var(--rule-mid)] p-3 transition focus-within:border-[color:var(--dimline)]">
              {/* Block controls — revealed on hover (and via focus-within
                  for keyboards, pointer-coarse for touch, which has no
                  hover), sized to be seen and hit: real 32px targets. */}
              <div className="absolute -top-4 right-3 z-10 hidden gap-0.5 rounded-chip bg-paper-deep px-1.5 py-0.5 font-mono text-base text-dim group-hover:flex group-focus-within:flex pointer-coarse:flex">
                <button type="button" onClick={() => move(block.key, -1)} className="flex min-h-8 min-w-8 items-center justify-center hover:text-ink" aria-label="Move up">↑</button>
                <button type="button" onClick={() => move(block.key, 1)} className="flex min-h-8 min-w-8 items-center justify-center hover:text-ink" aria-label="Move down">↓</button>
                <button
                  type="button"
                  onClick={() => setBlocks((all) => all.filter((b) => b.key !== block.key))}
                  className="flex min-h-8 min-w-8 items-center justify-center hover:text-live"
                  aria-label="Delete block"
                >
                  ✕
                </button>
              </div>

              {block.type === "text" && (
                <div>
                  <select
                    value={block.style}
                    onChange={(e) =>
                      patch(block.key, (b) =>
                        b.type === "text" ? { ...b, style: e.target.value as "normal" | "heading" } : b
                      )
                    }
                    className="ctl mb-2 w-auto !py-1 font-mono text-xs"
                  >
                    <option value="normal">Normal</option>
                    <option value="heading">Heading</option>
                  </select>
                  <textarea
                    value={block.text}
                    onChange={(e) =>
                      patch(block.key, (b) => (b.type === "text" ? { ...b, text: e.target.value } : b))
                    }
                    rows={block.style === "heading" ? 1 : 4}
                    placeholder={block.style === "heading" ? "Heading…" : "Write what happened — the work, the parts, the result…"}
                    className={`w-full resize-y bg-transparent outline-none placeholder:text-dim ${
                      block.style === "heading"
                        ? "text-lg font-[600]"
                        : "text-body leading-7"
                    }`}
                  />
                </div>
              )}

              {block.type === "images" && (
                <div>
                  {block.urls.length > 0 && (
                    <div className={`grid gap-3 ${block.urls.length > 1 ? "grid-cols-2" : ""}`}>
                      {block.urls.map((url, i) => (
                        <div key={i} className="relative">
                          <Media src={url} alt={`Photo ${i + 1}`} className="h-44 w-full rounded-ctl" role="feature" />
                          <button
                            type="button"
                            onClick={() => {
                              // Best-effort cleanup: the server only deletes a
                              // still-staged, unconsumed, unreferenced upload.
                              void deleteStagedIfUnconsumed(url).catch(() => {});
                              patch(block.key, (b) =>
                                b.type === "images" ? { ...b, urls: b.urls.filter((_, j) => j !== i) } : b
                              );
                            }}
                            className="thumb__x !static !h-auto !w-auto absolute right-2 top-2 pointer-coarse:min-h-10 pointer-coarse:min-w-10"
                            aria-label="Remove photo"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => fileRefs.current.get(block.key)?.click()}
                    disabled={uploadingKey === block.key}
                    className={`drop ${block.urls.length ? "mt-3" : ""} h-24 w-full !p-0`}
                  >
                    {uploadingKey === block.key ? "Uploading…" : "+ Add image"}
                  </button>
                  <input
                    ref={(el) => {
                      if (el) fileRefs.current.set(block.key, el);
                    }}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => uploadImages(block.key, e.target.files)}
                  />
                </div>
              )}

              {block.type === "embed" && (
                <div>
                  <input
                    value={block.url}
                    onChange={(e) => {
                      const url = e.target.value;
                      patch(block.key, (b) =>
                        b.type === "embed" ? { ...b, url, videoId: youtubeId(url) ?? "" } : b
                      );
                    }}
                    placeholder="Paste a YouTube link (watch, share, or Shorts URL)"
                    className={inputClass}
                  />
                  {block.url && !block.videoId && (
                    <p role="alert" aria-live="polite" className="field__err mt-2">That doesn&apos;t look like a YouTube link.</p>
                  )}
                  {block.videoId && (
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${block.videoId}`}
                      title="YouTube preview"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="mt-3 aspect-video w-full rounded-r"
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <InsertBlock onInsert={(type) => insertAt(blocks.length, type)} />
      </div>

      {uploadError && (
        <p role="alert" aria-live="polite" className="field__err mt-3">{uploadError}</p>
      )}
    </div>
  );
}
