import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import {
  BeforeAfterView,
  GalleryView,
  MileageView,
  ModChangeView,
  PerformanceView,
  YoutubeView,
} from "./node-views";

/**
 * The composer's custom block nodes — atoms with React node views, draggable
 * via ProseMirror's native node drag (data-drag-handle in BlockShell). Node
 * attrs mirror the DRVN block fields 1:1; src/features/composer/doc.ts is the
 * only serialization seam.
 *
 * `ComposerContext` rides in as extension options so node views know the car
 * (upload prefix) and its build entries (mod picker) without prop drilling
 * through ProseMirror.
 */

export type ComposerContext = {
  carId: string;
  userId: string;
  /** Build entries for the mod picker: id + display label. */
  mods: { id: string; label: string }[];
};

function atom(name: string, attrs: Record<string, { default: unknown }>, view: Parameters<typeof ReactNodeViewRenderer>[0]) {
  return Node.create<ComposerContext>({
    name,
    group: "block",
    atom: true,
    draggable: true,
    addOptions() {
      return { carId: "", userId: "", mods: [] };
    },
    addAttributes() {
      return attrs;
    },
    parseHTML() {
      return [{ tag: `div[data-drvn="${name}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-drvn": name })];
    },
    addNodeView() {
      return ReactNodeViewRenderer(view);
    },
  });
}

export const GalleryNode = atom("gallery", { urls: { default: [] } }, GalleryView);

export const YoutubeNode = atom(
  "youtube",
  { url: { default: "" }, videoId: { default: "" } },
  YoutubeView,
);

export const ModChangeNode = atom(
  "modChange",
  {
    action: { default: "installed" },
    modItemId: { default: null },
    label: { default: "" },
    detail: { default: null },
  },
  ModChangeView,
);

export const BeforeAfterNode = atom(
  "beforeAfter",
  {
    beforeUrl: { default: "" },
    afterUrl: { default: "" },
    beforeLabel: { default: null },
    afterLabel: { default: null },
  },
  BeforeAfterView,
);

export const PerformanceNode = atom(
  "performanceResult",
  { kind: { default: "dyno" }, entries: { default: [] }, note: { default: null } },
  PerformanceView,
);

export const MileageNode = atom(
  "mileageMilestone",
  { value: { default: 0 }, unit: { default: "mi" } },
  MileageView,
);

export function composerNodes(context: ComposerContext) {
  return [
    GalleryNode.configure(context),
    YoutubeNode.configure(context),
    ModChangeNode.configure(context),
    BeforeAfterNode.configure(context),
    PerformanceNode.configure(context),
    MileageNode.configure(context),
  ];
}
