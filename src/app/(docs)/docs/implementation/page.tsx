import { DocsJumprow, DocsPagehead, Rule } from "../../_components/docs-page";
import {
  GROUPS,
  IMPLEMENTATION_REGISTRY,
  STATUS_CHIP,
  STATUS_LABEL,
  initiativesFor,
  statusCounts,
  type Initiative,
  type InitiativeStatus,
} from "@/lib/docs/implementation-registry";

export const metadata = { title: "Implementation" };

/**
 * The living implementation artifact — renders straight from
 * `src/lib/docs/implementation-registry.ts`, the single source of truth for
 * the platform-evolution workstream. Update the registry, not this page.
 */

const STATUS_ORDER: InitiativeStatus[] = [
  "validated",
  "implemented",
  "in-progress",
  "planned",
  "blocked-external",
  "deferred",
];

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="text-micro leading-relaxed">
      <span className="microlabel microlabel--ink !mb-0 mr-2">{label}</span>
      <span className="text-dim">{children}</span>
    </p>
  );
}

function InitiativeTile({ item }: { item: Initiative }) {
  return (
    <section id={item.id} className="tile scroll-mt-24">
      <div className="tile__head">
        <span className="microlabel !mb-0">{item.name}</span>
        <span className="flex items-center gap-2">
          <span className="kv">§{item.brief}</span>
          <span className={STATUS_CHIP[item.status]}>{STATUS_LABEL[item.status]}</span>
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <Fact label="Benefit">{item.benefit}</Fact>
        <Fact label="Today">{item.existsToday}</Fact>
        <Fact label="Changing">{item.changing}</Fact>
        <Fact label="Approach">{item.approach}</Fact>
        {item.surfaces.length > 0 ? (
          <Fact label="Surfaces">
            {item.surfaces.map((surface, index) => (
              <span key={surface}>
                {index > 0 ? " · " : null}
                <span className="font-mono">{surface}</span>
              </span>
            ))}
          </Fact>
        ) : null}
        {item.dependsOn?.length ? (
          <Fact label="Depends on">
            {item.dependsOn.map((dep, index) => (
              <span key={dep}>
                {index > 0 ? " · " : null}
                <a className="jumplink" href={`#${dep}`}>
                  {dep}
                </a>
              </span>
            ))}
          </Fact>
        ) : null}
        {item.uxRules?.length ? <Fact label="UX rules">{item.uxRules.join(" ")}</Fact> : null}
        {item.decisions?.length ? <Fact label="Decisions">{item.decisions.join(" ")}</Fact> : null}
        <Fact label="Validation">{item.validation}</Fact>
        {item.externalStep ? <Fact label="External step">{item.externalStep}</Fact> : null}
      </div>
    </section>
  );
}

export default function ImplementationPage() {
  const counts = statusCounts();
  const total = IMPLEMENTATION_REGISTRY.length;

  return (
    <>
      <DocsPagehead
        index="09"
        liveWord="Implementation"
        titleRest="— the living record"
        mdSlug="implementation"
        sub="The platform-evolution workstream, rendered from src/lib/docs/implementation-registry.ts. Statuses are honest: Implemented means the code compiles green; Validated means the tests and responsive checks actually ran."
      />

      <div className="tile mb-6">
        <div className="tile__head">
          <span className="microlabel !mb-0">Overall progress</span>
          <span className="kv">{total} initiatives</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => (
            <span key={status} className="flex items-center gap-2">
              <span className={STATUS_CHIP[status]}>{STATUS_LABEL[status]}</span>
              <span className="text-micro text-dim">{counts[status]}</span>
            </span>
          ))}
        </div>
      </div>

      <DocsJumprow
        items={GROUPS.filter((group) => initiativesFor(group.id).length > 0).map((group) => ({
          href: `#group-${group.id}`,
          label: group.title,
        }))}
      />

      {GROUPS.map((group) => {
        const items = initiativesFor(group.id);
        if (items.length === 0) return null;
        return (
          <section
            key={group.id}
            id={`group-${group.id}`}
            className="scroll-mt-24 pb-[clamp(24px,3vw,40px)]"
          >
            <div className="mb-1 mt-8 flex items-baseline gap-3">
              <span className="microlabel microlabel--ink !mb-0">{group.index}</span>
              <h2 className="text-section font-[600] leading-[1.3] tracking-[-0.01em]">
                {group.title}
              </h2>
            </div>
            <p className="mb-3 text-micro text-dim">{group.sub}</p>
            <Rule className="mb-4" />
            <div className="deck deck--two">
              {items.map((item) => (
                <InitiativeTile key={item.id} item={item} />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
