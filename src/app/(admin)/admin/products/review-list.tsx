"use client";

import Link from "next/link";

import { ObjectRow } from "@/components/ui";
import { adminResolveIdentityReview } from "@/lib/admin/actions";
import type { IdentityReviewRow } from "@/lib/admin/product-identity";

import { ActionDialog, type ActionField } from "../_components/action-dialog";

const KIND_LABEL: Record<IdentityReviewRow["kind"], string> = {
  number_across_brands: "One number, several brands",
  brandless_number: "No brand",
  unscoped_same_product: "Link without brands",
  listing_alternate: "Also-known-as clash",
};

const STATUS_LABEL: Record<IdentityReviewRow["status"], string> = {
  open: "Open",
  merged: "Merged",
  kept_separate: "Kept separate",
  dismissed: "Dismissed",
  obsolete: "Resolved itself",
};

const NOTE: ActionField = { kind: "reason", name: "note", label: "Why — kept in the audit log" };

function decisionFields(kind: IdentityReviewRow["kind"]): ActionField[] {
  // A record without a brand isn't an identifier: there is nothing to merge.
  if (kind === "brandless_number") return [NOTE];
  return [
    {
      kind: "select",
      name: "decision",
      label: "Decision",
      placeholder: "Choose…",
      options: [
        { value: "merge", label: "Merge — these are one product" },
        { value: "keep_separate", label: "Keep separate — different parts" },
      ],
    },
    NOTE,
  ];
}

function productLine(p: IdentityReviewRow["products"][number]) {
  const numbers = p.numbers.length ? p.numbers.join(", ") : "no numbers";
  return `${p.brand}${p.name ? ` · ${p.name}` : ""} — ${numbers}`;
}

/**
 * One review per row: what's ambiguous, the products involved with every
 * number each holds, and the record it came from. Open rows carry the
 * decision; closed rows show how it was decided.
 */
export function IdentityReviewList({ rows }: { rows: IdentityReviewRow[] }) {
  return (
    <div className="rowlist mt-4">
      {rows.map((r) => (
        <ObjectRow
          key={r.id}
          title={
            <span className="flex flex-wrap items-baseline gap-2">
              <span className={r.status === "open" ? "chip chip--live" : "chip"}>{KIND_LABEL[r.kind]}</span>
              <span className="font-mono text-micro">{r.number ?? "—"}</span>
            </span>
          }
          meta={
            <>
              {r.products.map((p) => (
                <span key={p.id} className="block">
                  {productLine(p)}
                </span>
              ))}
              {r.record && (
                <span className="block">
                  {r.record.href ? (
                    <Link href={r.record.href} className="hover:text-live">
                      {r.record.label}
                    </Link>
                  ) : (
                    r.record.label
                  )}
                </span>
              )}
              <span className="block">
                Filed {new Date(r.createdAt).toLocaleDateString()}
                {r.status !== "open" && (
                  <>
                    {" "}
                    · {STATUS_LABEL[r.status]}
                    {r.resolvedAt ? ` ${new Date(r.resolvedAt).toLocaleDateString()}` : ""}
                    {r.resolutionNote ? ` — “${r.resolutionNote}”` : ""}
                  </>
                )}
              </span>
            </>
          }
          actions={
            r.status === "open" ? (
              <ActionDialog
                action={adminResolveIdentityReview}
                title={r.kind === "brandless_number" ? "Dismiss this review" : "Decide product identity"}
                trigger={r.kind === "brandless_number" ? "Dismiss" : "Decide"}
                triggerClassName="relbtn !static"
                hidden={r.kind === "brandless_number" ? { review_id: r.id, decision: "dismiss" } : { review_id: r.id }}
                confirmNote={
                  r.kind === "brandless_number"
                    ? "The record stays without a product until it has a brand. Nothing about it changes."
                    : "Merge moves every number into the oldest product and marks them verified; every listing and build line with those numbers follows. Keep separate records that they are different parts and the review won't come back for the same brands."
                }
                fields={decisionFields(r.kind)}
                submitLabel={r.kind === "brandless_number" ? "Dismiss" : "Record decision"}
              />
            ) : undefined
          }
        />
      ))}
    </div>
  );
}
