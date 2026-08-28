import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { OrderPipeline, StatusChip } from "@/components/commerce";

const meta = {
  title: "Commerce/Order status",
  component: OrderPipeline,
} satisfies Meta<typeof OrderPipeline>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Paid: Story = { args: { status: "paid" } };
export const Shipped: Story = { args: { status: "shipped" } };
export const Delivered: Story = { args: { status: "delivered" } };
export const Disputed: Story = { args: { status: "disputed" } };
export const Refunded: Story = { args: { status: "refunded" } };

export const Chips: Story = {
  args: { status: "paid" },
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {["pending", "paid", "shipped", "delivered", "completed", "cancelled", "refunded", "disputed", "open", "accepted", "declined"].map(
        (status) => (
          <StatusChip key={status} status={status} />
        ),
      )}
    </div>
  ),
};
