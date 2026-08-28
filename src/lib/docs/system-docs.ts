import { NOTIFICATION_KINDS } from "@/lib/notifications/kinds";
import { DOMAIN_STATES } from "@/lib/domain/states";

/**
 * Generated blocks for the systems documentation — same governance as the
 * component registry: the typed modules are the source of truth, the
 * markdown is derived (npm run docs:systems, guarded by system-docs.test.ts).
 */

export const KINDS_BEGIN = "<!-- BEGIN GENERATED: notification-kinds (npm run docs:systems) -->";
export const KINDS_END = "<!-- END GENERATED: notification-kinds -->";
export const STATES_BEGIN = "<!-- BEGIN GENERATED: domain-states (npm run docs:systems) -->";
export const STATES_END = "<!-- END GENERATED: domain-states -->";

export function renderNotificationKindsMarkdown(): string {
  const lines = [
    KINDS_BEGIN,
    "",
    "Source of truth: `src/lib/notifications/kinds.ts`.",
    "",
    "| Kind | Section | Preference | Written by | What it means |",
    "| --- | --- | --- | --- | --- |",
    ...NOTIFICATION_KINDS.map(
      (kind) =>
        `| \`${kind.kind}\` | ${kind.section} | ${kind.pref ? `\`${kind.pref}\`` : "always shown"} | ${kind.source === "trigger" ? "DB trigger" : "app (deliver.ts)"} | ${kind.description} |`,
    ),
    "",
    KINDS_END,
  ];
  return lines.join("\n");
}

export function renderDomainStatesMarkdown(): string {
  const lines: string[] = [
    STATES_BEGIN,
    "",
    "Source of truth: `src/lib/domain/states.ts` (PostgreSQL remains the enforcement — these maps document it).",
    "",
  ];
  for (const domain of DOMAIN_STATES) {
    lines.push(`### ${domain.title}`);
    lines.push("");
    lines.push(`Enforced by: ${domain.authority}`);
    lines.push("");
    lines.push("| From | May move to |");
    lines.push("| --- | --- |");
    for (const [from, targets] of Object.entries(domain.transitions)) {
      lines.push(`| \`${from}\` | ${targets.length ? targets.map((t) => `\`${t}\``).join(" · ") : "**terminal**"} |`);
    }
    lines.push("");
  }
  lines.push(STATES_END);
  return lines.join("\n");
}

export function spliceBlock(doc: string, begin: string, end: string, block: string): string {
  const from = doc.indexOf(begin);
  const to = doc.indexOf(end);
  if (from === -1 || to === -1) throw new Error(`missing generated-block markers ${begin}`);
  return doc.slice(0, from) + block + doc.slice(to + end.length);
}
