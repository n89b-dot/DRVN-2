import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { ALL_PUBLIC_KINDS, publicKindsForPath } from "@/lib/supabase/public-cache";

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

it("no action revalidates a page without clearing the shared public copy", () => {
  const src = path.join(process.cwd(), "src");
  const direct = sourceFiles(src)
    .filter((file) => path.relative(src, file) !== path.join("lib", "revalidate.ts"))
    .filter((file) => /import\s*\{[^}]*\brevalidatePath\b[^}]*\}\s*from\s*"next\/cache"/.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(src, file));
  // Import revalidatePath from "@/lib/revalidate" instead.
  expect(direct).toEqual([]);
});

it("maps the page a write revalidates to the public data it may have changed", () => {
  expect(publicKindsForPath("/marketplace")).toEqual(["listings"]);
  expect(publicKindsForPath("/listings/abc/edit")).toContain("listings");
  // Paying for a part is what marks it sold.
  expect(publicKindsForPath("/orders/abc")).toContain("listings");
  expect(publicKindsForPath("/cars/my-car?view=build")).toContain("cars");
  expect(publicKindsForPath("/u/someone")).toContain("profiles");
  expect(publicKindsForPath("/")).toEqual(ALL_PUBLIC_KINDS);
  expect(publicKindsForPath("/admin/cases")).toEqual(ALL_PUBLIC_KINDS);
  // Private pages change nothing a signed-out visitor sees; `/u` is not `/unknown`.
  expect(publicKindsForPath("/notifications")).toEqual([]);
  expect(publicKindsForPath("/messages")).toEqual([]);
  expect(publicKindsForPath("/unknown")).toEqual([]);
});
