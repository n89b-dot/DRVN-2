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
          { href: "#react", label: "10 React" },
        ]}
      />

      {/* ============ 01 CHROME & NAVIGATION ============ */}
      <SpecimenGroup id="chrome" index="01" title="Chrome & navigation">
        <Specimen
          name="Top bar"
          klass=".bar"
          note="Sticky, 86% paper + blur(14px). Logo carries the live full stop; links are mono 12.5 uppercase; .is-active gets the ink ground. The bar above this page is the docs variant of the same idiom. ≤640px the nav becomes one scrollable row."
        >
          <div className="flex items-center justify-between rounded-ctl bg-paper px-4 py-3">
            <span className="bar__logo !text-[15px]">
              DRVN<em>.</em> <span className="microlabel">Parts marketplace</span>
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
          note="The menu is a second sheet unrolled over the page — numbered rows with a note; the current row chips 'Here'. Same numbering language as the signed-in rail."
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
          note="THE tab replacement. A drawing shows everything at once and tells you where to look — no pill tabs, no segmented controls. Every section keeps a real anchor."
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
            <h1 className="!text-[28px]">
              Your sheet is <span className="live-word">moving</span>
            </h1>
            <p className="sub !mt-2 !text-[14px]">Three offers open, one payout booked.</p>
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
            <div className="grid h-12 place-items-center rounded-ctl bg-paper-deep text-[11px] text-dim">
              1
            </div>
            <div className="grid h-12 place-items-center rounded-ctl bg-paper-deep text-[11px] text-dim">
              2
            </div>
            <div className="grid h-12 place-items-center rounded-ctl bg-paper-deep text-[11px] text-dim">
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
                <span className="num-giant !text-[34px]">8,412</span>
                <span className="microlabel">Parts on the sheets</span>
              </div>
              <div>
                <span className="num-giant !text-[34px]">$1.2M</span>
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
          klass=".btn / --live / --ghost"
          note="Mono uppercase in drafting brackets ([ ]) drawn by pseudos; press scales to .97. One --live per surface. No spinner variant — pending states resolve to a chip."
        >
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn">
              Counter
            </button>
            <button type="button" className="btn btn--live">
              Accept $240
            </button>
            <button type="button" className="btn btn--ghost">
              Pass
            </button>
            <button type="button" className="btn" disabled>
              Disabled
            </button>
          </div>
        </Specimen>
        <Specimen
          name="Chip"
          klass=".chip / --live --ok --warn --ink --spent"
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
          klass=".filters / .fbtn / .search"
          note=".is-on takes the ink ground; the fitment switch uses [aria-pressed=true] in live. All chips meet the 44px touch floor."
        >
          <div className="filters mb-3">
            <button type="button" className="fbtn is-on">
              Suspension
            </button>
            <button type="button" className="fbtn">
              Brakes
            </button>
            <button type="button" className="fbtn" aria-pressed="true">
              Fits my car
            </button>
          </div>
          <label className="search w-full">
            <input type="text" defaultValue="dogleg gearbox" aria-label="Search parts" readOnly />
          </label>
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
                <span className="order__name text-[14px]">@garage.iida</span>
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
          name="Checkbox & dropzone"
          klass="input.sq / .drop / .thumbs"
          note="16px square checks with live accent. The dropzone is the dashed r16 plate — live tint on dragover; thumbs grid at 84px with remove badges."
        >
          <label className="mb-4 flex items-center gap-2">
            <input className="sq" type="checkbox" defaultChecked readOnly />{" "}
            <span className="microlabel !mb-0">Attach provenance</span>
          </label>
          <div className="drop !py-8">
            <span className="drop__mark" aria-hidden="true" />
            <h4>Drop photos here</h4>
            <p className="text-[12.5px] text-dim">First photo leads the listing.</p>
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
          note="The market grid: 3/2 cover, name, mono price, meta chips. Grid steps 3 → 2 → 1 columns. Hover lifts the tile -2px."
        >
          <div className="mkt !grid-cols-2">
            <a className="tile" href="#commerce">
              <div className="tile__img aspect-[3/2]" />
              <div className="mkt__name">KW V3 coilovers, 32k mi</div>
              <div className="mkt__price">$1,240</div>
              <div className="mkt__meta">
                <span className="chip">E46 M3</span>
                <span className="chip chip--ok">Receipts</span>
              </div>
            </a>
            <a className="tile" href="#commerce">
              <div className="plate-undrawn tile__img aspect-[3/2]" />
              <div className="mkt__name">Recaro SR3 pair</div>
              <div className="mkt__price">$880</div>
              <div className="mkt__meta">
                <span className="chip chip--live">3 offers</span>
              </div>
            </a>
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
          name="Undrawn cover"
          klass=".plate-undrawn"
          note="A photoless listing cover takes the drafting-absence language scaled into a card: dashed construction rule, cross-hair. Declared unlayered in globals.css so it outranks the utility fallback."
        >
          <div className="plate-undrawn aspect-[3/1] rounded-ctl" />
        </Specimen>
      </SpecimenGroup>

      {/* ============ 08 COMMUNICATION & FEEDBACK ============ */}
      <SpecimenGroup id="comms" index="08" title="Communication & feedback">
        <Specimen
          name="Alert"
          klass=".alert / --live / --ok"
          note="A tinted ground with a heading and body — never a side-bar stroke. Live for attention, ok for reassurance."
        >
          <div className="space-y-3">
            <div className="alert alert--live">
              <h4>Inspection window closes in 18 hours.</h4>
              <p>Confirm the part matches the listing, or open a dispute before the window ends.</p>
            </div>
            <div className="alert alert--ok">
              <h4>Receipts are what make a part sell.</h4>
              <p>Parts released from receipted lines sell roughly twice as fast.</p>
            </div>
          </div>
        </Specimen>
        <Specimen
          name="Messages"
          klass=".msg / --me / --sys / .composer"
          note="No chat bubbles. A message is an annotation in the margin: 2px left spine, mono author, sans body. --me turns the spine live; --sys dashes it."
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
          note="A fixed bottom ink band, mono uppercase, role=status, 2600ms dwell. Rendered statically here — in the product it travels in on --t-move."
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
          <p className="clamp2 max-w-[320px] text-[13.5px]">
            Genuine BBS RS 3-piece wheels, 16x8 et24, freshly rebuilt with new bolts, lips
            polished, barrels powder-coated, includes original centre caps and the receipts for
            every part of the rebuild since 2019.
          </p>
        </Specimen>
      </SpecimenGroup>

      {/* ============ 10 REACT COMPONENTS ============ */}
      <section id="react" className="scroll-mt-24 pb-8">
        <div className="mb-3 mt-8 flex items-baseline gap-3">
          <span className="microlabel microlabel--ink !mb-0">10</span>
          <span className="microlabel !mb-0">React components — src/components/ui</span>
        </div>
        <div className="is-in mb-4" aria-hidden="true">
          <div className="dimline-h" />
        </div>
        <div className="tile">
          <table className="spec w-full">
            <tbody>
              <tr>
                <td>livesheet-bar.tsx</td>
                <td>LivesheetBar (product chrome, index sheet, theme toggle) · Foot · BAR_ROUTES</td>
              </tr>
              <tr>
                <td>app-shell.tsx</td>
                <td>AppShell — signed-in rail + content</td>
              </tr>
              <tr>
                <td>icons.tsx</td>
                <td>Icon — the stroke icon set (IconName union)</td>
              </tr>
              <tr>
                <td>category-icon.tsx</td>
                <td>CategoryIcon — part-category glyphs</td>
              </tr>
              <tr>
                <td>listing-card.tsx</td>
                <td>ListingCard — the .mkt tile from ListingCardData</td>
              </tr>
              <tr>
                <td>feed-card.tsx</td>
                <td>FeedCard · MasonryFeed — explore cards + masonry</td>
              </tr>
              <tr>
                <td>primitives.tsx</td>
                <td>
                  NarrowColumn · Avatar · Media (fallbackClassName for undrawn covers) ·
                  MetadataTags · SectionLabel · HorizontalGallery · TabNav
                </td>
              </tr>
              <tr>
                <td>patterns.tsx</td>
                <td>
                  LinkedTitle · TimelineRow · WebsitePill · ProfileHeader · VehicleGallery ·
                  KeyValueTable · EmbeddedVideo · SectionHeading
                </td>
              </tr>
              <tr>
                <td>dialog.tsx</td>
                <td>Dialog — modal on the sheet idiom</td>
              </tr>
              <tr>
                <td>sheet-tabs.tsx</td>
                <td>SheetTabs · resolveTab — URL-driven jumprow tabs</td>
              </tr>
              <tr>
                <td>toast.tsx / skeleton.tsx</td>
                <td>Toast (role=status) · Skeleton ghost blocks</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-[12.5px] leading-relaxed text-dim">
            Rule: product pages and this board import the same source. A new component lands in
            src/components/ui, gets a class in globals.css if it needs one, a row in this table,
            and a specimen above.
          </p>
        </div>
      </section>
    </>
  );
}
