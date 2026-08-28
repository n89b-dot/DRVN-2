import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ActivityBlocksView } from "@/features/activity/blocks-view";

import { plate } from "./placeholder";

const meta = {
  title: "Composer/Activity blocks",
  component: ActivityBlocksView,
  decorators: [(Story) => <div style={{ maxWidth: 680 }}><Story /></div>],
} satisfies Meta<typeof ActivityBlocksView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FullStory: Story = {
  args: {
    title: "KW V3 installed",
    blocks: [
      { type: "text", style: "heading", text: "Finally on coilovers" },
      { type: "text", style: "normal", text: "After a year on the H&R springs the V3s went on over a weekend." },
      { type: "mod", action: "installed", modItemId: "m1", label: "KW Variant 3 Coilovers", detail: "replacing H&R springs" },
      { type: "images", urls: [plate("install 1", 16), plate("install 2", 260)] },
      { type: "before_after", beforeUrl: plate("before", 30), afterUrl: plate("after", 210), beforeLabel: "Stock" },
      { type: "divider" },
      {
        type: "performance",
        kind: "dyno",
        entries: [
          { label: "Power", value: "412 whp" },
          { label: "Torque", value: "391 lb-ft" },
        ],
        note: "93 octane · Dynojet",
      },
      { type: "mileage", value: 41842, unit: "mi" },
    ],
    modLinks: { m1: { href: "#build", label: "View build entry →" } },
  },
};

export const RemovedPart: Story = {
  args: {
    title: "Out with the intake",
    blocks: [
      { type: "mod", action: "removed", modItemId: "m2", label: "APR Carbon Intake" },
      { type: "text", style: "normal", text: "Going back to stock airbox for the resale." },
    ],
    modLinks: { m2: { href: "#listing", label: "For sale · $280 →" } },
  },
};
