"use client";

import { useRef, useState } from "react";

import { Media } from "@/components/ui";
import { youtubeId, type ActivityBlock } from "@/lib/activity-blocks";
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

/** Hover/click affordance between blocks (read.cv "Insert block"). */
function InsertBlock({ onInsert }: { onInsert: (type: "text" | "images" | "embed") => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative py-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`relbtn mx-auto block ${open ? "!text-ink" : "opacity-40 hover:opacity-100"}`}
      >
        + Insert block
      </button>
      {open && (
        <div className="tile absolute left-1/2 z-20 mt-1.5 w-64 -translate-x-1/2 !p-1.5" style={{ boxShadow: "0 1px 0 var(--dimline)" }}>
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
        urls.push(supabase.storage.from("activity-images").getPublicUrl(path).data.publicUrl);
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

      <div>
        {blocks.map((block, index) => (
          <div key={block.key}>
            <InsertBlock onInsert={(type) => insertAt(index, type)} />
            <div className="group relative rounded-r border border-transparent p-2 transition hover:border-[color:var(--rule-mid)] focus-within:border-[color:var(--rule-mid)]">
              {/* Block controls — hover-only left keyboard and touch users
                  unable to move or delete a block at all. focus-within keeps
                  them reachable via Tab; pointer-coarse keeps them visible on
                  touch devices, which have no hover state. */}
              <div className="absolute -top-3 right-3 z-10 hidden gap-1 rounded-chip bg-paper-deep px-1.5 py-0.5 font-mono text-xs text-dim group-hover:flex group-focus-within:flex pointer-coarse:flex">
                <button type="button" onClick={() => move(block.key, -1)} className="px-1 hover:text-ink" aria-label="Move up">↑</button>
                <button type="button" onClick={() => move(block.key, 1)} className="px-1 hover:text-ink" aria-label="Move down">↓</button>
                <button
                  type="button"
                  onClick={() => setBlocks((all) => all.filter((b) => b.key !== block.key))}
                  className="px-1 hover:text-live"
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
                    placeholder={block.style === "heading" ? "Heading…" : "Write something…"}
                    className={`w-full resize-y bg-transparent outline-none placeholder:text-dim/50 ${
                      block.style === "heading"
                        ? "text-lg font-[600]"
                        : "text-[15px] leading-7"
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
                          <Media src={url} alt={`Photo ${i + 1}`} className="h-44 w-full rounded-ctl" />
                          <button
                            type="button"
                            onClick={() =>
                              patch(block.key, (b) =>
                                b.type === "images" ? { ...b, urls: b.urls.filter((_, j) => j !== i) } : b
                              )
                            }
                            className="thumb__x !static !h-auto !w-auto absolute right-2 top-2"
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
