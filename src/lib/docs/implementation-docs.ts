import {
  GROUPS,
  IMPLEMENTATION_REGISTRY,
  STATUS_LABEL,
  initiativesFor,
  statusCounts,
} from "./implementation-registry";

/**
 * Renders the implementation registry as markdown — the generated block inside
 * `docs/site/implementation.md`. The registry is the source of truth; the
 * markdown is derived, never hand-edited (guarded by
 * implementation-docs.test.ts, regenerated with `npm run docs:implementation`).
 */

export const GENERATED_BEGIN =
  "<!-- BEGIN GENERATED: implementation-registry (npm run docs:implementation) -->";
export const GENERATED_END = "<!-- END GENERATED: implementation-registry -->";

export function renderImplementationMarkdown(): string {
  const counts = statusCounts();
  const lines: string[] = [
    GENERATED_BEGIN,
    "",
    "Source of truth: `src/lib/docs/implementation-registry.ts` (rendered live at `/docs/implementation`).",
    "",
    `**Progress:** ${IMPLEMENTATION_REGISTRY.length} initiatives — ` +
      (Object.keys(counts) as (keyof typeof counts)[])
        .filter((status) => counts[status] > 0)
        .map((status) => `${counts[status]} ${STATUS_LABEL[status].toLowerCase()}`)
        .join(" · "),
    "",
  ];
  for (const group of GROUPS) {
    const items = initiativesFor(group.id);
    if (items.length === 0) continue;
    lines.push(`### ${group.index} · ${group.title}`);
    lines.push("");
    for (const item of items) {
      lines.push(`#### ${item.name} — ${STATUS_LABEL[item.status]}`);
      lines.push("");
      lines.push(`- **Brief:** ${item.brief}`);
      lines.push(`- **Exists today:** ${item.existsToday}`);
      lines.push(`- **Changing:** ${item.changing}`);
      if (item.surfaces.length > 0)
        lines.push(`- **Surfaces:** ${item.surfaces.map((surface) => `\`${surface}\``).join(", ")}`);
      lines.push(`- **User benefit:** ${item.benefit}`);
      lines.push(`- **Approach:** ${item.approach}`);
      if (item.dependsOn?.length) lines.push(`- **Depends on:** ${item.dependsOn.join(", ")}`);
      if (item.uxRules?.length) lines.push(`- **UX rules:** ${item.uxRules.join(" ")}`);
      if (item.decisions?.length) lines.push(`- **Decisions:** ${item.decisions.join(" ")}`);
      lines.push(`- **Validation:** ${item.validation}`);
      if (item.externalStep) lines.push(`- **External step:** ${item.externalStep}`);
      if (item.docs?.length) lines.push(`- **Docs:** ${item.docs.join(", ")}`);
      lines.push("");
    }
  }
  lines.push(GENERATED_END);
  return lines.join("\n");
}

/** Replaces the generated block inside the markdown document. */
export function spliceImplementationBlock(doc: string, block: string): string {
  const begin = doc.indexOf(GENERATED_BEGIN);
  const end = doc.indexOf(GENERATED_END);
  if (begin === -1 || end === -1) {
    throw new Error(
      `docs/site/implementation.md is missing the generated-block markers (${GENERATED_BEGIN} … ${GENERATED_END})`,
    );
  }
  return doc.slice(0, begin) + block + doc.slice(end + GENERATED_END.length);
}
