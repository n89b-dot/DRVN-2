/**
 * Names inside the account export ZIP (OS-W11 N47). One folder per section,
 * one file per page, with an extension a member's computer opens: JSON for
 * records, the original type for photos and documents.
 */
const EXTENSIONS: Record<string, string> = {
  "application/json": "json",
  "text/csv": "csv",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "application/pdf": "pdf",
};

export function exportEntryName(part: { section_key: string; page_number: number; content_type: string }): string {
  const section = part.section_key.replace(/[^a-z0-9_-]/gi, "_") || "section";
  const page = String(Math.max(0, Math.trunc(part.page_number))).padStart(4, "0");
  const ext = EXTENSIONS[part.content_type?.split(";")[0]?.trim().toLowerCase() ?? ""] ?? "bin";
  return section === "manifest" ? `records/manifest-${page}.${ext}` : `records/${section}/${page}.${ext}`;
}

export function exportArchiveName(requestId: string): string {
  return `drvn-export-${requestId.replace(/[^0-9a-f]/gi, "").slice(0, 8)}.zip`;
}
