import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { COMPONENT_REGISTRY, registryByName } from "./registry";

/**
 * Governance: the registry and the shared entry points may not drift apart.
 *
 * 1. Every PascalCase value export from `@/components/ui`,
 *    `@/components/commerce` and `@/components/livesheet` has a registry
 *    entry with the matching importPath.
 * 2. Every registry entry resolves to a real export in its declared file.
 *
 * File-system based (no runtime imports) so it stays independent of client
 * component / Next runtime concerns.
 */

const ROOT = join(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** Names re-exported by an index barrel (`export { A, B } from "./x"`), types stripped. */
function barrelExports(rel: string): string[] {
  const src = read(rel);
  const names: string[] = [];
  for (const match of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const raw of match[1].split(",")) {
      const item = raw.trim();
      if (!item || item.startsWith("type ")) continue;
      // `X as Y` exposes Y.
      const name = item.includes(" as ") ? item.split(" as ")[1].trim() : item;
      names.push(name);
    }
  }
  return names;
}

function inlineExports(rel: string): string[] {
  const src = read(rel);
  return [...src.matchAll(/export (?:async )?(?:function|const|class) ([A-Za-z_]\w*)/g)].map(
    (m) => m[1],
  );
}

const isComponentName = (name: string) => /^[A-Z][a-z]/.test(name);

const SURFACES: { importPath: string; names: string[] }[] = [
  { importPath: "@/components/ui", names: barrelExports("src/components/ui/index.ts") },
  { importPath: "@/components/commerce", names: barrelExports("src/components/commerce/index.ts") },
  { importPath: "@/components/livesheet", names: inlineExports("src/components/livesheet.tsx") },
];

describe("component registry ↔ public exports", () => {
  it("every public component export has a registry entry", () => {
    const missing: string[] = [];
    for (const surface of SURFACES) {
      for (const name of surface.names.filter(isComponentName)) {
        const entry = registryByName.get(name);
        if (!entry) missing.push(`${surface.importPath} → ${name}`);
        else if (entry.importPath !== surface.importPath) {
          missing.push(
            `${name}: registry says import from ${entry.importPath}, exported from ${surface.importPath}`,
          );
        }
      }
    }
    expect(
      missing,
      "Add a registry entry in src/components/registry.ts for each (or remove the export)",
    ).toEqual([]);
  });

  it("every registry entry resolves to a real export in its file", () => {
    const broken: string[] = [];
    for (const entry of COMPONENT_REGISTRY) {
      let src: string;
      try {
        src = read(entry.file);
      } catch {
        broken.push(`${entry.name}: file missing (${entry.file})`);
        continue;
      }
      const declared =
        new RegExp(`export (?:async )?(?:function|const|class) ${entry.name}\\b`).test(src) ||
        new RegExp(`export \\{[^}]*\\b${entry.name}\\b[^}]*\\}`).test(src);
      if (!declared) broken.push(`${entry.name}: not exported from ${entry.file}`);
    }
    expect(broken).toEqual([]);
  });

  it("has no duplicate names", () => {
    const names = COMPONENT_REGISTRY.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("deprecated entries carry a replacement pointer in their description or avoid", () => {
    const bad = COMPONENT_REGISTRY.filter(
      (e) => e.status === "deprecated" && !`${e.description} ${e.avoid ?? ""}`.match(/use|replaced|instead/i),
    ).map((e) => e.name);
    expect(bad).toEqual([]);
  });
});
