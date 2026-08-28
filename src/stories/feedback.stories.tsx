import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Alert, EmptyState, SkeletonRows } from "@/components/ui";

const meta = {
  title: "Feedback/Alert & Empty",
  component: Alert,
  args: { title: "Payouts aren't set up yet", children: "Publishing needs somewhere to send your money." },
} satisfies Meta<typeof Alert>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Live: Story = { args: { tone: "live" } };
export const Ok: Story = { args: { tone: "ok", title: "Payment confirmed", children: "The seller has been notified to dispatch." } };

export const Empty: Story = {
  render: () => (
    <EmptyState title="Nothing listed right now">
      Parts land here as owners pull them off their builds.
    </EmptyState>
  ),
};

export const Loading: Story = {
  render: () => (
    <div style={{ maxWidth: 420 }}>
      <SkeletonRows rows={3} />
    </div>
  ),
};
