type ProfileLink = { label: string; url: string };

export function initialsFrom(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function splitLinks(links: unknown): { website: ProfileLink | null; rest: ProfileLink[] } {
  const arr = (Array.isArray(links) ? links : []) as ProfileLink[];
  const website = arr.find((l) => l.label === "website") ?? null;
  const rest = arr.filter((l) => l !== website);
  return { website, rest };
}
