import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Message, MessageThread, ThreadDivider } from "@/components/ui";

const meta = {
  title: "Comms/MessageThread",
  component: MessageThread,
} satisfies Meta<typeof MessageThread>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Thread: Story = {
  args: { children: null },
  render: () => (
    <div style={{ maxWidth: 560 }}>
      <MessageThread>
        <Message who="Dana Rossi" whoEnd={<span className="chip">Seller</span>} when="2026-08-27T10:00:00Z" whenLabel="Yesterday" body="Happy to do $1,300 shipped if you can pay this week." />
        <ThreadDivider>Today</ThreadDivider>
        <Message me who="You" when="2026-08-28T09:12:00Z" whenLabel="9:12" body="Deal — sending the offer now." />
      </MessageThread>
    </div>
  ),
};
