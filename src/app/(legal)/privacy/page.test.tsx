import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MODEL_TOOLS } from "@/lib/capabilities/registry";
import PrivacyPage from "./page";

/** What the page says, as a member reads it: entities decoded, tags dropped. */
function text(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;|“|”/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const page = text(renderToStaticMarkup(<PrivacyPage />));

describe("the agent's privacy promise matches the code (N422)", () => {
  it("says the details of a pasted product page go to the model, because read_part_link sends them", () => {
    // read_part_link fetches a page the member linked and returns its title,
    // brand, part number and category to the model (src/lib/capabilities/build.ts).
    expect([...MODEL_TOOLS.buyer, ...MODEL_TOOLS.garage]).toContain("read_part_link");
    expect(page).toMatch(
      /If you paste a link to a product page, DRVN fetches that page and sends the product details it reads there \(title, brand, part number, category\)\./,
    );
  });

  it("says staff may open the chat for a report the member made, because admin_open_agent_chat allows it", () => {
    const sql = readFileSync("supabase/migrations/20261026100000_agent_hosted_schedule.sql", "utf8");
    const fn = sql.slice(sql.indexOf("create or replace function public.admin_open_agent_chat"));
    // The reports it accepts: one the member filed, one about them, one about a listing of theirs.
    expect(fn).toContain("r.reporter_id = p_member");
    expect(fn).toContain("r.subject_type = 'user' and r.subject_id = p_member");
    expect(fn).toContain("r.subject_type = 'listing'");
    expect(fn).toContain("'agent.chat_opened'");
    expect(page).toMatch(
      /chat with your agent is opened only for a dispute you're part of, or a report you made or that is about you or one of your listings, and each opening is recorded\./,
    );
    expect(page).not.toMatch(/opened only for a report about you or a dispute/);
  });

  // The wording only. That the model boundary keeps it (redaction of the
  // message, history and tool results; no floor or ceiling sent) is proved on
  // the outbound request bodies in src/lib/ai/run.test.ts (N422).
  it("keeps the redaction and limits promises the model boundary keeps", () => {
    expect(page).toMatch(/Card numbers, VINs, email addresses and phone numbers are removed from what you type before it's sent, and your agent's limits are never sent\./);
  });
});
