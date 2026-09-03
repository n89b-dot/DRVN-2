import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SuggestingSearchField, type SearchSuggestGroup } from "@/components/ui";

const GROUPS: SearchSuggestGroup[] = [
  {
    kind: "builds",
    label: "Builds",
    items: [
      { id: "b1", label: "Track Golf", sub: "2024 Volkswagen Golf R", href: "#track-golf" },
      { id: "b2", label: "Mariah", sub: "2024 Volkswagen Golf R", href: "#mariah" },
    ],
  },
  {
    kind: "accounts",
    label: "Accounts",
    items: [{ id: "a1", label: "Kaito Ishikawa", sub: "@kaito", href: "#kaito" }],
  },
  {
    kind: "parts",
    label: "Parts",
    items: [
      { id: "p1", label: "APR carbon intake — MK8 Golf R", sub: "$385.00", href: "#apr" },
    ],
  },
];

/** Static fetcher so the story works without the app's suggest endpoint —
 *  type two or more characters to open the grouped popover. */
async function storyFetcher(q: string): Promise<SearchSuggestGroup[]> {
  const needle = q.toLowerCase();
  return GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) || item.sub?.toLowerCase().includes(needle)
    ),
  })).filter((group) => group.items.length > 0);
}

function Demo() {
  return (
    <form role="search" className="finder" onSubmit={(event) => event.preventDefault()}>
      <div className="finder__main">
        <SuggestingSearchField
          label="Search DRVN"
          placeholder="Try “golf”, “kaito” or “apr”…"
          endpoint="/unused-in-story"
          fetcher={storyFetcher}
        />
      </div>
    </form>
  );
}

const meta = {
  title: "Forms/SuggestingSearchField",
  component: Demo,
} satisfies Meta<typeof Demo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
