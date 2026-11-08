import { publicEnv } from "@/lib/env";
import { siteUrl } from "@/lib/site";

function hostOf(origin: () => string): string[] {
  try {
    return [new URL(origin()).hostname.toLowerCase()];
  } catch {
    // An unset origin names no host.
    return [];
  }
}

/**
 * DRVN's own hostnames for copyright notices (R69-dmca): the site's pages,
 * and the storage that serves its photos. A notice may name either; a
 * takedown reads listing pages from the first and photos from the second.
 */
export function copyrightHosts(): { site: string[]; storage: string[] } {
  return { site: hostOf(siteUrl), storage: hostOf(() => publicEnv().url) };
}
