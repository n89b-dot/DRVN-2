"use client";

import { useActionState, useRef, useState } from "react";

import { Media } from "@/components/ui";
import { youtubeId, type ActivityBlock } from "@/lib/activity-blocks";
import { createClient } from "@/lib/supabase/client";

import { createRichActivityPost, type ActionState } from "../../../actions";

type BlockDraft = { key: string } & ActivityBlock;

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
        className={`mx-auto block rounded-pill border border-border px-3 py-1 text-xs transition ${
          open ? "text-text-primary" : "text-text-muted opacity-40 hover:opacity-100"
        }`}
      >
        + Insert block
      </button>
      {open && (
        <div className="absolute left-1/2 z-20 mt-1.5 w-64 -translate-x-1/2 rounded-2xl border border-border bg-raised p-1.5 shadow-xl">
          {BLOCK_MENU.map((option) => (
            <button
              key={option.type}
              type="button"
              onClick={() => {
                onInsert(option.type);
                setOpen(false);
              }}
              className="block w-full rounded-xl px-3 py-2 text-left transition hover:bg-white/5"
            >
              <span className="block text-sm text-text-primary">{option.label}</span>
              <span className="block text-xs text-text-muted">{option.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-input border border-border bg-app px-3 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent";

export function UpdateComposer({ carId, userId }: { carId: string; userId: string }) {
  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState<BlockDraft[]>([{ ...newBlock("text") }]);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRefs = useRef(new Map<string, HTMLInputElement>());
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createRichActivityPost,
    {}
  );

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
    <form action={action} className="mt-4">
      <input type="hidden" name="car_id" value={carId} />
      <input type="hidden" name="blocks" value={serializedBlocks()} />

      <input
        name="title"
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title your update"
        className="w-full bg-transparent text-2xl font-bold text-text-primary outline-none placeholder:text-text-muted/50"
      />

      <div className="mt-6">
        {blocks.map((block, index) => (
          <div key={block.key}>
            <InsertBlock onInsert={(type) => insertAt(index, type)} />
            <div className="group relative rounded-2xl border border-transparent p-2 transition hover:border-border">
              {/* Block controls */}
              <div className="absolute -top-3 right-3 z-10 hidden gap-1 rounded-pill border border-border bg-raised px-1.5 py-0.5 text-xs text-text-muted group-hover:flex">
                <button type="button" onClick={() => move(block.key, -1)} className="px-1 hover:text-text-primary" aria-label="Move up">↑</button>
                <button type="button" onClick={() => move(block.key, 1)} className="px-1 hover:text-text-primary" aria-label="Move down">↓</button>
                <button
                  type="button"
                  onClick={() => setBlocks((all) => all.filter((b) => b.key !== block.key))}
                  className="px-1 hover:text-red-400"
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
                    className="mb-2 rounded-input border border-border bg-app px-2 py-1 text-xs text-text-secondary outline-none"
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
                    className={`w-full resize-y bg-transparent outline-none placeholder:text-text-muted/50 ${
                      block.style === "heading"
                        ? "text-lg font-semibold text-text-primary"
                        : "text-sm leading-7 text-text-secondary"
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
                          <Media src={url} alt={`Photo ${i + 1}`} className="h-44 w-full rounded-2xl border border-white/10" />
                          <button
                            type="button"
                            onClick={() =>
                              patch(block.key, (b) =>
                                b.type === "images" ? { ...b, urls: b.urls.filter((_, j) => j !== i) } : b
                              )
                            }
                            className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs text-white"
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
                    className={`${block.urls.length ? "mt-3" : ""} grid h-24 w-full place-items-center rounded-2xl border border-dashed border-border text-sm text-text-muted transition hover:text-text-secondary`}
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
                    <p className="mt-2 text-xs text-red-400">That doesn&apos;t look like a YouTube link.</p>
                  )}
                  {block.videoId && (
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${block.videoId}`}
                      title="YouTube preview"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="mt-3 aspect-video w-full rounded-2xl border border-white/10"
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <InsertBlock onInsert={(type) => insertAt(blocks.length, type)} />
      </div>

      {(state.error || uploadError) && (
        <p className="mt-3 text-sm text-red-400">{state.error ?? uploadError}</p>
      )}

      <div className="mt-8 flex items-center justify-end gap-3 border-t border-border pt-5">
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="rounded-pill bg-accent px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:opacity-50"
        >
          {pending ? "Publishing…" : "Publish update"}
        </button>
      </div>
    </form>
  );
}
