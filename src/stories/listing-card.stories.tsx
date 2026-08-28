import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ListingCard, Mosaic } from "@/components/ui";

import { plate } from "./placeholder";

const base = {
  id: "l1",
  title: "KW Variant 3 Coilovers",
  price_cents: 145000,
  shipping_cents: 2500,
  condition: "used",
  location: "Portland, OR",
  cover_url: plate("coilovers", 16),
  part_number: "35280081",
  watch_count: 4,
  seller: { name: "Dana Rossi", rating: "4.9", review_count: 21 },
  source_car_name: "2019 Volkswagen Golf R",
  source_car_slug: "dana-golf-r",
};

const meta = {
  title: "Commerce/ListingCard",
  component: ListingCard,
  args: { listing: base, prefetch: false },
  decorators: [
    (Story) => (
      <Mosaic>
        <Story />
      </Mosaic>
    ),
  ],
} satisfies Meta<typeof ListingCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const NoPhoto: Story = { args: { listing: { ...base, cover_url: null } } };
export const LongTitle: Story = {
  args: {
    listing: {
      ...base,
      title:
        "Genuine BMW E46 M3 CSL carbon airbox complete with MAP conversion loom, alpha-n tune and all mounting hardware",
    },
  },
};
export const Sold: Story = { args: { listing: { ...base, status_flag: "sold" } } };
export const FitmentMatch: Story = { args: { listing: { ...base, fits_car_name: "Golf R" } } };
export const NoSellerTrust: Story = { args: { listing: { ...base, seller: null, watch_count: undefined } } };
