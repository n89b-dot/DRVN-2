import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ConversationRow, DealCard, DealChip, OfferCard } from "@/components/commerce";
import { Message, MessageBubble, MessageRun, MessageThread, ThreadDivider, ThreadEvent } from "@/components/ui";

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

/** Person-first conversation grammar (/messages): runs, bubbles, events. */
export const Conversation: Story = {
  args: { children: null },
  render: () => (
    <div className="convthread" style={{ maxWidth: 640 }}>
      <ThreadDivider>Tue 22 Sep</ThreadDivider>
      <ThreadEvent>
        <span>
          <b>Kaito</b> shipped the Rays bronze 17x9 set
        </span>
      </ThreadEvent>
      <MessageRun who="Kaito" when="2026-09-22T16:53:00Z" whenLabel="4:53 pm" about="Rays wheels">
        <MessageBubble>These are on their way. Tires have maybe 60% left.</MessageBubble>
      </MessageRun>
      <MessageRun me who="You" when="2026-09-22T17:02:00Z" whenLabel="5:02 pm" about="Seats" foot="Seen">
        <MessageBubble>Will do — double-wrapped with foam on the bolsters.</MessageBubble>
        <MessageBubble>Shipping Monday.</MessageBubble>
      </MessageRun>
      <ThreadEvent live>
        <span>
          <b>Imani</b> countered $6,200
        </span>
      </ThreadEvent>
      <OfferCard eyebrow="Imani countered · Akrapovič exhaust" amount="$6,200" note="You offered $5,900." move>
        <span className="btn btn--live">Accept $6,200</span>
      </OfferCard>
    </div>
  ),
};

/** One inbox row per person, deals as chips; a deal card from the thread header. */
export const InboxRowAndDeals: Story = {
  args: { children: null },
  render: () => (
    <div style={{ maxWidth: 380 }} className="grid gap-3">
      <ConversationRow
        href="#"
        active
        name="Kaito Nakamura"
        when="2026-09-24T05:53:00Z"
        whenLabel="4d"
        preview="Excited for these. Could you wrap the bolster edges?"
        unread={1}
        deals={
          <>
            <DealChip side="selling" title="E46 M3 front sport seats" label="Ship it" tone="move" />
            <DealChip side="buying" title="Rays bronze 17x9 set" label="On its way" tone="ok" />
          </>
        }
      />
      <DealCard href="#" title="E46 M3 front sport seats" eyebrow="Selling · Ship it" amount="$1,130" tone="move" />
    </div>
  ),
};
