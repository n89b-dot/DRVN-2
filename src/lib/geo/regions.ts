/**
 * Where a member is, coarsely (H-2).
 *
 * Local answers "what's happening near me", and near enough is a country
 * and a region. A town would be a location-sharing feature — the PRD rules
 * location tags out, and a build sheet plus a town is close to an address.
 *
 * The list is deliberately short: the countries DRVN actually has members
 * in, with the regional split people would use to describe where they are.
 * A country with no regions listed is fine — Local then works at country
 * level, which is the right grain for a small market.
 */

export type Country = { code: string; name: string; regions: string[] };

export const COUNTRIES: Country[] = [
  {
    code: "GB",
    name: "United Kingdom",
    regions: [
      "South East", "London", "South West", "East of England", "East Midlands",
      "West Midlands", "Yorkshire", "North West", "North East", "Wales",
      "Scotland", "Northern Ireland",
    ],
  },
  {
    code: "US",
    name: "United States",
    regions: ["Northeast", "Mid-Atlantic", "Southeast", "Midwest", "South", "Mountain", "Pacific Northwest", "California", "Southwest", "Hawaii", "Alaska"],
  },
  { code: "IE", name: "Ireland", regions: ["Leinster", "Munster", "Connacht", "Ulster"] },
  { code: "DE", name: "Germany", regions: ["North", "East", "South", "West"] },
  { code: "NL", name: "Netherlands", regions: [] },
  { code: "FR", name: "France", regions: ["North", "East", "South", "West", "Île-de-France"] },
  { code: "ES", name: "Spain", regions: [] },
  { code: "IT", name: "Italy", regions: ["North", "Centre", "South"] },
  { code: "PL", name: "Poland", regions: [] },
  { code: "SE", name: "Sweden", regions: [] },
  { code: "AU", name: "Australia", regions: ["NSW", "Victoria", "Queensland", "South Australia", "Western Australia", "Tasmania"] },
  { code: "NZ", name: "New Zealand", regions: ["North Island", "South Island"] },
  { code: "CA", name: "Canada", regions: ["British Columbia", "Prairies", "Ontario", "Quebec", "Atlantic"] },
  { code: "JP", name: "Japan", regions: ["Kanto", "Kansai", "Chubu", "Kyushu", "Tohoku", "Hokkaido"] },
  { code: "ZA", name: "South Africa", regions: [] },
];

export function countryByCode(code: string | null | undefined): Country | null {
  if (!code) return null;
  return COUNTRIES.find((c) => c.code === code.toUpperCase()) ?? null;
}

/** True when this pair is one the picker could actually have produced. */
export function isKnownPlace(code: string | null | undefined, region?: string | null): boolean {
  const country = countryByCode(code);
  if (!country) return false;
  if (!region) return true;
  return country.regions.length === 0 ? false : country.regions.includes(region);
}

/** "Yorkshire, United Kingdom" — how a place reads in prose. */
export function placeLabel(code: string | null | undefined, region?: string | null): string | null {
  const country = countryByCode(code);
  if (!country) return null;
  return region ? `${region}, ${country.name}` : country.name;
}
