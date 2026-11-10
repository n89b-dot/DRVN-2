import { describe, expect, it } from "vitest";

import { createUnsignedPhotoReporter, UNSIGNED_PHOTO_REPORTS_PER_LOAD, type UnsignedPhotoReport } from "./photo-report";

const O = "https://proj.supabase.co/storage/v1/object/public";
const MEMBER = "11111111-1111-4111-8111-111111111111";

function reporter(startPath = "/garage") {
  const sent: UnsignedPhotoReport[] = [];
  const page = { path: startPath };
  return { sent, page, report: createUnsignedPhotoReporter({ path: () => page.path, send: (r) => sent.push(r) }) };
}

describe("N1053: what the browser tells monitoring about an unsigned member photo (work review #137)", () => {
  it("N1053: names the bucket and the page, and never the object", () => {
    const { sent, report } = reporter("/cars/kaito-s13");
    report(`${O}/car-images/${MEMBER}/cover.webp`);
    expect(sent).toEqual([{ message: "A member photo reached a page unsigned (car-images)", path: "/cars/kaito-s13" }]);
    expect(JSON.stringify(sent)).not.toContain(MEMBER);
    expect(JSON.stringify(sent)).not.toContain("cover.webp");
  });

  it("N1053: a page full of unsigned photos is one report", () => {
    const { sent, report } = reporter();
    for (let i = 0; i < 40; i++) report(`${O}/listing-images/${MEMBER}/${i}.webp`);
    expect(sent).toHaveLength(1);
  });

  it("N1053: each page address reports once, up to the limit for one page load", () => {
    const { sent, page, report } = reporter("/a");
    for (const path of ["/a", "/b", "/a", "/c", "/d", "/e"]) {
      page.path = path;
      report(`${O}/activity-images/${MEMBER}/1.webp`);
    }
    expect(sent.map((r) => r.path)).toEqual(["/a", "/b", "/c"]);
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
