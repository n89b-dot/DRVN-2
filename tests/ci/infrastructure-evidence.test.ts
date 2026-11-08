// N224 (remediation plan C8): docs/release-evidence/infrastructure.md is the
// dated record of every piece of infrastructure, read by the release packet's
// operations gate. It must list every variable the runbook's §4 tables name,
// so a variable added to the runbook can't be left out of the evidence.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

/** The first-column names of the markdown table rows between two headings. */
function firstColumns(markdown: string, from: string, to: string): string[] {
  const section = markdown.slice(markdown.indexOf(from), markdown.indexOf(to));
  return section
    .split("\n")
    .map((line) => /^\| (`[A-Z][^|]*?) \|/.exec(line)?.[1].trim())
    .filter((cell): cell is string => !!cell);
}

describe("the infrastructure evidence file (N224)", () => {
  it("N224: has a row for every variable in the runbook's §4 tables", () => {
    const runbook = firstColumns(read("docs/production-runbook.md"), "## 4. Wire the app", "## 5. Seed the first admin");
    const evidence = firstColumns(read("docs/release-evidence/infrastructure.md"), "## Runbook §4: environment variables", "## Runbook §4: database configuration");
    expect(runbook.length).toBeGreaterThan(25);
    expect(evidence).toEqual(runbook);
  });

  it("N224: covers the runbook §1 Auth settings and the owner's accounts", () => {
    const evidence = read("docs/release-evidence/infrastructure.md");
    for (const needle of ["Secure password change on", "Secure email change on", "Minimum password length 8", "Point-in-time recovery", "Sentry project", "Alert webhook", "Uptime check", "First admin enrolled with MFA"]) {
      expect(evidence).toContain(needle);
    }
  });
});
