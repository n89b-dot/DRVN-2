import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "@/components/ui";

const meta = {
  title: "Actions/Button",
  component: Button,
  args: { children: "List the part" },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Live: Story = { args: { variant: "live" } };
export const Ghost: Story = { args: { variant: "ghost" } };
export const Destructive: Story = { args: { variant: "destructive", children: "Delete listing" } };
export const Loading: Story = { args: { variant: "live", loading: true, pendingLabel: "Publishing…" } };
export const Disabled: Story = { args: { disabled: true } };
