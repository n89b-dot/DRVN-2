import { AgentHeader, ConversationRow, DealCard, DealChip, OfferCard, OfferRound, OrderPipeline, StatusChip } from "@/components/commerce";
import { LiveDim } from "@/components/livesheet";
import { COMPONENT_REGISTRY, type RegistryEntry } from "@/components/registry";
import { DialogDemo } from "./dialog-demo";
import { ChatComposerDemo } from "./chat-composer-demo";
import { FinderDemo } from "./finder-demo";
import { ComboDemo } from "./combo-demo";
import {
  ActionFooter,
  Alert,
  Button,
  Checkbox,
  DataRow,
  EmptyState,
  FilterButton,
  FilterGroup,
  FilterLink,
  FormSection,
  Message,
  MessageBubble,
  MessageRun,
  MessageThread,
  MetricCard,
  MosaicCell,
  ListingCard,
  Mosaic,
  ObjectRow,
  PageHead,
  Pagination,
  RatingStars,
  ResultNote,
  UnconfirmedOutcome,
  SearchField,
  Select,
  Stepper,
  SuggestingSearchField,
  PasswordField,
  TextField,
  TileHead,
  ThreadDivider,
  ThreadEvent,
  ValidationSummary,
  Badge,
  KindBadge,
  SheetTabs,
  Icon,
} from "@/components/ui";

import { DocsJumprow, DocsPagehead, Specimen, SpecimenGroup } from "../../_components/docs-page";

export const metadata = { title: "Components" };

/**
 * The live component board: every Livesheet component, categorized, rendered
 * from the same production CSS the product uses (src/app/globals.css). The
 * written catalog twin is /docs/md/components; the machine contract is
 * /docs/md/livesheet-design-md.
 */
export default function ComponentsPage() {
  return (
    <>
      <DocsPagehead
        index="04"
        liveWord="Components"
        titleRest="— the full board"
        mdSlug="components"
        sub="Rendered live from production CSS. Ten groups, chrome to states — if it ships, it's on this sheet."
      />

      <DocsJumprow
        items={[
          { href: "#chrome", label: "01 Chrome" },
          { href: "#structure", label: "02 Structure" },
          { href: "#annotation", label: "03 Annotation" },
          { href: "#actions", label: "04 Actions" },
          { href: "#data", label: "05 Data" },
          { href: "#forms", label: "06 Forms" },
          { href: "#commerce", label: "07 Commerce" },
          { href: "#comms", label: "08 Comms" },
          { href: "#states", label: "09 States" },
          { href: "#contracts", label: "10 Contracts" },
          { href: "#react", label: "11 Registry" },
        ]}
      />

      {/* ============ 01 CHROME & NAVIGATION ============ */}
      <SpecimenGroup id="chrome" index="01" title="Chrome & navigation">
        <Specimen
          name="Top bar"
          klass=".bar"
          note="Sticky, 86% paper + blur(14px) — the -webkit- declaration goes BEFORE the unprefixed one (the build keeps only the last of the pair). Logo carries the live full stop; the inner edge lines up with the content column; a 560px global search on every page (the bar is identical everywhere; Explore and Marketplace add their own scoped search below it); compact count badges on the icons. The shell's one red fill is Post."
        >
          <div className="flex items-center justify-between rounded-ctl bg-paper px-4 py-3">
            <span className="bar__logo !text-body">
              DRVN<em>.</em> <span className="microlabel">Builds and parts</span>
            </span>
            <span className="flex gap-2">
              <span className="bar__link bar__link--text is-active">Explore</span>
              <span className="bar__link bar__link--text">Marketplace</span>
            </span>
          </div>
        </Specimen>
        <Specimen
          name="Index rows"
          klass=".indexrow"
          note="The phone menu is a second sheet unrolled over the page: search and Post lead, then one 48px single-line row per destination (stroke icon + label; notes are hidden so the whole menu fits in about 1.5 screens); the current row chips 'Here'. The numbered form survives in the admin console."
        >
          <div>
            <div className="indexrow !animate-none !opacity-100">
              <span className="indexrow__n">01</span>
              <span className="indexrow__label">Home</span>
              <span className="indexrow__note">What&rsquo;s moved since you looked</span>
              <span className="indexrow__end chip chip--live">Here</span>
            </div>
            <div className="indexrow !animate-none !opacity-100">
              <span className="indexrow__n">02</span>
              <span className="indexrow__label">Marketplace</span>
              <span className="indexrow__note">Used parts off modified cars</span>
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Jumprow"
          klass=".jumprow / .jumplink"
          note="In-page references on a long sheet — every section keeps a real anchor. Panels that switch use SheetTabs (.tabstrip: Sans labels, accent underline); feed segments are .fbtn chips in a FilterGroup."
        >
          <nav className="jumprow">
            <span className="microlabel">On this sheet</span>
            <a className="jumplink" href="#chrome">
              Overview
            </a>
            <a className="jumplink" href="#chrome">
              The build
            </a>
            <a className="jumplink" href="#chrome">
              Activity
            </a>
          </nav>
        </Specimen>
        <Specimen
          name="Sheet tabs"
          klass="SheetTabs / .tabstrip"
          note="Panels that switch: Plex Sans labels on a ruled baseline, the current tab inked with an accent underline, counts as quiet tabular numbers. Five tabs with counts fit a 358px phone column; sideways scroll is only the fallback when a strip overflows. URL-backed (replaceState), arrow keys and Home/End; onChange tells a page which tab is showing."
        >
          <SheetTabs
            label="Specimen tabs"
            tabs={[
              { key: "overview", label: "Overview", panel: <p className="text-body text-dim">The featured build and the latest updates.</p> },
              { key: "garage", label: "Garage", count: 2, panel: <p className="text-body text-dim">Every car, as photo cards.</p> },
              { key: "parts", label: "Parts", count: 1, live: true, panel: <p className="text-body text-dim">The store, four across.</p> },
              { key: "reviews", label: "Reviews", panel: <p className="text-body text-dim">What buyers said.</p> },
            ]}
          />
        </Specimen>
        <Specimen
          name="Foot"
          klass=".foot"
          note="Every page ends on a mid rule with mono microlabels at both ends."
        >
          <footer className="foot !mt-2">
            <span className="microlabel">DRVN — Sheet 04</span>
            <span className="microlabel">Drawn 02 Aug 2026</span>
          </footer>
        </Specimen>
      </SpecimenGroup>

      {/* ============ 02 PAGE STRUCTURE ============ */}
      <SpecimenGroup id="structure" index="02" title="Page structure">
        <Specimen
          name="Pagehead"
          klass=".pagehead"
          note="Microlabel line → display h1 with exactly one live-word (draw-in underline) → dim standfirst. One per page."
        >
          <div className="pagehead is-in !p-0">
            <span className="microlabel">Sheet 01 — Your desk</span>
            <h1 className="!text-head">
              Your sheet is <span className="live-word">moving</span>
            </h1>
            <p className="sub !mt-2 !text-body">Three offers open, one payout booked.</p>
          </div>
        </Specimen>
        <Specimen
          name="Tile"
          klass=".tile / .tile--deep / .tile--hover"
          note="The plate. No border, no shadow — it reads raised because it's lighter than the page. Never nest a tile inside a tile. .tile__img holds the img-fallback tone before a photo arrives."
          deep
        >
          <div className="flex gap-3">
            <div className="tile min-w-0 flex-1 !p-4">
              <div className="tile__head">
                <span className="microlabel !mb-0">Tile</span>
              </div>
              <div className="tile__img aspect-[3/2]" />
            </div>
            <div className="tile tile--deep min-w-0 flex-1 !p-4">
              <div className="tile__head">
                <span className="microlabel !mb-0">Tile — deep</span>
              </div>
              <div className="tile__img aspect-[3/2]" />
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Deck"
          klass=".deck --kpi / --two / --three"
          note="The one grid: gap 14. KPI is 4-col, two is 1.35fr/1fr, three is 3-col. Children take min-width: 0; never nest decks."
        >
          <div className="deck deck--three !pb-0">
            <div className="grid h-12 place-items-center rounded-ctl bg-paper-deep text-micro text-dim">
              1
            </div>
            <div className="grid h-12 place-items-center rounded-ctl bg-paper-deep text-micro text-dim">
              2
            </div>
            <div className="grid h-12 place-items-center rounded-ctl bg-paper-deep text-micro text-dim">
              3
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Band"
          klass=".band"
          note="The ink-inverted stat plate from the public home — num-giants on the dark ground."
        >
          <div className="band !p-5">
            <div className="band__stats">
              <div>
                <span className="num-giant !text-head">8,412</span>
                <span className="microlabel">Parts on the sheets</span>
              </div>
              <div>
                <span className="num-giant !text-head">$1.2M</span>
                <span className="microlabel">Settled to keepers</span>
              </div>
            </div>
          </div>
        </Specimen>
      </SpecimenGroup>

      {/* ============ 03 ANNOTATION ============ */}
      <SpecimenGroup id="annotation" index="03" title="Annotation — the signature layer">
        <Specimen
          name="Livedim"
          klass=".livedim / --live / --blank"
          note="THE signature: a value dimensioned like a part on a drawing — spine, ticks, microlabel, mono tabular value. --live turns it red with a pulsing dot; --blank dashes the spine around an em dash."
        >
          <div className="flex flex-wrap gap-10">
            <div className="livedim">
              <span className="livedim__tick" aria-hidden="true" />
              <span className="microlabel">Watching now</span>
              <span className="val">214</span>
            </div>
            <div className="livedim livedim--live">
              <span className="livedim__tick" aria-hidden="true" />
              <span className="microlabel">Offer lapses</span>
              <span className="val">0:41:09</span>
            </div>
            <div className="livedim livedim--blank">
              <span className="livedim__tick" aria-hidden="true" />
              <span className="microlabel">Top offer</span>
              <span className="val">—</span>
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Num-giant"
          klass=".num-giant"
          note="The KPI numeral — sans 650, tabular, above a livedim. --blank prints the em dash in dim."
        >
          <div className="flex items-end gap-10">
            <div>
              <span className="num-giant">$4,180</span>
              <div className="livedim !mt-2">
                <span className="livedim__tick" aria-hidden="true" />
                <span className="microlabel">Booked payout</span>
                <span className="val">clears Fri 25</span>
              </div>
            </div>
            <span className="num-giant num-giant--blank">—</span>
          </div>
        </Specimen>
        <Specimen
          name="Microlabel"
          klass=".microlabel / --ink / --live"
          note="The connective tissue — mono 10.5, uppercase, 0.14em, dim. 2–6 words; regions, not sentences."
        >
          <div className="flex flex-wrap gap-6">
            <span className="microlabel !mb-0">Work orders</span>
            <span className="microlabel microlabel--ink !mb-0">04 — Publish</span>
            <span className="microlabel microlabel--live !mb-0">Live now</span>
          </div>
        </Specimen>
        <Specimen
          name="Dimension line & key-value"
          klass=".dimline-h / .kv"
          note="A 1px rule with end ticks that draws itself in (650ms) when revealed. .kv is inline mono data."
        >
          <div className="is-in">
            <div className="dimline-h" />
          </div>
          <div className="kv mt-3">
            REF <b>88-D</b> · GRADE <b>B+</b> · FITS <b>E36 / E46</b>
          </div>
        </Specimen>
      </SpecimenGroup>

      {/* ============ 04 ACTIONS ============ */}
      <SpecimenGroup id="actions" index="04" title="Actions">
        <Specimen
          name="Button"
          klass="Button / variant · loading"
          note="The production component (src/components/ui/button.tsx), rendered here directly. Semantic variants map to the .btn recipes — default (ink, mono caps), live (THE action: one red fill per surface and the only variant with [ ] brackets), ghost and destructive (Plex Sans, sentence case as written), quiet (.relbtn, a Sans row action). loading disables, sets aria-busy and swaps to pendingLabel, so async work always narrates itself. ButtonLink is the same contract as a navigation."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Button>Counter</Button>
            <Button variant="live">Accept $240</Button>
            <Button variant="ghost">Pass</Button>
            <Button variant="destructive">Withdraw listing</Button>
            <Button variant="quiet">Release</Button>
            <Button disabled>Disabled</Button>
            <Button loading pendingLabel="Saving…">
              Save
            </Button>
          </div>
        </Specimen>
        <Specimen
          name="Action footer"
          klass="ActionFooter / .saverow"
          note="The commit row of an editing surface: aux anchored left, status + primary right. ≤520px it stacks deliberately — aux, status as its own line, then a full-width 40px commit. Status is part of the contract: ok renders the chip (role=status), error the live line (role=alert)."
        >
          <ActionFooter
            aux={
              <button type="button" className="jumplink">
                + Add a line manually
              </button>
            }
            status={{ kind: "ok", message: "Saved ✓" }}
            className="!mt-0"
          >
            <Button variant="live">Save the build</Button>
          </ActionFooter>
        </Specimen>
        <Specimen
          name="Pagination"
          klass="Pagination"
          note="Ghost prev/next with the mono page marker between; placeholders keep the row balanced at either edge. Renders nothing on a single first page. One component where four pages each hand-rolled the same nav."
        >
          <Pagination page={2} hasMore hrefFor={(p) => `#page-${p}`} />
        </Specimen>
        <Specimen
          name="Chip"
          klass=".chip / --live --ok --warn --info --ink --spent --danger"
          note="Status, never navigation. Spent desaturates — sold things stay on the sheet."
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="chip">Default</span>
            <span className="chip chip--live">Live</span>
            <span className="chip chip--ok">Settled</span>
            <span className="chip chip--warn">Held</span>
            <span className="chip chip--ink">Ink</span>
            <span className="chip chip--spent">Sold</span>
          </div>
        </Specimen>
        <Specimen
          name="Capsule"
          klass=".capsule / --paper / --quiet"
          note="The ink band that carries a pulsing dot and a countdown — the sheet's way of saying something is mid-flight."
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="capsule">
              <span className="dot" aria-hidden="true" /> Oldest lapses in 2:34:00
            </span>
            <span className="capsule capsule--paper">
              <span className="dot" aria-hidden="true" /> Listening
            </span>
            <span className="capsule capsule--quiet">Quiet</span>
          </div>
        </Specimen>
        <Specimen
          name="Filters & search"
          klass="FilterGroup / FilterLink / FilterButton / SearchField"
          note="Production components. A filter axis is one labelled group: link mode carries aria-current for URL-backed selection (.is-on ink ground), button mode carries aria-pressed (live fill). Chips are mono micro-labels in a hairline outline, ink when on. Axis grammar — stack for the primary axis, sub for the quieter one beneath, scroll to ride the gutter sideways ≤760px, fit for a short fixed set that must share one phone row (never scrolls). Every target keeps the 40px floor."
        >
          <FilterGroup label="Category" className="mb-3">
            <FilterLink href="#suspension" selected>
              Suspension
            </FilterLink>
            <FilterLink href="#brakes">Brakes</FilterLink>
            <FilterButton pressed>Fits my car</FilterButton>
          </FilterGroup>
          <SearchField label="Search parts" defaultValue="dogleg gearbox" className="w-full" />
        </Specimen>
        <Specimen
          name="Suggesting search field"
          klass="SuggestingSearchField"
          note="Production component. The .search plate with grouped autocomplete (ARIA combobox over the .combo popover): debounced fetch from a suggest endpoint, stale requests aborted, arrow keys walk the flattened options, Enter on an option navigates, Enter without one submits the surrounding GET form. This live specimen queries Explore's real suggest endpoint — type two or more characters."
        >
          <form role="search" className="finder" action="/explore" method="get">
            <div className="finder__main">
              <SuggestingSearchField
                label="Search DRVN"
                placeholder="Search…"
                endpoint="/api/explore/suggest"
              />
            </div>
          </form>
        </Specimen>
      </SpecimenGroup>

      {/* ============ 05 DATA DISPLAY ============ */}
      <SpecimenGroup id="data" index="05" title="Data display">
        <Specimen
          name="Baseline row"
          klass=".bline / --ctl / --own"
          note="The ruled row: 190px mono label / value / note, chip at the end. Every list inside a tile rules its rows — the rowlist principle."
        >
          <div>
            <div className="bline">
              <span className="bline__label">Turbo</span>
              <span className="bline__val">Garrett T3 hybrid</span>
              <span className="bline__note">Balanced &amp; flowed · receipts on sheet</span>
              <span className="chip chip--ok">Fitted</span>
            </div>
            <div className="bline">
              <span className="bline__label">Booked payout</span>
              <span className="bline__val" style={{ color: "var(--dim)" }}>
                $0.00
              </span>
              <span className="bline__note">Nothing cleared yet</span>
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Work order"
          klass=".order / .rowlist"
          note="An offer arrives as a work order: 56×44 media, name, meta with the money in bold, and the answer buttons in the row. .is-done takes the ok tint; .is-gone slides out in 420ms."
        >
          <div className="rowlist">
            <div className="order">
              <div className="order__img" />
              <div>
                <div className="order__name">Sabelt bucket seat — driver side</div>
                <div className="order__meta">
                  @torino.classics offers <b>$240</b> vs $290 · lapses 8:41:00
                </div>
              </div>
              <div className="order__actions">
                <button type="button" className="btn btn--live">
                  Accept $240
                </button>
                <button type="button" className="btn btn--ghost">
                  Counter
                </button>
              </div>
            </div>
            <div className="order is-done">
              <div className="order__img" />
              <div>
                <div className="order__name">Momo Corse wheel set</div>
                <div className="order__meta">Sold to @kessler.m · $310</div>
              </div>
              <div className="order__actions">
                <span className="chip chip--ok">Done</span>
              </div>
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Spec table"
          klass=".spec"
          note="Two ruled columns, mono label left, value right — tracking numbers, payout math, fee breakdowns."
        >
          <table className="spec w-full">
            <tbody>
              <tr>
                <td>Carrier</td>
                <td>DHL Express</td>
              </tr>
              <tr>
                <td>Tracking</td>
                <td className="font-mono tabular-nums">JD0148 8821 44</td>
              </tr>
              <tr>
                <td>Payout</td>
                <td className="font-mono tabular-nums">$588.00 after fees</td>
              </tr>
            </tbody>
          </table>
        </Specimen>
        <Specimen
          name="Feed"
          klass=".feed / .amt"
          note="The activity register: mono time rail, sans entry, amount pinned right — live amounts in red only while the money is in motion."
        >
          <ul className="feed">
            <li>
              <time>Now</time> Offer window on the coilovers closes{" "}
              <span className="amt amt--live">0:41:09</span>
            </li>
            <li>
              <time>2h ago</time> Coilovers listed — going Bilstein{" "}
              <span className="amt amt--live">$680</span>
            </li>
            <li>
              <time>Jul 16</time> Seat listing passed 200 views <span className="amt">204</span>
            </li>
            <li>
              <time>Jun 24</time> Momo Corse wheel set sold <span className="amt">$310</span>
            </li>
          </ul>
        </Specimen>
        <Specimen
          name="Pipeline"
          klass=".pipe / .pip"
          note="Four pips joined by dimline connectors: Accepted · Paid · Dispatch · Delivered. Empty pipelines render at half opacity so the first sale is legible, not surprising."
        >
          <div className="space-y-4">
            <div className="pipe">
              <span className="pip is-on" />
              <span className="pip is-on" />
              <span className="pip is-on" />
              <span className="pip" />
              <span className="lbl">Accepted · Paid · Dispatch · Delivered</span>
            </div>
            <div className="pipe opacity-50">
              <span className="pip" />
              <span className="pip" />
              <span className="pip" />
              <span className="pip" />
              <span className="lbl">No orders yet</span>
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Week strip"
          klass=".week / --hot"
          note="Seven paper-deep cells; a hot day takes the live ground and a tag."
        >
          <div className="week">
            <div className="week__day">
              <span className="microlabel">Mon</span>
              <b>20</b>
            </div>
            <div className="week__day">
              <span className="microlabel">Tue</span>
              <b>21</b>
            </div>
            <div className="week__day week__day--hot">
              <span className="microlabel">Wed</span>
              <b>22</b>
              <span className="tag">Meet</span>
            </div>
            <div className="week__day">
              <span className="microlabel">Thu</span>
              <b>23</b>
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Price guide"
          klass=".guide"
          note="A 6px track with the fair band in ok tint and a 2px live 'you' marker — where your asking price sits against the market."
        >
          <div className="guide">
            <div className="guide__track">
              <span className="guide__band" style={{ left: "30%", width: "40%" }} />
              <span className="guide__you" style={{ left: "58%" }} />
            </div>
            <div className="guide__scale">
              <span>$400</span>
              <span>Fair $520–$680</span>
              <span>$800</span>
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Review & monogram"
          klass=".review / .monogram"
          note="Ruled review entries with mono live stars; the monogram is the avatar fallback — initials on an ink plate."
        >
          <div className="flex items-start gap-4">
            <span className="monogram monogram--sm">GI</span>
            <div className="review min-w-0 flex-1 !border-t-0 !pt-0">
              <div className="review__head">
                <span className="order__name text-body">@garage.iida</span>
                <span className="microlabel !mb-0">Jul 2</span>
                <span className="review__stars">★★★★★</span>
              </div>
              <p>Packed like it mattered. The wear photos were, if anything, harsher than the parts.</p>
            </div>
          </div>
        </Specimen>
      </SpecimenGroup>

      {/* ============ 06 FORMS ============ */}
      <SpecimenGroup id="forms" index="06" title="Forms">
        <Specimen
          name="Field components"
          klass="TextField / TextArea / Select / Checkbox / FormField"
          note="The production field family (src/components/ui/form.tsx) — label, control, hint, error and success in one contract, with aria-describedby / aria-invalid wired automatically. Native elements throughout; error presence paints the control via .is-invalid. prefix joins a mono unit into the control plate."
        >
          <div>
            <TextField
              id="doc-part"
              name="doc-part"
              label="Part number"
              prefix="PN"
              defaultValue="CP9660-2S4"
              hint="What a buyer cross-references."
            />
            <TextField
              id="doc-title"
              name="doc-title"
              label="Title"
              defaultValue=""
              error="A part needs a name before it can list."
            />
            <Select id="doc-cond" name="doc-cond" label="Condition" defaultValue="used" fieldClassName="!mb-0">
              <option value="new">New</option>
              <option value="used">Used</option>
            </Select>
            <Checkbox label="Attach provenance" defaultChecked className="mt-2" />
          </div>
        </Specimen>
        <Specimen
          name="PasswordField"
          klass="PasswordField"
          note="TextField's password sibling (src/components/ui/password-field.tsx): the same field contract plus a labelled reveal/conceal eye toggle. Flipping only changes the input type client-side; the toggle stays in the tab order. Used on sign-in, sign-up, reset and Settings → Account."
        >
          <PasswordField
            id="doc-password"
            name="doc-password"
            label="Password"
            defaultValue="hunter2hunter2"
            hint="Case matters. Nothing else does."
          />
        </Specimen>
        <Specimen
          name="ComboField"
          klass=".field / .ctl / .combo"
          note="Searchable single-select (ARIA combobox) — ranked options, keyword matching for aliases (try typing 'toyoda'), arrow-key navigation, and an optional footer escape hatch. The Add Car vehicle picker is built from two of these."
        >
          <ComboDemo />
          <DialogDemo />
        </Specimen>
        <Specimen
          name="Field"
          klass=".field / .ctl / states"
          note="Microlabel + mono control on paper-deep + hint line. .ctl keeps a transparent 1px border at rest so invalid/ok borders paint without layout shift. Inline errors appear after blur, marked ▸."
        >
          <div className="space-y-4">
            <div className="field">
              <span className="microlabel">Asking price</span>
              <label className="ctl ctl--block flex items-center gap-2">
                <span className="ctl__prefix">$</span>
                <input
                  type="text"
                  defaultValue="620"
                  aria-label="Asking price"
                  readOnly
                  className="min-w-0 flex-1 bg-transparent outline-none"
                />
              </label>
              <span className="field__hint">Fair band for this part: $520–$680</span>
            </div>
            <div className="field is-invalid">
              <span className="microlabel">Title</span>
              <input className="ctl ctl--block" defaultValue="" aria-label="Title" readOnly />
              <span className="field__err">A part needs a name before it can list.</span>
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Counted field"
          klass="CountedField / .field__labelrow / .field__count"
          note="Labeled control with a live counter in the label row — only for fields with a real server-enforced limit (the max and the server check share a constant in src/lib/limits.ts). Controlled, so React 19 form resets can't desync counter and value."
        >
          <div className="field !mb-0">
            <span className="field__labelrow">
              <span className="microlabel">Title</span>
              <span aria-hidden="true" className="field__count">
                24 of 160
              </span>
            </span>
            <input
              className="ctl ctl--block"
              defaultValue="Downpipe + tune installed"
              aria-label="Title"
              readOnly
            />
          </div>
        </Specimen>
        <Specimen
          name="Checkbox & dropzone"
          klass="input.sq / .drop / .thumbs"
          note="16px square checks with live accent. The dropzone is the dashed r16 plate — live tint on dragover; thumbs grid at 84px with remove badges. Behavior (picker, drag-drop, busy state) ships as the DropZone component in src/components/ui."
        >
          <label className="mb-4 flex items-center gap-2">
            <input className="sq" type="checkbox" defaultChecked readOnly />{" "}
            <span className="microlabel !mb-0">Attach provenance</span>
          </label>
          <div className="drop !py-8">
            <span className="drop__mark" aria-hidden="true" />
            <h4>Drop photos here</h4>
            <p className="text-micro text-dim">First photo leads the listing.</p>
          </div>
        </Specimen>
        <Specimen
          name="Steps"
          klass=".steps / .step"
          note="Auto-numbered 01/02… counter rows, ruled. .is-now takes the live number; .is-done dims."
        >
          <div className="steps">
            <div className="step is-done">
              <span className="step__n" />
              <span className="step__t">Identify</span>
              <span className="step__d">Year, make, model, chassis.</span>
              <span className="chip chip--ok">Done</span>
            </div>
            <div className="step is-now">
              <span className="step__n" />
              <span className="step__t">Photos</span>
              <span className="step__d">Real light, real wear.</span>
              <span className="chip chip--live">Now</span>
            </div>
            <div className="step">
              <span className="step__n" />
              <span className="step__t">Publish</span>
              <span className="step__d">Public, or link-only.</span>
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Savebar"
          klass=".savebar"
          note="The dirty-flag bar: sticky at the bottom of settings (fixed full-width ≤720px), a tile with the baseline shadow-rule. Rendered inline here."
        >
          <div className="savebar !static !m-0">
            <span className="microlabel !mb-0">Unsaved changes on this sheet</span>
            <span className="flex gap-2">
              <button type="button" className="btn btn--ghost">
                Discard
              </button>
              <button type="button" className="btn btn--live">
                Save
              </button>
            </span>
          </div>
        </Specimen>
      </SpecimenGroup>

      {/* ============ 07 COMMERCE ============ */}
      <SpecimenGroup id="commerce" index="07" title="Commerce">
        <Specimen
          name="Market card"
          klass=".mkt > a.tile"
          note="The market grid: 3/2 cover, name first, then the price line — the card's single loudest element (20px mono 500, shipping docked as a quiet annotation) — one dot-separated meta line (never chips), and a hairline-divided seller footer. Non-active state rides the image as an ink flag. Grid steps 3 → 2 → 1 columns. Hover lifts the tile -2px."
        >
          <div className="mkt !grid-cols-2">
            <a className="tile" href="#commerce">
              <div className="tile__img aspect-[3/2]" />
              <div className="mkt__name">KW V3 coilovers, 32k mi</div>
              <p className="mkt__price">
                $1,240 <span className="mkt__ship">+ $60 ship</span>
              </p>
              <p className="mkt__metaline">Fits E46 M3 · Used — good · Portland</p>
              <span className="mkt__seller">
                <span className="monogram monogram--xs">TW</span>
                <span>T. Wilkins · 4.8 ★ · 23 reviews</span>
              </span>
            </a>
            <a className="tile" href="#commerce">
              <span className="tile__img relative block aspect-[3/2]">
                <span className="plate-undrawn absolute inset-0" />
                <span className="mkt__flag">Sold</span>
              </span>
              <div className="mkt__name">Recaro SR3 pair</div>
              <p className="mkt__price">$880</p>
              <p className="mkt__metaline">Used — fair · Leeds</p>
            </a>
          </div>
        </Specimen>
        <Specimen name="Shopping comparison card" klass="ListingCard variant=shopping" note="Full comparison facts, independent Save, contained image frame and honest missing-data states. Feed remains the default variant.">
          <div className="marketplace-grid"><Mosaic label="Shopping card specimens">
            <ListingCard variant="shopping" listing={{ id: "00000000-0000-4000-8000-000000000001", title: "Porsche 992 GT3 carbon bucket seats — pair, mounting hardware included", price_cents: 1150000, shipping_cents: 35000, shipping_mode: "flat", condition: "used", location: "Cologne, DE", cover_url: null, part_number: "992.881.105", seller: { name: "Example seller" }, source_car_name: "2022 Porsche 911 GT3", match_evidence: { kind: "source_model", label: "From the same vehicle model", detail: "Source build only; confirm compatibility." } }} save={{ isLoggedIn: false, path: "/marketplace" }} />
            <ListingCard variant="shopping" listing={{ id: "00000000-0000-4000-8000-000000000002", title: "Engine assembly with unknown part number", price_cents: 540000, shipping_mode: "pickup_only", condition: "for_parts", location: null, cover_url: null }} />
          </Mosaic></div>
        </Specimen>
        {/* ---- September 2026 direction, design proof (build plan, alongside
             M2). No production code: these two specimens exist to answer one
             question before WS9/WS10 and WS13 commit to a card — does the
             card survive the hardest case at the narrowest width it will ever
             be asked to hold? Everything here is the shipped component under
             deliberately brutal content. ---- */}
        <Specimen
          name="Two across on a phone — worst case"
          klass="ListingCard variant=shopping @ 163px"
          note="M-4 asks for four / three / two cards across; today the grid drops to ONE column under 480px, so two-across on a phone was unproven. MEASURED on /marketplace at 375px with the grid forced to two columns (2026-09-19): columns land at exactly 163.5px, and the cards come out 523–571px tall — a phone screen holds one and a half of them, which scans worse than the single column it replaces. Real titles run 3–6 lines and the worst case here runs eight, because .marketplace-card__title carries no line-clamp at all; the ragged bottoms are the direct consequence. The Save button survives at 130×44. WS9 has to add brand, part miles and a one-line description to this same box, so the honest conclusion is that two-across needs a title clamp (2 lines) and a shorter meta stack before the card can hold anything more — otherwise M-4's phone column should stay at one."
        >
          <div className="mx-auto w-[375px] border border-dashed border-[color:var(--rule-mid)] px-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <ListingCard
                variant="shopping"
                prefetch={false}
                listing={{
                  id: "00000000-0000-4000-8000-0000000000a1",
                  title:
                    "\u00d6hlins Road & Track coilover kit with DFV valving, 60N front springs and adjustable camber top mounts \u2014 complete",
                  price_cents: 1150000,
                  shipping_cents: 35000,
                  shipping_mode: "flat",
                  condition: "used",
                  location: "Kingston upon Thames, Greater London",
                  cover_url: null,
                  part_number: "OHL-992-RT-0041-AB",
                  seller: { name: "Aleksandra Wiśniewska-Nowak", rating: "4.9", review_count: 212 },
                  source_car_name: "2018 Lamborghini Huracán Performante",
                  match_evidence: {
                    kind: "source_model",
                    label: "From the same vehicle model",
                    detail: "Source build only; confirm compatibility.",
                  },
                }}
                save={{ isLoggedIn: false, path: "/marketplace" }}
              />
              <ListingCard
                variant="shopping"
                prefetch={false}
                listing={{
                  id: "00000000-0000-4000-8000-0000000000a2",
                  title: "Downpipe",
                  price_cents: 24000,
                  shipping_mode: "pickup_only",
                  condition: null,
                  location: null,
                  cover_url: null,
                  status_flag: "reserved",
                }}
                save={{ isLoggedIn: true, path: "/u/example/parts" }}
              />
            </div>
          </div>
        </Specimen>
        <Specimen
          name="The Explore card family, one footprint"
          klass="MosaicCell kind=car / update / part"
          note="E-1: one wall, every card the same footprint with a fixed caption block \u2014 no double-width cells, no text-only cells. E-2: the kinds differ by label and one line only (build \u2192 car and counts; update \u2192 title or first line and the car; part \u2192 price, Off {car}, cart). Shown here at the phone wall's two-column width with the longest content each kind can carry, so the caption block is tested where it is tightest rather than on a comfortable desktop row. OBSERVED on /explore at 375px (2026-09-19): the wall is already two columns on a phone, but the cells are NOT one footprint \u2014 a build cell sits noticeably shorter than the update beside it and the rows run ragged, which is exactly what E-1 rules out. The caption block has to become a fixed height per kind, not a natural one, and that is WS13's first job."
        >
          <div className="mx-auto w-[375px] border border-dashed border-[color:var(--rule-mid)] px-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <MosaicCell
                href="#commerce"
                size="sq"
                src="/seed/golf-r-3.jpg"
                alt="Gruene"
                eyebrow="Build"
                kind="car"
                corner="1w ago"
                headline="Gruene"
                value="2021 BMW M4 Competition xDrive"
                byline={{ name: "Aleksandra Wiśniewska-Nowak" }}
                meta="14 updates · 6 parts for sale"
              />
              <MosaicCell
                href="#commerce"
                size="sq"
                src="/seed/golf-r-1.jpg"
                alt="First real pass in the quarter"
                eyebrow="Update"
                kind="update"
                corner="4d ago"
                headline="First real pass in the quarter after the rebuild"
                lede="Stopped babying it. The flat-plane scream past the tree is worth every penny of the tire bill."
                byline={{ name: "Jade Whitfield" }}
                sub="2023 Chevrolet Corvette Z06"
              />
              <MosaicCell
                href="#commerce"
                size="sq"
                src="/seed/golf-r-2.jpg"
                alt="Öhlins coilover kit"
                eyebrow="For sale"
                kind="part"
                corner="1w ago"
                headline="Öhlins Road & Track coilover kit with DFV valving, complete"
                price="$11,500"
                detail={
                  <>
                    <span className="chip mcell__cond">Used</span> · Grade B
                  </>
                }
                detailBesidePrice
                byline={{ name: "Anjali Kumari" }}
                sub="2018 Lamborghini Huracán Performante"
              />
              <MosaicCell
                href="#commerce"
                size="sq"
                src={undefined}
                alt=""
                eyebrow="For sale"
                kind="part"
                corner="2m ago"
                headline="Downpipe"
                price="$240"
                detail={<span className="chip mcell__cond">Condition not given</span>}
                detailBesidePrice
                byline={{ name: "S" }}
                sub="Private build"
              />
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Before / after card"
          klass="MosaicCell compareSrc"
          note="An update that leads with a before/after plate keeps the pair on the wall: before under, after clipped to the right half over it, the plate's own divider and grip at the midline. Static on purpose — the slider lives on the post page — and no composite image is ever made; the card reuses the two originals. FeedMosaicCell derives it from the post's first media block (lib/activity-blocks leadingBeforeAfter)."
        >
          <div className="grid max-w-[520px] grid-cols-2 gap-3">
            <MosaicCell
              href="#commerce"
              size="sq"
              src="/seed/golf-r-1.jpg"
              compareSrc="/seed/golf-r-2.jpg"
              alt="Coilovers in"
              eyebrow="Update"
              kind="update"
              corner="6d ago"
              headline="Coilovers in — finally sits right"
              lede="HKS Hipermax in, alignment done, wheel gap gone."
              sub="1999 Nissan Silvia"
              meta="Kaito Nakamura"
            />
            <MosaicCell
              href="#commerce"
              size="sq"
              src="/seed/golf-r-3.jpg"
              alt="Track day"
              eyebrow="Update · 2 photos"
              kind="update"
              corner="1w ago"
              headline="Track day, first launch"
              lede="New PB and a master cylinder on order."
              sub="2022 Porsche 911 GT3"
              meta="Felix Brandt"
            />
          </div>
        </Specimen>
        <Specimen
          name="Feed cards"
          klass="MosaicCell lede / price / detail / byline / foot"
          note="The three discovery kinds from the Figma card set, one tile: kind pill and time, a fixed 5:3 plate, a caption head, and a foot anchored to the caption's floor. Build: name, then owner byline → activity line in the foot. Update: title → two-line excerpt, then owner byline → vehicle (mono) in the foot. For sale: title → price row (price in the OK colour, condition chip + grade beside it), then seller byline → source car in the foot, with the cart square at the end of the engagement strip. From a 232px content box the caption takes the rest of the row and the strip sits on the card's floor."
        >
          <div className="grid max-w-[880px] grid-cols-3 gap-3">
            <MosaicCell
              href="#commerce"
              size="sq"
              src="/seed/golf-r-3.jpg"
              alt="Gruene"
              eyebrow="Build"
              kind="car"
              corner="1w ago"
              headline="Gruene"
              value="2021 BMW M4 Competition"
              byline={{ name: "Marcus Reid" }}
              meta="3 updates · 2 parts for sale"
            />
            <MosaicCell
              href="#commerce"
              size="sq"
              src="/seed/golf-r-1.jpg"
              alt="First real pass in the quarter"
              eyebrow="Update"
              kind="update"
              corner="4d ago"
              headline="First real pass in the quarter"
              lede="Stopped babying it. The flat-plane scream past the tree is worth the tire bill."
              byline={{ name: "Jade Whitfield" }}
              sub="2023 Chevrolet Corvette Z06"
            />
            <MosaicCell
              href="#commerce"
              size="sq"
              src="/seed/golf-r-2.jpg"
              alt="Audi 4.2 FSI V8 intake manifold"
              eyebrow="For sale"
              kind="part"
              corner="1w ago"
              headline="Audi 4.2 FSI V8 intake manifold (B7 RS4), used"
              price="$120"
              detail={
                <>
                  <span className="chip mcell__cond">Used</span> · Grade B
                </>
              }
              detailBesidePrice
              byline={{ name: "Anjali Kumari" }}
              sub="2007 Audi RS4 Avant"
            />
          </div>
        </Specimen>
        <Specimen
          name="Stamp"
          klass=".stamp / --spent"
          note="The rotated frame stamped across settled things. Spent desaturates — a sold part stays on the sheet as history."
        >
          <div className="flex items-center gap-10 py-4">
            <span className="stamp">Sold</span>
            <span className="stamp stamp--spent">Lapsed</span>
          </div>
        </Specimen>
        <Specimen
          name="Buy sheet"
          klass=".sheetwrap / .sheet"
          note="Commit actions happen on a bottom sheet over a scrim — two steps (review, confirm), min(480px) wide. Not rendered live here; see any Buy or Release flow. The Dialog component wraps the same idiom."
        >
          <div className="rounded-ctl bg-paper-deep p-4">
            <div className="sheet__row flex items-baseline justify-between">
              <span className="microlabel !mb-0">Sabelt bucket seat</span>
              <span className="kv">$240.00</span>
            </div>
            <div className="sheet__row flex items-baseline justify-between">
              <span className="microlabel !mb-0">Shipping</span>
              <span className="kv">$24.00</span>
            </div>
            <div className="sheet__total flex items-baseline justify-between">
              <span className="microlabel !mb-0">Total</span>
              <span className="kv">
                <b>$264.00</b>
              </span>
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Mobile action bar"
          klass="MobileActionBar / .buybar / --wide"
          note="The persistent compact-screen action: fixed to the bottom edge, safe-area padded, with body clearance reserved by the stylesheet and the bar retiring exactly where the page's real controls regain a column (981px plain, 1024px wide — cart, checkout). For the highest-value action on a transaction surface only. Drawn static here; live on any PDP or the cart at phone width."
        >
          <div className="flex items-center gap-3 rounded-ctl border-t border-[color:var(--rule-mid)] bg-paper-deep px-4 py-3">
            <span className="buybar__total">
              <span className="microlabel">Total</span>
              <span className="buybar__price">$1,300.00</span>
            </span>
            <Button variant="live" className="min-w-0 flex-1">
              Proceed to checkout
            </Button>
          </div>
        </Specimen>
        <Specimen
          name="Bottom nav"
          klass="BottomNav / .bnav"
          note="The phone tab bar below 1081px: Explore · Marketplace · Home · Garage (signed out: Explore · Marketplace · Join). The current tab takes the rail's live tick on its top edge. One bottom surface per route, so it stands down on pages with a buybar, savebar or composer, on focused screens, and while the keyboard is up. Drawn static here; live at phone width."
        >
          <div className="rounded-ctl border-t border-[color:var(--rule-mid)] bg-tile px-2">
            <ul className="bnav__rows">
              {([
                ["Explore", "compass", false],
                ["Marketplace", "market", false],
                ["Home", "home", true],
                ["Garage", "garage", false],
              ] as const).map(([label, icon, here]) => (
                <li key={label}>
                  <span className={here ? "bnav__item is-here" : "bnav__item"}>
                    <span className="bnav__ico" aria-hidden="true">
                      <Icon name={icon} className="h-[20px] w-[20px]" />
                    </span>
                    <span className="bnav__label">{label}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Specimen>
        <Specimen
          name="Undrawn cover"
          klass=".plate-undrawn"
          note="A photoless listing cover takes the drafting-absence language scaled into a card: dashed construction rule, cross-hair. Declared unlayered in globals.css so it outranks the utility fallback."
        >
          <div className="plate-undrawn aspect-[3/1] rounded-ctl" />
        </Specimen>
      </SpecimenGroup>

      {/* ============ 08 COMMUNICATION & FEEDBACK ============ */}
      <SpecimenGroup id="comms" index="08" title="Communication & feedback">
        <Specimen name="Finder with Apply and Cancel" klass="FinderRefineSheet" note="A draft changes the results only on Apply. Cancel, Escape and dismissal restore the applied values; the active count describes those applied values."><FinderDemo /></Specimen>
        <Specimen
          name="Bottom sheet"
          klass="BottomSheet / .bsheet"
          note="The compact-screen sheet: the dialog plate risen from the bottom edge — full width, top corners at r16, safe-area padding, scrim behind, Esc/trap/restore like Dialog. Children stay mounted while closed so form fields keep submitting; with inlineFrom the chrome dissolves ≥640px and the children flow back inline. First consumer: the marketplace finder's refinements behind one Refine control. On phones it adds a quiet dismiss word; pass closeLabel={null} when the content already ends in its own Done/Cancel. Drawn static here."
        >
          <div className="bsheet is-open !static rounded-ctl p-4">
            <div className="bsheet__panel !max-h-none">
              <span className="microlabel">Refine</span>
              <SearchField label="Location" name="doc-loc" placeholder="Location" className="w-full" />
              <Button className="w-full">Done</Button>
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Alert"
          klass=".alert / --live / --ok"
          note="A tinted ground with a heading and body — never a side-bar stroke. Live for attention, ok for reassurance."
        >
          <div className="space-y-3">
            <div className="alert alert--live">
              <span className="alert__ico" aria-hidden="true">
                ●
              </span>
              <h4>Inspection window closes in 18 hours.</h4>
              <p>Confirm the part matches the listing, or open a dispute before the window ends.</p>
            </div>
            <div className="alert alert--ok">
              <span className="alert__ico" aria-hidden="true">
                ✓
              </span>
              <h4>Receipts are what make a part sell.</h4>
              <p>Parts released from receipted lines sell roughly twice as fast.</p>
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Discussion (Q&A, comments)"
          klass=".msg / --me / --sys / .composer"
          note="Public discussion only — listing Q&A and comments. A message here is an annotation in the margin: 2px left spine, mono author, sans body. --me turns the spine live; --sys dashes it. Private conversations use the Conversation grammar below."
        >
          <div className="thread">
            <div className="msg">
              <span className="msg__who">@peaks.gravel · 09:12</span>
              <p className="msg__body">Would you take $600 shipped?</p>
            </div>
            <div className="msg msg--me">
              <span className="msg__who">You · 09:15</span>
              <p className="msg__body">$620 and it goes out tomorrow.</p>
            </div>
            <div className="msg msg--sys">
              <span className="msg__who">System</span>
              <p className="msg__body">Offer of $620 recorded against this thread.</p>
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Conversation"
          klass=".convthread / .msgrun / .bubble / .tevent"
          note="One conversation is one person. MessageRun groups one side's consecutive messages under a single meta line (who · time · about tag); MessageBubble is an r16 plate — theirs tile, yours ink — with the joined corner tightened to r6. ThreadEvent is a fact, not speech: centred, dashed, r10. No tails, no pills."
        >
          <div className="convthread">
            <div className="convthread__day">
              <ThreadDivider>Tue 22 Sep</ThreadDivider>
            </div>
            <ThreadEvent>
              <span>
                <b>Kaito</b> shipped the Rays bronze 17x9 set
              </span>
            </ThreadEvent>
            <MessageRun who="Kaito" when="2026-09-22T16:53:00Z" whenLabel="4:53 pm" about="Rays wheels">
              <MessageBubble>These are on their way. Tires have maybe 60% left — fine for a few more track days.</MessageBubble>
            </MessageRun>
            <MessageRun me who="You" when="2026-09-22T17:02:00Z" whenLabel="5:02 pm" about="Seats" foot="Seen">
              <MessageBubble>Will do — double-wrapped with foam on the bolsters.</MessageBubble>
              <MessageBubble>Shipping Monday, I&apos;ll mark it here.</MessageBubble>
            </MessageRun>
            <ThreadEvent live>
              <span>
                <b>Imani</b> countered $6,200
              </span>
            </ThreadEvent>
          </div>
        </Specimen>
        <Specimen
          name="Chat composer"
          klass=".chatbox"
          note="Auto-growing field, 40px photo button, one Send that turns live when there is something to send. Enter sends on a mouse/keyboard device, Shift+Enter adds a line; on touch Return adds a line. Sticky to the viewport bottom in the product (static here)."
        >
          <div className="[&_.chatbox]:!static">
            <ChatComposerDemo />
          </div>
        </Specimen>
        <Specimen
          name="Inbox row · deal chips"
          klass=".convrow / .dealchip--move / --ok"
          note="One row per person — never per order or offer. The deals between you ride underneath as chips: side, part, where it stands. Red (move) means it's your turn; green (ok) means it's going well."
        >
          <div className="grid gap-1" style={{ maxWidth: 360 }}>
            <ConversationRow
              href="#annotation"
              active
              name="Kaito Nakamura"
              when="2026-09-24T05:53:00Z"
              whenLabel="4d"
              preview="Excited for these. Could you wrap the bolster edges when you pack them?"
              unread={1}
              deals={
                <>
                  <DealChip side="selling" title="E46 M3 front sport seats" label="Ship it" tone="move" />
                  <DealChip side="buying" title="Rays bronze 17x9 set" label="On its way" tone="ok" />
                </>
              }
            />
            <ConversationRow
              href="#annotation"
              name="Lena Park"
              when="2026-09-24T18:53:00Z"
              whenLabel="4d"
              preview="You: Shipping to the UK is closer to $180 for this…"
              deals={<DealChip side="selling" title="Big brake kit" label="Offer expired" />}
            />
          </div>
        </Specimen>
        <Specimen
          name="Deal card · offer card"
          klass=".dealcard / .offercard"
          note="DealCard heads a conversation: part photo, 'Selling · Paid', title link, price, one action. OfferCard puts a live offer's decision where it's being discussed (wired as OfferDecision); --move borders it live when the decision is yours."
        >
          <div className="grid gap-3" style={{ maxWidth: 460 }}>
            <DealCard
              href="#annotation"
              title="E46 M3 front sport seats, black leather, pair"
              eyebrow="Selling · Ship it"
              amount="$1,130"
              tone="move"
              action={<span className="btn">Mark shipped</span>}
            />
            <OfferCard eyebrow="Imani countered · Akrapovič exhaust" amount="$6,200" note="You offered $5,900. Decide in 2 days." move>
              <div className="flex flex-wrap gap-2">
                <span className="btn btn--live">Accept $6,200</span>
                <span className="relbtn !static">Withdraw offer</span>
              </div>
            </OfferCard>
          </div>
        </Specimen>
        <Specimen
          name="Offer round"
          klass="OfferRound / .oround / .viaagent"
          note="One move in an offer's history. Who acted is a role (You, Your agent, Buyer, Buyer's agent); an agent's turn ends its amount line with a muted '· via agent' — same face and colour, no badge or icon. Only the viewer's own agent's turns carry the one-line reason. Stacked on phones, a row from 640px."
        >
          <ol className="rowlist" style={{ maxWidth: 560 }}>
            <OfferRound who="Buyer's agent made an offer" amount="$232" when="17 Oct, 09:02" viaAgent />
            <OfferRound who="Your agent countered" amount="$245" when="17 Oct, 09:02" viaAgent reason="Opened at your $245 target. Their $232 is $2 above your minimum." />
            <OfferRound who="Buyer countered — offer 3 of 3" amount="$239" when="Today, 08:15" />
            <OfferRound who="You accepted" when="Today, 08:31" />
          </ol>
        </Specimen>
        <Specimen
          name="Agent header"
          klass="AgentHeader / .pagehead"
          note="The agent's own head: 'Agent' with a Beta label until auto-accept graduates, and one status line. The /agent tab today; the desktop side panel reuses it when chat arrives (A3c)."
        >
          <AgentHeader status="Handling offers on 3 listings · 2 need you" />
        </Specimen>
        <Specimen
          name="Mail preview"
          klass=".mail"
          note="The ONLY framed component in the system — the 1px rule-mid frame marks it as an external artifact (an email), not a surface of the sheet."
        >
          <div className="mail">
            <div className="mail__bar">
              <span className="microlabel !mb-0">DRVN · No-reply</span>
              <span className="mail__subj">Your offer was accepted</span>
              <span className="microlabel !mb-0">07:52</span>
            </div>
            <div className="mail__body">
              <p>The seller accepted $620. A job card is open; the part ships once tracking is added.</p>
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Toast"
          klass=".toast"
          note="A fixed bottom ink band, mono uppercase, role=status, 3200ms dwell. Wraps at 60ch. Rendered statically here — in the product it travels in on --t-move."
        >
          <span className="toast !static !translate-x-0">Saved — sheet up to date</span>
        </Specimen>
      </SpecimenGroup>

      {/* ============ 09 STATES ============ */}
      <SpecimenGroup id="states" index="09" title="States">
        <Specimen
          name="Undrawn plate"
          klass=".undrawn / --hero"
          note="Empty keeps the geometry of full: a dashed plate with a cross-hair mark and factual copy naming the action that fills it."
        >
          <div className="undrawn">
            <span className="undrawn__mark" aria-hidden="true" />
            <h3>No offers yet</h3>
            <p>Your listing is live. Offers land here as work orders.</p>
          </div>
        </Specimen>
        <Specimen
          name="Ghost loading"
          klass=".ghostrow / .gbar / .gbox"
          note="Loading is the drawing being sketched — ruled skeleton rows with a 1.5s sweep. Never spinners."
        >
          <div className="is-loading">
            <div className="ghostrow" aria-hidden="true">
              <div className="gbox" />
              <div className="stack">
                <div className="gbar" />
                <div className="gbar gbar--sm" />
              </div>
              <div className="gbar gbar--sm" />
            </div>
            <div className="ghostrow" aria-hidden="true">
              <div className="gbox" />
              <div className="stack">
                <div className="gbar" />
                <div className="gbar gbar--sm" />
              </div>
              <div className="gbar gbar--sm" />
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Blank values"
          klass="—  /  $0.00"
          note="An empty value is an em dash; empty money is $0.00 — factual, never cute. Zero-count KPIs still render their livedim."
        >
          <div className="flex flex-wrap gap-10">
            <div className="livedim livedim--blank">
              <span className="livedim__tick" aria-hidden="true" />
              <span className="microlabel">Watchers</span>
              <span className="val">—</span>
            </div>
            <div className="livedim">
              <span className="livedim__tick" aria-hidden="true" />
              <span className="microlabel">Booked payout</span>
              <span className="val">$0.00</span>
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Truncation"
          klass=".clamp2 / .trunc"
          note="Long content is clamped explicitly, never allowed to wrap a row off its grid."
        >
          <p className="clamp2 max-w-[320px] text-micro">
            Genuine BBS RS 3-piece wheels, 16x8 et24, freshly rebuilt with new bolts, lips
            polished, barrels powder-coated, includes original centre caps and the receipts for
            every part of the rebuild since 2019.
          </p>
        </Specimen>
      </SpecimenGroup>

      {/* ============ 10 EXTRACTED CONTRACTS ============ */}
      <SpecimenGroup id="contracts" index="10" title="Extracted contracts — production components, rendered live">
        <Specimen
          name="PageHead"
          klass="PageHead → .pagehead"
          note="The page header as a contract — eyebrow, h1, sub. reveal defaults on; the specimen renders it static."
        >
          <PageHead reveal={false} className="!p-0" eyebrow="Sheet 01 — Your desk" title={<>Your sheet is <span className="live-word">moving</span></>} sub="Three offers open, one payout booked." />
        </Specimen>
        <Specimen
          name="TileHead"
          klass="TileHead → .tile__head"
          note="Ink microlabel left, chip/jumplink right — the rule line every tile opens with."
        >
          <div className="tile !p-4">
            <TileHead label="Your garage" end={<span className="chip">3 cars</span>} />
          </div>
        </Specimen>
        <Specimen
          name="EmptyState"
          klass="EmptyState → .undrawn"
          note="Every empty collection speaks through one component: dashed mark, title, body, optional action."
        >
          <EmptyState mark="⌕" title="Nothing for sale right now">
            Parts listed off these cars show up here.
          </EmptyState>
        </Specimen>
        <Specimen
          name="Alert"
          klass="Alert → .alert / --live / --ok"
          note="tone=live when the reader must act now, ok for confirmation. role=alert only when raised by an action."
        >
          <div className="grid gap-3">
            <Alert ico="✓" tone="ok" title="Draft saved">Your listing is safe — publish when ready.</Alert>
            <Alert tone="live" title="Payouts aren&rsquo;t set up yet">Publishing needs somewhere to send the money.</Alert>
          </div>
        </Specimen>
        <Specimen
          name="Stepper"
          klass="Stepper → .steps"
          note="Auto-numbered workflow rail; aria-current lands on the now step. Workflow state stays with the feature."
        >
          <Stepper
            label="Checkout progress"
            steps={[
              { label: "Shipping", state: "done", end: <span className="chip chip--ok">Done</span> },
              { label: "Payment", state: "now" },
              { label: "Confirm", state: "todo" },
            ]}
          />
        </Specimen>
        <Specimen
          name="DataRow"
          klass="DataRow → .bline / .bline--ctl"
          note="One component, two shapes: read-only value row, or a labelled control row when children carry a .ctl."
        >
          <div>
            <DataRow label="Email" value="nb@drvn.test" />
            <DataRow label="Display name" note="Shown on your public profile">
              <input className="ctl" defaultValue="Neil B" readOnly />
            </DataRow>
          </div>
        </Specimen>
        <Specimen
          name="MetricCard"
          klass="MetricCard → .tile + .num-giant"
          note="KPI tile: microlabel, giant numeral, a LiveDim underneath, floor-pinned footer link. Calculations stay feature-local."
        >
          <div className="deck deck--kpi">
            <MetricCard label="Active listings" value={7} stagger={0}>
              <LiveDim label="On the marketplace" value="7 live · 12 total" />
            </MetricCard>
            <MetricCard label="Offers" live valueLive value={3} stagger={1}>
              <LiveDim label="Oldest lapses in" value="2:14:09" live />
            </MetricCard>
            <MetricCard label="Watchers" blank value="—" stagger={2}>
              <LiveDim label="Nothing measured yet" value="—" blank />
            </MetricCard>
          </div>
        </Specimen>
        <Specimen
          name="RatingStars"
          klass="RatingStars → .review__stars"
          note="Read-only display with sr-only value; the compact string comes from ratingLine(). The interactive picker stays the review form&rsquo;s .star-pick."
        >
          <div className="flex items-center gap-4">
            <RatingStars rating={4} />
            <span className="kv text-dim">4.8 ★ · 12 reviews</span>
          </div>
        </Specimen>
        <Specimen
          name="ObjectRow"
          klass="ObjectRow → .order in .rowlist"
          note="The structural dense row — media plate, name, meta, trailing actions. Domain rows (ListingRow, offer rows) compose it; it never knows business meaning."
        >
          <div className="rowlist">
            <ObjectRow
              title="BBS RS 16x8 et24 — pair"
              meta="$1,450 · Off a 1991 E30 318is"
              actions={<span className="chip chip--live">Live</span>}
            />
            <ObjectRow
              state="done"
              title="Recaro SR3 — driver&rsquo;s seat"
              meta="Delivered 14 Aug"
              actions={<span className="chip chip--ok">Done</span>}
            />
          </div>
        </Specimen>
        <Specimen
          name="Message thread"
          klass="MessageThread / Message / ThreadDivider → .thread / .msg"
          note="The conversation grammar shared by order messages, offer threads, Q&A and comments. Features decide what me means (current user, or the seller in Q&A). The send row is MessageComposer (.composer__row) — it needs a live action, so it isn&rsquo;t mounted here."
        >
          <MessageThread>
            <ThreadDivider>Today</ThreadDivider>
            <Message who="Kaito" when="2026-08-23T10:00:00Z" whenLabel="10:00" body="Does the diff include the output flanges?" />
            <Message me who="You" when="2026-08-23T10:04:00Z" whenLabel="10:04" body="Yes — flanges and fresh crush washers." />
            <Message who="Kaito" whoEnd={<span className="chip chip--ok ml-2 normal-case">Seller</span>} body="Marked as answered." meta="Aug 23, 10:06 AM" />
          </MessageThread>
        </Specimen>
        <Specimen
          name="ResultNote"
          klass="ResultNote → chip--ok / .field__err"
          note="The action-outcome line every commerce form used to hand-roll: ok chip or error text, role=alert."
        >
          <div className="flex flex-wrap items-center gap-4">
            <ResultNote ok="Message sent." />
            <ResultNote error="That didn&rsquo;t send — try again." />
          </div>
        </Specimen>
        <Specimen
          name="UnconfirmedOutcome"
          klass="UnconfirmedOutcome → .field__err + .jumplink"
          note="A lost Server Action response: the outcome is unknown, so the money or destructive action is replaced by a reload, never offered again blindly."
        >
          <UnconfirmedOutcome>
            Couldn&rsquo;t confirm whether the label was bought. Reload before trying again.
          </UnconfirmedOutcome>
        </Specimen>
        <Specimen
          name="FormSection + ValidationSummary"
          klass="FormSection / ValidationSummary"
          note="Long workflows are numbered sections; failed submits get an assertive summary with per-field jump links while fields keep their inline errors."
        >
          <div className="grid gap-3">
            <ValidationSummary entries={[{ anchor: "spec-title", label: "Title", message: "Give the part a name." }]} />
            <FormSection step={1} title="The part — what you&rsquo;re releasing" hint="Name it the way a buyer would search.">
              <TextField id="spec-title" label="Title" placeholder="BBS RS 16x8 et24" />
            </FormSection>
          </div>
        </Specimen>
        <Specimen
          name="Order status"
          klass="StatusChip / OrderPipeline → @/components/commerce"
          note="Commerce domain patterns — the lifecycle chip shared by Orders and Offers (it used to live inside the Orders route), and the .pipe stage rail."
        >
          <div className="flex flex-wrap items-center gap-5">
            <StatusChip status="paid" />
            <StatusChip status="pending" />
            <StatusChip status="cancelled" />
            <OrderPipeline status="shipped" />
          </div>
        </Specimen>
        <Specimen
          name="Badges — kind and state"
          klass="Badge / KindBadge → @/components/ui"
          note="One badge system for cards. Kind (Build · Update · For sale) is a neutral outline with the segment icon, the same everywhere. State is a tint: neutral for a plain fact (Used, Grade B), colour only for real state (live, sold)."
        >
          <div className="flex flex-wrap items-center gap-3">
            <KindBadge kind="car" />
            <KindBadge kind="update" />
            <KindBadge kind="part" />
            <Badge>Used</Badge>
            <Badge>Grade B</Badge>
            <Badge tone="live">Live</Badge>
            <Badge tone="spent">Sold</Badge>
          </div>
        </Specimen>
      </SpecimenGroup>

      {/* ============ 11 COMPONENT REGISTRY ============ */}
      <section id="react" className="scroll-mt-24 pb-8">
        <div className="mb-3 mt-8 flex items-baseline gap-3">
          <span className="microlabel microlabel--ink !mb-0">11</span>
          <span className="microlabel !mb-0">
            Component registry — rendered from src/components/registry.ts
          </span>
        </div>
        <div className="is-in mb-4" aria-hidden="true">
          <div className="dimline-h" />
        </div>
        {(["primitive", "pattern", "feature"] as const).map((layer) => (
          <div key={layer} className="tile mb-4">
            <TileHead
              label={
                layer === "primitive"
                  ? "Primitives — generic Livesheet contracts"
                  : layer === "pattern"
                    ? "Product patterns — DRVN object representations"
                    : "Features — workflows, documented for discoverability"
              }
              end={
                <span className="chip">
                  {COMPONENT_REGISTRY.filter((e) => e.layer === layer).length}
                </span>
              }
            />
            <table className="spec w-full">
              <tbody>
                {COMPONENT_REGISTRY.filter((e: RegistryEntry) => e.layer === layer)
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((entry) => (
                    <tr key={entry.name}>
                      <td>
                        {entry.name}
                        {entry.status !== "active" && (
                          <span className="chip chip--spent ml-2">{entry.status}</span>
                        )}
                        <span className="block text-dim">{entry.importPath}</span>
                      </td>
                      <td>
                        {entry.description}
                        <span className="block text-dim">
                          Use: {entry.use}
                          {entry.avoid ? ` — Not for: ${entry.avoid}` : ""}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
        <p className="mt-3 text-micro leading-relaxed text-dim">
          Rule: a new reusable component lands in src/components/ui (primitive) or
          src/components/commerce (domain pattern), gets a class in globals.css if it needs
          one, an entry in src/components/registry.ts, and a specimen above.
          registry.test.ts fails the build when a public export has no entry (or an entry
          points nowhere); npm run docs:components regenerates the markdown twin.
        </p>
      </section>
    </>
  );
}
