import { NarrowColumn, SectionLabel } from "@/components/ui";

export function PlaceholderPage({
  eyebrow,
  title,
  description,
  milestone,
}: {
  eyebrow: string;
  title: string;
  description: string;
  milestone: string;
}) {
  return (
    <NarrowColumn>
      <SectionLabel>{eyebrow}</SectionLabel>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-text-secondary">{description}</p>
      <p className="mt-6 inline-block rounded-pill border border-border bg-surface px-4 py-2 text-xs text-text-muted">
        Coming in {milestone}
      </p>
    </NarrowColumn>
  );
}
