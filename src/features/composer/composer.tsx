"use client";

import { Extension, type Editor } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { EditorContent, useEditor } from "@tiptap/react";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { cx } from "@/lib/format";
import { ACTIVITY_TITLE_MAX } from "@/lib/limits";
import { blockMediaUrls, normalizeBlocks, type ActivityBlock } from "@/lib/activity-blocks";

import { blocksToDoc, docToBlocks, type PmDoc } from "./doc";
import { composerNodes, type ComposerContext } from "./extensions";
import { INSERT_ITEMS, type InsertItem } from "./inserts";
import { composerRecoveryKey } from "./recovery";

/**
 * The Build Story Composer (brief §M–§R): one progressively enhanced editor
 * for build updates. The blank state is an immediate writing surface — place
 * the cursor, type, publish. Everything else appears on demand: optional
 * starter chips on the empty page, a `/` menu at the caret, a `+` menu in the
 * footer, drag/↑↓ reordering on rich blocks, quiet autosave (create mode),
 * explicit publish. Editor state is Tiptap; the stored format is DRVN's
 * activity document (doc.ts is the only seam).
 */

const TEMPLATES: { key: string; label: string; explain: string; blocks: ActivityBlock[] }[] = [
  {
    key: "installed",
    label: "Installed something",
    explain: "Adds a modification block, a photo set and a story paragraph",
    blocks: [
      { type: "mod", action: "installed", modItemId: null, label: "" },
      { type: "images", urls: [] },
      { type: "text", style: "normal", text: "" },
    ],
  },
  {
    key: "removed",
    label: "Removed something",
    explain: "Adds a removal block and a story paragraph",
    blocks: [
      { type: "mod", action: "removed", modItemId: null, label: "" },
      { type: "text", style: "normal", text: "" },
    ],
  },
  {
    key: "photos",
    label: "Photos",
    explain: "Adds a photo set",
    blocks: [{ type: "images", urls: [] }, { type: "text", style: "normal", text: "" }],
  },
  {
    key: "result",
    label: "Dyno / result",
    explain: "Adds an owner-reported performance result",
    blocks: [
      { type: "performance", kind: "dyno", entries: [{ label: "Power", value: "" }] },
      { type: "text", style: "normal", text: "" },
    ],
  },
  {
    key: "issue",
    label: "Issue / fix",
    explain: "Adds a heading, story paragraph and photo set",
    blocks: [
      { type: "text", style: "heading", text: "The problem" },
      { type: "text", style: "normal", text: "" },
      { type: "text", style: "heading", text: "The fix" },
      { type: "text", style: "normal", text: "" },
      { type: "images", urls: [] },
    ],
  },
];

export type ActionState = { error?: string; ok?: string; href?: string };
export type ComposerServerAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

type SlashState = {
  items: InsertItem[];
  clientRect: DOMRect | null;
  command: (item: InsertItem) => void;
  selected: number;
} | null;

export function BuildStoryComposer({
  carId,
  userId,
  mods,
  postId,
  initialTitle = "",
  initialBlocks = [],
  initialOperationId,
  draftSavedAt = null,
  publishAction,
  draftAction,
  extraHidden,
}: ComposerContext & {
  carId: string;
  userId: string;
  /** Present when editing a published post — autosave off, Save explicit. */
  postId?: string;
  initialTitle?: string;
  initialBlocks?: ActivityBlock[];
  /** Stable UUID reused by draft saves and publish retries. */
  initialOperationId?: string;
  draftSavedAt?: string | null;
  /** The route's server action for publish (create) or save (edit). */
  publishAction: ComposerServerAction;
  /** The route's draft server action — create mode only (autosave uses it too). */
  draftAction?: ComposerServerAction;
  /** Extra hidden fields the publish action expects preserved (legacy intro/video). */
  extraHidden?: Record<string, string>;
}) {
  const isEdit = Boolean(postId);
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [blocksJson, setBlocksJson] = useState(() => JSON.stringify(initialBlocks));
  const [operationId, setOperationId] = useState(initialOperationId ?? postId ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error" | "recovered">(
    draftSavedAt ? "saved" : "idle",
  );
  const [slash, setSlash] = useState<SlashState>(null);
  const slashRef = useRef<SlashState>(null);
  useEffect(() => {
    slashRef.current = slash;
  }, [slash]);
  const [plusOpen, setPlusOpen] = useState(false);
  const [isEmpty, setIsEmpty] = useState(initialBlocks.length === 0 && !initialTitle);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localKey = composerRecoveryKey(postId ?? carId);
  // Latest title/draft-action for the debounced autosave closure.
  const titleRef = useRef(title);
  const blocksRef = useRef(initialBlocks);
  const operationIdRef = useRef(operationId);
  const draftActionRef = useRef(draftAction);
  // Publishing wins over the debounced autosave: the timer callback checks
  // this ref so a pending save can't land after the post and leave a
  // duplicate draft behind. The explicit submit handler owns this flag and
  // clears the pending timer before contacting the server.
  const publishingRef = useRef(false);
  useEffect(() => {
    titleRef.current = title;
    operationIdRef.current = operationId;
    draftActionRef.current = draftAction;
  }, [draftAction, operationId, title]);

  const slashExtension = useMemo(
    () =>
      Extension.create({
        name: "drvnSlash",
        addProseMirrorPlugins() {
          return [
            Suggestion({
              editor: this.editor,
              char: "/",
              startOfLine: false,
              items: ({ query }: { query: string }) =>
                INSERT_ITEMS.filter((item) =>
                  item.label.toLowerCase().includes(query.toLowerCase()),
                ),
              command: ({ editor, range, props }: { editor: Editor; range: { from: number; to: number }; props: InsertItem }) => {
                editor.chain().focus().deleteRange(range).run();
                props.insert(editor);
              },
              render: () => ({
                onStart: (props) => {
                  setSlash({
                    items: props.items as InsertItem[],
                    clientRect: props.clientRect?.() ?? null,
                    command: (item) => props.command(item),
                    selected: 0,
                  });
                },
                onUpdate: (props) => {
                  setSlash((current) =>
                    current
                      ? {
                          ...current,
                          items: props.items as InsertItem[],
                          clientRect: props.clientRect?.() ?? null,
                          command: (item) => props.command(item),
                        }
                      : current,
                  );
                },
                onKeyDown: (props) => {
                  const current = slashRef.current;
                  if (!current) return false;
                  if (props.event.key === "Escape") {
                    setSlash(null);
                    return true;
                  }
                  if (props.event.key === "ArrowDown") {
                    setSlash({ ...current, selected: (current.selected + 1) % current.items.length });
                    return true;
                  }
                  if (props.event.key === "ArrowUp") {
                    setSlash({
                      ...current,
                      selected: (current.selected - 1 + current.items.length) % current.items.length,
                    });
                    return true;
                  }
                  if (props.event.key === "Enter") {
                    const item = current.items[current.selected];
                    if (item) current.command(item);
                    return true;
                  }
                  return false;
                },
                onExit: () => setSlash(null),
              }),
            }),
          ];
        },
      }),
    [],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2] },
        bold: false,
        italic: false,
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        link: false,
        underline: false,
      }),
      ...composerNodes({ carId, userId, mods }),
      Placeholder.configure({ placeholder: "Tell the story — or type / for blocks" }),
      slashExtension,
    ],
    content: blocksToDoc(initialBlocks) as object,
    editorProps: {
      attributes: {
        class: "bsc__surface",
        "aria-label": "Update body",
      },
    },
  });

  const writeLocalRecovery = useCallback((nextTitle: string, nextBlocks: ActivityBlock[]) => {
    try {
      localStorage.setItem(localKey, JSON.stringify({
        title: nextTitle,
        blocks: nextBlocks,
        operationId: operationIdRef.current,
        at: Date.now(),
      }));
    } catch {
      // Storage full/blocked — the server draft remains the primary copy.
    }
  }, [localKey]);

  const scheduleAutosave = useCallback((nextBlocks: ActivityBlock[]) => {
    writeLocalRecovery(titleRef.current, nextBlocks);
    if (isEdit || !titleRef.current.trim()) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState((state) => state === "idle" ? state : "saving");
    saveTimer.current = setTimeout(async () => {
      if (publishingRef.current) return;
      const form = new FormData();
      form.set("car_id", carId);
      form.set("operation_id", operationIdRef.current);
      form.set("title", titleRef.current);
      form.set("blocks", JSON.stringify(blocksRef.current));
      setSaveState("saving");
      try {
        const result = draftActionRef.current
          ? await draftActionRef.current({}, form)
          : { error: "no draft action" };
        setSaveState(result.error ? "error" : "saved");
      } catch {
        setSaveState("error");
      }
    }, 1600);
  }, [carId, isEdit, writeLocalRecovery]);

  // Serialize on every editor change and keep a local recovery copy until a
  // server save or publish is confirmed.
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      const blocks = docToBlocks(editor.getJSON() as PmDoc);
      blocksRef.current = blocks;
      setBlocksJson(JSON.stringify(blocks));
      setIsEmpty(blocks.length === 0);
      scheduleAutosave(blocks);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [editor, scheduleAutosave]);

  // Recover a newer browser copy after a crash or interrupted request. The
  // operation UUID comes with it so retrying a committed publish is harmless.
  useEffect(() => {
    if (!editor || isEdit) return;
    let frame: number | null = null;
    try {
      const raw = localStorage.getItem(localKey);
      if (!raw) return;
      const recovered = JSON.parse(raw) as {
        title?: unknown;
        blocks?: unknown;
        operationId?: unknown;
        at?: unknown;
      };
      const serverSavedAt = draftSavedAt ? Date.parse(draftSavedAt) : 0;
      if (typeof recovered.at !== "number" || recovered.at <= serverSavedAt) return;
      const recoveredTitle = typeof recovered.title === "string"
        ? recovered.title.slice(0, ACTIVITY_TITLE_MAX)
        : "";
      const recoveredBlocks = normalizeBlocks(recovered.blocks);
      const recoveredOperation = typeof recovered.operationId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recovered.operationId)
        ? recovered.operationId
        : operationIdRef.current;
      frame = requestAnimationFrame(() => {
        titleRef.current = recoveredTitle;
        blocksRef.current = recoveredBlocks;
        operationIdRef.current = recoveredOperation;
        setTitle(recoveredTitle);
        setBlocksJson(JSON.stringify(recoveredBlocks));
        setOperationId(recoveredOperation);
        setIsEmpty(recoveredBlocks.length === 0 && !recoveredTitle);
        setSaveState("recovered");
        editor.commands.setContent(blocksToDoc(recoveredBlocks) as object);
        scheduleAutosave(recoveredBlocks);
      });
    } catch {
      // Malformed or unavailable local recovery must never block the editor.
    }
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [draftSavedAt, editor, isEdit, localKey, scheduleAutosave]);


  const applyTemplate = useCallback(
    (template: (typeof TEMPLATES)[number]) => {
      if (!editor) return;
      editor.commands.setContent(blocksToDoc(template.blocks) as object);
      editor.commands.focus("start");
      setIsEmpty(false);
    },
    [editor],
  );

  const [publishState, setPublishState] = useState<ActionState>({});
  const [draftState, setDraftState] = useState<ActionState>({});
  const [publishing, setPublishing] = useState(false);
  const [draftPending, setDraftPending] = useState(false);
  const submittingRef = useRef(false);

  async function submit(mode: "publish" | "draft", formData: FormData) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    publishingRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setPublishState({});
    setDraftState({});
    const setResult = mode === "publish" ? setPublishState : setDraftState;
    const setPending = mode === "publish" ? setPublishing : setDraftPending;
    setPending(true);
    try {
      const result = mode === "publish"
        ? await publishAction({}, formData)
        : draftAction ? await draftAction({}, formData) : {};
      setResult(result);
      if (result.ok) {
        try { localStorage.removeItem(localKey); } catch { /* Storage may be unavailable. */ }
      }
      // Act on the confirmed response directly. A revalidated server tree must
      // not leave navigation waiting for a deferred action-state effect.
      if (result.href) router.push(result.href);
    } catch (error) {
      unstable_rethrow(error);
      setResult({ error: "The response was interrupted. Your draft is still here — try again." });
    } finally {
      publishingRef.current = false;
      submittingRef.current = false;
      setPending(false);
    }
  }

  const showTemplates = !isEdit && isEmpty;

  // W-2: the server refuses to publish without a photo. Said up front, next
  // to Publish, instead of as an error after the member has written it all.
  const hasPhoto = useMemo(() => {
    try {
      return blockMediaUrls(JSON.parse(blocksJson) as ActivityBlock[]).length > 0;
    } catch {
      return false;
    }
  }, [blocksJson]);
  // A quick post has no title, so an edit only needs one if the post had one.
  const titleRequired = !isEdit || Boolean(initialTitle.trim());
  const missing = [titleRequired && !title.trim() && "a title", !isEdit && !hasPhoto && "a photo"].filter(Boolean);
  const publishReason = missing.length ? `Add ${missing.join(" and ")} to publish` : null;
  const titleInput = useRef<HTMLInputElement>(null);
  const addPhotos = useCallback(() => {
    if (!editor) return;
    editor.commands.focus("end");
    INSERT_ITEMS.find((item) => item.key === "photos")?.insert(editor);
  }, [editor]);

  return (
    <div className="bsc">
      <label htmlFor="composer-title" className="microlabel">
        Title
      </label>
      <input
        ref={titleInput}
        id="composer-title"
        className="bsc__title"
        placeholder="Title your update"
        maxLength={ACTIVITY_TITLE_MAX}
        value={title}
        onChange={(event) => {
          const nextTitle = event.target.value;
          titleRef.current = nextTitle;
          setTitle(nextTitle);
          scheduleAutosave(blocksRef.current);
        }}
      />

      {showTemplates && (
        <div className="bsc__starters" aria-label="Optional starting points">
          <span className="microlabel !mb-0">Start with…</span>
          {TEMPLATES.map((template) => (
            <button
              key={template.key}
              type="button"
              className="chip bsc__starter"
              title={template.explain}
              onClick={() => applyTemplate(template)}
            >
              {template.label}
            </button>
          ))}
          <span className="text-micro text-dim">or just start typing</span>
        </div>
      )}

      <EditorContent editor={editor} />

      {slash && slash.items.length > 0 && slash.clientRect && (
        <div
          className="combo__pop bsc__slash"
          style={{
            position: "fixed",
            left: Math.min(slash.clientRect.left, window.innerWidth - 280),
            top: slash.clientRect.bottom + 6,
            width: 260,
          }}
          role="listbox"
          aria-label="Insert a block"
        >
          <ul className="combo__list">
            {slash.items.map((item, index) => (
              <li
                key={item.key}
                role="option"
                aria-selected={index === slash.selected}
                className={cx("combo__opt", index === slash.selected && "is-active")}
                onPointerDown={(event) => {
                  event.preventDefault();
                  slash.command(item);
                }}
              >
                <span>{item.label}</span>
                <span className="combo__optnote">{item.hint}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bsc__addwrap">
        {/* Photos first while there are none — publishing needs one. */}
        {!isEdit && !hasPhoto && (
          <Button variant="ghost" onClick={addPhotos}>
            + Add photos
          </Button>
        )}
        <button
          type="button"
          className="btn btn--ghost"
          aria-expanded={plusOpen}
          onClick={() => setPlusOpen((open) => !open)}
        >
          + Add something
        </button>
        {plusOpen && (
          <div className="combo__pop bsc__plus" role="menu" aria-label="Add a block">
            <ul className="combo__list">
              {(["write", "build"] as const).map((section) => (
                <li key={section} role="presentation">
                  <span className="combo__note !py-1">
                    {section === "write" ? "Write" : "Build"}
                  </span>
                  <ul className="!p-0" role="presentation">
                    {INSERT_ITEMS.filter((item) => item.section === section).map((item) => (
                      <li
                        key={item.key}
                        role="menuitem"
                        tabIndex={0}
                        className="combo__opt"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          if (editor) {
                            editor.commands.focus("end");
                            item.insert(editor);
                          }
                          setPlusOpen(false);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            if (editor) {
                              editor.commands.focus("end");
                              item.insert(editor);
                            }
                            setPlusOpen(false);
                          }
                        }}
                      >
                        <span>{item.label}</span>
                        <span className="combo__optnote">{item.hint}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <form className="bsc__foot" onSubmit={(event) => {
        event.preventDefault();
        const mode = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "draft" ? "draft" : "publish";
        // Publish stays a full-colour button (aria-disabled, not disabled) so
        // it reads as the primary action; pressing it early takes you to
        // what's missing instead of doing nothing.
        if (mode === "publish" && publishReason) {
          if (!title.trim()) titleInput.current?.focus();
          else addPhotos();
          return;
        }
        void submit(mode, new FormData(event.currentTarget));
      }}>
        <input type="hidden" name="car_id" value={carId} />
        {postId && <input type="hidden" name="post_id" value={postId} />}
        {!isEdit && <input type="hidden" name="operation_id" value={operationId} />}
        <input type="hidden" name="title" value={title} />
        <input type="hidden" name="blocks" value={blocksJson} />
        {Object.entries(extraHidden ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="live"
            name="intent"
            value="publish"
            loading={publishing}
            pendingLabel={isEdit ? "Saving…" : "Publishing…"}
            disabled={draftPending}
            aria-disabled={publishReason ? true : undefined}
            aria-describedby="composer-status"
          >
            {isEdit ? "Save changes" : "Publish"}
          </Button>
          {!isEdit && (
            <Button
              type="submit"
              variant="ghost"
              name="intent"
              value="draft"
              loading={draftPending}
              disabled={publishing}
              pendingLabel="Saving…"
            >
              Save draft
            </Button>
          )}
          <span id="composer-status" className="microlabel !mb-0" aria-live="polite">
            {publishState.error || draftState.error ? (
              <span className="text-live" role="alert">{publishState.error ?? draftState.error}</span>
            ) : publishState.ok ? (
              <span role="status">{publishState.ok}</span>
            ) : saveState === "saving" ? (
              "Saving…"
            ) : publishReason && saveState !== "error" && saveState !== "recovered" ? (
              publishReason
            ) : saveState === "saved" ? (
              "Saved — only you can see it"
            ) : saveState === "error" ? (
              <span className="text-live">Autosave failed — use Save draft</span>
            ) : saveState === "recovered" ? (
              "Recovered a newer browser draft — save or publish when ready"
) : null}
          </span>
        </div>
      </form>
    </div>
  );
}
