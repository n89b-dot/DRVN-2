import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { BeforeAfter } from "@/components/ui";

import { plate } from "./placeholder";

const meta = {
  title: "Media/BeforeAfter",
  component: BeforeAfter,
  args: {
    beforeUrl: plate("stock height", 30),
    afterUrl: plate("KW V3 · -25mm", 210),
    beforeLabel: "Stock",
    afterLabel: "KW V3",
  },
  decorators: [(Story) => <div style={{ maxWidth: 560 }}><Story /></div>],
} satisfies Meta<typeof BeforeAfter>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const NoLabels: Story = { args: { beforeLabel: undefined, afterLabel: undefined } };
