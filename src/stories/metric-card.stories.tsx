import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { MetricCard } from "@/components/ui";

const meta = {
  title: "Data/MetricCard",
  component: MetricCard,
  args: { label: "Live listings", value: 12 },
  decorators: [
    (Story) => (
      <div className="deck deck--kpi" style={{ maxWidth: 720 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MetricCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const NeedsAttention: Story = {
  args: { label: "Needs you", value: 3, live: true, valueLive: true },
};
export const Blank: Story = { args: { label: "Sold", value: "—", blank: true } };
export const WithFooter: Story = {
  args: {
    label: "Available to pay out",
    value: "$1,566",
    footer: <a className="jumplink" href="#top">Payouts →</a>,
  },
};
