import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Applicable WCAG A/AA rules fail at every impact level. Automated scans
 * complement the separately recorded manual/device acceptance matrix. */
export async function assertAccessible(page: Page, label: string) {
  await expect
    .poll(
      () =>
        page
          .locator("main [data-reveal]")
          .evaluateAll((elements) =>
            elements.every(
              (element) => Number(getComputedStyle(element).opacity) >= 0.999
            )
          ),
      { message: "revealed content has settled" }
    )
    .toBe(true);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    })),
    `WCAG A/AA violations: ${label}`
  ).toEqual([]);
}
