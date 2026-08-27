import { COMPONENT_REGISTRY, type RegistryEntry } from "@/components/registry";

/**
 * Renders the component-registry inventory as markdown — the generated block
 * inside `docs/site/components.md`. The registry is the source of truth; the
 * markdown is derived, never hand-edited (guarded by registry-docs.test.ts,
 * regenerated with `npm run docs:components`).
 */

export const GENERATED_BEGIN = "<!-- BEGIN GENERATED: component-registry (npm run docs:components) -->";
export const GENERATED_END = "<!-- END GENERATED: component-registry -->";

const LAYER_LABEL: Record<RegistryEntry["layer"], string> = {
  primitive: "Primitive",
  pattern: "Product pattern",
  feature: "Feature",
};

function row(entry: RegistryEntry): string {
  const flags = entry.status === "active" ? "" : ` **[${entry.status}]**`;
  const recipe = entry.cssRecipe ? ` — \`${entry.cssRecipe}\`` : "";
  const avoid = entry.avoid ? ` *Not for:* ${entry.avoid}` : "";
  return `| \`${entry.name}\`${flags} | ${LAYER_LABEL[entry.layer]} | \`${entry.importPath}\` | ${entry.description}${recipe} | ${entry.use}${avoid} |`;
}

export function renderRegistryMarkdown(): string {
  const byLayer: RegistryEntry["layer"][] = ["primitive", "pattern", "feature"];
  const lines: string[] = [
    GENERATED_BEGIN,
    "",
    "Source of truth: `src/components/registry.ts` (validated by `src/components/registry.test.ts`).",
    "",
  ];
  for (const layer of byLayer) {
    const entries = COMPONENT_REGISTRY.filter((e) => e.layer === layer);
    lines.push(`### ${LAYER_LABEL[layer]}s (${entries.length})`);
    lines.push("");
    lines.push("| Component | Layer | Import from | What it is | Use it for |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(row(entry));
    }
    lines.push("");
  }
  lines.push(GENERATED_END);
  return lines.join("\n");
}

/** Replaces the generated block inside a markdown document. */
export function spliceGeneratedBlock(doc: string, block: string): string {
  const begin = doc.indexOf(GENERATED_BEGIN);
  const end = doc.indexOf(GENERATED_END);
  if (begin === -1 || end === -1) {
    throw new Error(
      `docs/site/components.md is missing the generated-block markers (${GENERATED_BEGIN} … ${GENERATED_END})`,
    );
  }
  return doc.slice(0, begin) + block + doc.slice(end + GENERATED_END.length);
}
