import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";

import { ComboField } from "@/components/ui";

const OPTIONS = [
  { id: 1, label: "Volkswagen" },
  { id: 2, label: "BMW" },
  { id: 3, label: "Audi" },
  { id: 4, label: "Porsche" },
  { id: 5, label: "Toyota", keywords: ["Toyoda"] },
  { id: 6, label: "Nissan", note: "incl. Datsun" },
];

function Demo({ disabled = false, loading = false }: { disabled?: boolean; loading?: boolean }) {
  const [value, setValue] = useState<string | number | null>(null);
  return (
    <ComboField
      id="story-make"
      label="Make"
      placeholder="Search makes…"
      options={loading ? [] : OPTIONS}
      value={value}
      loading={loading}
      disabled={disabled}
      onChange={(option) => setValue(option?.id ?? null)}
      footer={<span className="text-micro text-dim">Can&apos;t find it? Manual entry stays available.</span>}
      hint="Ranked options; aliases match ('toyoda' finds Toyota)."
    />
  );
}

const meta = {
  title: "Forms/ComboField",
  component: Demo,
} satisfies Meta<typeof Demo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Loading: Story = { args: { loading: true } };
export const Disabled: Story = { args: { disabled: true } };
