import { describe, expect, it } from "vitest";

import { createUnsignedPhotoReporter, photoReportArea, UNSIGNED_PHOTO_REPORTS_PER_LOAD, type UnsignedPhotoReport } from "./photo-report";

const O = "https://proj.supabase.co/storage/v1/object/public";
const MEMBER = "11111111-1111-4111-8111-111111111111";

function reporter(startPath = "/garage") {
  const sent: UnsignedPhotoReport[] = [];
  const page = { path: startPath };
  return { sent, page, report: createUnsignedPhotoReporter({ path: () => page.path, send: (r) => sent.push(r) }) };
}

describe("N1053: what the browser tells monitoring about an unsigned member photo (work review #137)", () => {
  it("N1053: sends the bucket and the first segment of the page's path, never the object and never the rest of the path", () => {
    const { sent, report } = reporter("/cars/kaito-s13");
    report(`${O}/car-images/${MEMBER}/cover.webp`);
    expect(sent).toEqual([{ bucket: "car-images", area: "cars" }]);
    expect(JSON.stringify(sent)).not.toContain(MEMBER);
    expect(JSON.stringify(sent)).not.toContain("cover.webp");
    expect(JSON.stringify(sent)).not.toContain("kaito");
  });

  it("N1053: a private link in the page's path is never sent: the account-deletion page reports its first segment only (review of #244)", () => {
    // The page's own header calls this reference an unguessable capability link.
    const reference = "9f2c4e7a-51b6-4d0e-a3c8-7e1f0b2d6a94";
    const { sent, report } = reporter(`/account-deletion/${reference}`);
    report(`${O}/car-images/${MEMBER}/backdrop.webp`);
    expect(sent).toEqual([{ bucket: "car-images", area: "account-deletion" }]);
    expect(JSON.stringify(sent)).not.toContain(reference);
    expect(photoReportArea(`/account-deletion/${reference}?next=/orders/${reference}#top`)).toBe("account-deletion");
    // A first segment that could itself be an id or a token is not sent either.
    for (const path of [`/${reference}`, "/Tr4ck1ngT0ken", "/orders_2026", `/${"a".repeat(60)}`, "/%2e%2e"]) {
      expect(photoReportArea(path), path).toBe("other");
    }
    expect(photoReportArea("/")).toBe("home");
    expect(photoReportArea("/orders/a1b2c3d4-0000-4000-8000-000000000001/pickup")).toBe("orders");
  });

  it("N1053: the component docs, which show an unsigned photo on purpose, report nothing (review of #244)", () => {
    const { sent, report } = reporter("/docs/components");
    report(`${O}/car-images/00000000-0000-4000-8000-000000000000/unsigned.webp`);
    expect(sent).toEqual([]);
    expect(photoReportArea("/docs")).toBeNull();
    // A page that merely starts with the same letters is not the docs.
    expect(photoReportArea("/docsearch")).toBe("docsearch");
  });

  it("N1053: a page full of unsigned photos is one report", () => {
    const { sent, report } = reporter();
    for (let i = 0; i < 40; i++) report(`${O}/listing-images/${MEMBER}/${i}.webp`);
    expect(sent).toHaveLength(1);
  });

  it("N1053: each area reports once, up to the limit for one page load", () => {
    const { sent, page, report } = reporter("/a");
    for (const path of ["/garage", "/cars/x", "/garage/2/edit", "/home", "/saved", "/sell"]) {
      page.path = path;
      report(`${O}/activity-images/${MEMBER}/1.webp`);
    }
    expect(sent.map((r) => r.area)).toEqual(["garage", "cars", "home"]);
    expect(sent).toHaveLength(UNSIGNED_PHOTO_REPORTS_PER_LOAD);
  });

  it("N1053: two reporters share nothing", () => {
    const one = reporter();
    const two = reporter();
    one.report(`${O}/car-images/${MEMBER}/1.webp`);
    two.report(`${O}/car-images/${MEMBER}/1.webp`);
    expect([one.sent.length, two.sent.length]).toEqual([1, 1]);
  });
});
