import fs from "node:fs";
import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/cache", () => cache);

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

beforeEach(() => vi.clearAllMocks());

it("opening or clearing notifications refreshes only the member's list (N57)", async () => {
  const { revalidateNotifications } = await import("@/lib/revalidate");
  revalidateNotifications();
  expect(cache.revalidatePath.mock.calls).toEqual([["/notifications"]]);
  // Notifications are private: no shared public data is thrown away.
  expect(cache.revalidateTag).not.toHaveBeenCalled();
});

it("notification actions never revalidate the whole app", () => {
  const file = path.join(process.cwd(), "src", "app", "(product)", "notifications", "actions.ts");
  const source = fs.readFileSync(file, "utf8");
  expect(source).not.toMatch(/revalidatePath\(\s*"\/"/);
  expect(source).toMatch(/revalidateNotifications\(\)/);
});

it("a root revalidation is what clears every kind of public data — never let a browser choose the path", async () => {
  const { revalidatePath } = await import("@/lib/revalidate");
  revalidatePath("/");
  expect(cache.revalidateTag).toHaveBeenCalledTimes(ALL_PUBLIC_KINDS.length);
});

// social/actions.ts still takes a path, but only honours the shapes on its
// `ALLOWED_PATHS` list (`revalidateIfAllowed`), never `/` or `/admin`.
it("no action revalidates a path read from its arguments or form (N58)", () => {
  const src = path.join(process.cwd(), "src");
  const offenders = sourceFiles(src)
    .filter((file) => /actions\.ts$/.test(file))
    .filter((file) => {
      const source = fs.readFileSync(file, "utf8");
      return /formData\.get\("path"\)/.test(source) || /\brevalidatePath\(\s*path\s*\)/.test(source) && !/revalidateIfAllowed/.test(source);
    })
    .map((file) => path.relative(src, file));
  expect(offenders).toEqual([]);
});
