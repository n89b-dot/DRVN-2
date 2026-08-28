"use client";

import { Extension, type Editor } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { EditorContent, useEditor } from "@tiptap/react";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { cx } from "@/lib/format";
import { ACTIVITY_TITLE_MAX } from "@/lib/limits";
import type { ActivityBlock } from "@/lib/activity-blocks";

import { blocksToDoc, docToBlocks, type PmDoc } from "./doc";
import { composerNodes, type ComposerContext } from "./extensions";
import { INSERT_ITEMS, type InsertItem } from "./inserts";

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

export type ActionState = { error?: string; ok?: string };
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
  draftSavedAt?: string | null;
  /** The route's server action for publish (create) or save (edit). */
  publishAction: ComposerServerAction;
  /** The route's draft server action — create mode only (autosave uses it too). */
  draftAction?: ComposerServerAction;
  /** Extra hidden fields the publish action expects preserved (legacy intro/video). */
  extraHidden?: Record<string, string>;
}) {
  const isEdit = Boolean(postId);
  const [title, setTitle] = useState(initialTitle);
  const [blocksJson, setBlocksJson] = useState(() => JSON.stringify(initialBlocks));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
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
  const localKey = `drvn-composer:${postId ?? carId}`;
  // Latest title/draft-action for the debounced autosave closure.
  const titleRef = useRef(title);
  const draftActionRef = useRef(draftAction);
  useEffect(() => {
    titleRef.current = title;
    draftActionRef.current = draftAction;
  }, [title, draftAction]);

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

  // Serialize on every change; autosave (create mode) debounced and quiet.
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      const blocks = docToBlocks(editor.getJSON() as PmDoc);
      const json = JSON.stringify(blocks);
      setBlocksJson(json);
      setIsEmpty(blocks.length === 0);
      try {
        localStorage.setItem(localKey, JSON.stringify({ title, blocks, at: Date.now() }));
      } catch {
        // Storage full/blocked — recovery is a nicety.
      }
      if (isEdit) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveState((state) => (state === "idle" ? state : "saving"));
      saveTimer.current = setTimeout(async () => {
        const form = new FormData();
        form.set("car_id", carId);
        form.set("title", titleRef.current);
        form.set("blocks", JSON.stringify(docToBlocks(editor.getJSON() as PmDoc)));
        setSaveState("saving");
        const result = draftActionRef.current
          ? await draftActionRef.current({}, form)
          : { error: "no draft action" };
        setSaveState(result.error ? "error" : "saved");
      }, 1600);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [editor, carId, isEdit, localKey, title]);


  const applyTemplate = useCallback(
    (template: (typeof TEMPLATES)[number]) => {
      if (!editor) return;
      editor.commands.setContent(blocksToDoc(template.blocks) as object);
      editor.commands.focus("start");
      setIsEmpty(false);
    },
    [editor],
  );

  const [publishState, publishFormAction, publishing] = useActionState<ActionState, FormData>(
    publishAction,
    {},
  );
  const noopDraft: ComposerServerAction = async () => ({});
  const [draftState, draftFormAction, draftPending] = useActionState<ActionState, FormData>(
    draftAction ?? noopDraft,
    {},
  );

  // Publishing clears the local recovery buffer.
  useEffect(() => {
    if (publishState.ok || draftState.ok) {
      try {
        localStorage.removeItem(localKey);
      } catch {
        /* noop */
      }
    }
  }, [publishState.ok, draftState.ok, localKey]);

  const showTemplates = !isEdit && isEmpty;

  return (
    <div className="bsc">
      <label htmlFor="composer-title" className="microlabel">
        Title
      </label>
      <input
        id="composer-title"
        className="bsc__title"
        placeholder="Title your update"
        maxLength={ACTIVITY_TITLE_MAX}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />

      {showTemplates && (
        <div className="bsc__starters" aria-label="Optional starting points">
          <span className="microlabel !mb-0">Start with…</span>
          {TEMPLATES.map((template) => (
            <button
              key={template.key}
              type="button"
              className="chip chip--ink bsc__starter"
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
        <button
          type="button"
          className="btn btn--ghost"
          aria-expanded={plusOpen}
          onClick={() => setPlusOpen((open) => !open)}
        >
          + Add something
        </button>
        <span className="text-micro text-dim">or type / anywhere</span>
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

      <form className="bsc__foot">
        <input type="hidden" name="car_id" value={carId} />
        {postId && <input type="hidden" name="post_id" value={postId} />}
        <input type="hidden" name="title" value={title} />
        <input type="hidden" name="blocks" value={blocksJson} />
        {Object.entries(extraHidden ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="live"
            formAction={publishFormAction}
            loading={publishing}
            pendingLabel={isEdit ? "Saving…" : "Publishing…"}
            disabled={!title.trim()}
          >
            {isEdit ? "Save changes" : "Publish"}
          </Button>
          {!isEdit && (
            <Button
              type="submit"
              variant="ghost"
              formAction={draftFormAction}
              loading={draftPending}
              pendingLabel="Saving…"
            >
              Save draft
            </Button>
          )}
          <span className="microlabel !mb-0" role="status" aria-live="polite">
            {publishState.error || draftState.error ? (
              <span className="text-live">{publishState.error ?? draftState.error}</span>
            ) : saveState === "saving" ? (
              "Saving…"
            ) : saveState === "saved" ? (
              "Saved — only you can see it"
            ) : saveState === "error" ? (
              <span className="text-live">Autosave failed — use Save draft</span>
            ) : null}
          </span>
        </div>
      </form>
    </div>
  );
}
