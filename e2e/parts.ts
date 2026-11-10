// Plan 2 item A0b: the browser suite split into parts that CI runs side by
// side. e2e/parts.json says which spec file each part runs; this turns one
// part into Playwright projects. With E2E_PART unset the suite is whole, as it
// is on a developer's machine.
import manifest from "./parts.json";

export type PartManifest = { operationsPart: string; parts: Record<string, Record<string, string[]>> };

export const PARTS: PartManifest = manifest;
export const PART_NAMES: string[] = Object.keys(manifest.parts);

/** The projects one part runs, each with the files it runs there. Throws on a part that does not exist. */
export function partProjects(part: string, parts: PartManifest = PARTS): { name: string; files: string[] }[] {
  const projects = parts.parts[part];
  if (!projects) throw new Error(`E2E_PART must be one of ${Object.keys(parts.parts).join(", ")}, got "${part}".`);
  return Object.entries(projects).map(([name, files]) => ({ name, files }));
}
