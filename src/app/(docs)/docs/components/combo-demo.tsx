"use client";

import { useState } from "react";

import { ComboField } from "@/components/ui";

/** Interactive ComboField specimen for /docs/components. */
export function ComboDemo() {
  const [value, setValue] = useState<string | number | null>(null);
  return (
    <ComboField
      id="doc-combo-make"
      label="Make"
      placeholder="Search makes…"
      options={[
        { id: 1, label: "Volkswagen" },
        { id: 2, label: "BMW" },
        { id: 3, label: "Audi" },
        { id: 4, label: "Porsche" },
        { id: 5, label: "Toyota", keywords: ["Toyoda"] },
        { id: 6, label: "Nissan", note: "incl. Datsun" },
      ]}
      value={value}
      onChange={(option) => setValue(option?.id ?? null)}
      footer={<span className="text-micro text-dim">Can&rsquo;t find it? Manual entry stays available.</span>}
      hint="Ranked options, keyword matching, keyboard navigation."
    />
  );
}
