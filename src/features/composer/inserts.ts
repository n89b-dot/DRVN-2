import type { Editor } from "@tiptap/core";

/**
 * The insertable block set — one list drives the `+` menu and the `/` slash
 * menu, so the two entry points can never drift. Deliberately small (brief
 * §O): core writing blocks plus the automotive set. Labels say what appears;
 * inserting is always undoable (one Cmd+Z).
 */

export type InsertItem = {
  key: string;
  label: string;
  hint: string;
  /** Section separator in menus. */
  section: "write" | "build";
  insert: (editor: Editor) => void;
};

const insertNode = (editor: Editor, type: string, attrs?: Record<string, unknown>) =>
  editor.chain().focus().insertContent({ type, attrs }).run();

export const INSERT_ITEMS: InsertItem[] = [
  {
    key: "heading",
    label: "Heading",
    hint: "A section title",
    section: "write",
    insert: (editor) => editor.chain().focus().setNode("heading", { level: 2 }).run(),
  },
  {
    key: "photos",
    label: "Photos",
    hint: "A photo set",
    section: "write",
    insert: (editor) => insertNode(editor, "gallery"),
  },
  {
    key: "video",
    label: "Video",
    hint: "YouTube embed",
    section: "write",
    insert: (editor) => insertNode(editor, "youtube"),
  },
  {
    key: "divider",
    label: "Divider",
    hint: "A quiet rule between chapters",
    section: "write",
    insert: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    key: "mod",
    label: "Modification",
    hint: "Installed / removed / replaced a part",
    section: "build",
    insert: (editor) => insertNode(editor, "modChange"),
  },
  {
    key: "before-after",
    label: "Before / After",
    hint: "Two-photo comparison slider",
    section: "build",
    insert: (editor) => insertNode(editor, "beforeAfter"),
  },
  {
    key: "performance",
    label: "Performance result",
    hint: "Dyno, quarter mile, lap, weight — owner-reported",
    section: "build",
    insert: (editor) => insertNode(editor, "performanceResult"),
  },
  {
    key: "mileage",
    label: "Mileage",
    hint: "Miles on the clock at this update",
    section: "build",
    insert: (editor) => insertNode(editor, "mileageMilestone"),
  },
];
