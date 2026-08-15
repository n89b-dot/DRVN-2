import Link from "next/link";

import { REFERENCE_DOCS, SITE_PAGES } from "@/lib/docs/site";

import { DocsPagehead, Rule } from "../_components/docs-page";

export const metadata = { title: "Docs - DRVN" };

const SECTION_CARDS = [
  {
    href: "/docs/brand",
    n: "01",
    title: "Brand",
    note: "The name, the wordmark, the voice, both palettes, photography.",
  },
  {
    href: "/docs/design-system",
    n: "02",
    title: "Design system",
    note: "How Livesheet functions — tokens, day/night theming, geometry, motion.",
  },
  {
    href: "/docs/typography",
    n: "03",
    title: "Typography",
    note: "IBM Plex Sans and Mono, the full scale, and where each tier is used.",
  },
  {
    href: "/docs/components",
    n: "04",
    title: "Components",
    note: "Every component in the system, categorized and rendered live.",
  },
  {
    href: "/docs/patterns",
    n: "05",
    title: "Patterns",
    note: "Route map, commerce flows, empty states, the form-state ladder.",
  },
  {
    href: "/docs/rules",
    n: "06",
    title: "Rules",
    note: "The do/don't contract, accessibility, content and engineering rules.",
  },
];

export default function DocsHome() {
  return (
    <>
      <DocsPagehead
        index="00"
        liveWord="Everything"
        titleRest="about how DRVN is drawn"
        mdSlug="index"
        sub="Brand, design system, type, components, patterns and rules — one front door, in HTML for people and markdown for agents."
      />

      <div className="deck deck--three">
        {SECTION_CARDS.map((card) => (
          <Link key={card.href} href={card.href} className="tile tile--hover">
            <div className="tile__head">
              <span className="microlabel microlabel--ink !mb-0">{card.n}</span>
              <span className="tile__go" aria-hidden="true">
                ↗
              </span>
            </div>
            <h2 className="text-section font-semibold tracking-tight">{card.title}</h2>
            <p className="mt-1 text-micro leading-relaxed text-dim">{card.note}</p>
          </Link>
        ))}
      </div>

      <section className="mt-10">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">For LLMs and agents</span>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--two">
          <div className="tile">
            <div className="tile__head">
              <span className="microlabel !mb-0">Markdown twins</span>
              <span className="kv">/docs/md/&lt;slug&gt;</span>
            </div>
            <p className="text-micro leading-relaxed text-dim">
              Every page here has a plain-markdown twin served with{" "}
              <span className="kv">text/markdown</span>. Fetch{" "}
              <Link className="jumplink" href="/docs/llms.txt">
                /docs/llms.txt
              </Link>{" "}
              once for the full index, then read any document as raw text — no HTML parsing
              needed.
            </p>
          </div>
          <div className="tile">
            <div className="tile__head">
              <span className="microlabel !mb-0">Reference library</span>
              <span className="kv">raw markdown</span>
            </div>
            <div className="rowlist">
              {REFERENCE_DOCS.map((doc) => (
                <div key={doc.slug} className="flex items-baseline justify-between gap-3 border-t border-rule-soft py-2 first:border-t-0 first:pt-0">
                  <Link className="jumplink" href={`/docs/md/${doc.slug}`}>
                    {doc.title}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-10">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Index</span>
          <span className="microlabel !mb-0">{SITE_PAGES.length + REFERENCE_DOCS.length} documents</span>
        </div>
        <Rule className="mb-4" />
        <div className="tile">
          <table className="spec w-full">
            <tbody>
              {SITE_PAGES.map((page) => (
                <tr key={page.slug}>
                  <td>
                    <Link className="jumplink" href={page.slug === "index" ? "/docs" : `/docs/${page.slug}`}>
                      {page.title}
                    </Link>
                  </td>
                  <td>
                    <Link className="jumplink" href={`/docs/md/${page.slug}`}>
                      md ↗
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
