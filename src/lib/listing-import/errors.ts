/**
 * Structured importer error codes (0047). The code is what monitoring,
 * analytics and retry logic key on; the message is the seller-facing sentence.
 * Internal detail (`error_detail`) may say more, but never reaches the client
 * verbatim — actions surface `messageForImportError(code)` only.
 */

export const IMPORT_ERROR_CODES = [
  "source_invalid",
  "source_unsupported",
  "source_private_address",
  "source_fetch_timeout",
  "source_fetch_failed",
  "source_access_denied",
  "source_login_required",
  "source_challenge",
  "source_too_large",
  "source_not_sale_post",
  "source_parse_failed",
  "ai_unavailable",
  "ai_failed",
  "ai_invalid_output",
  "media_fetch_failed",
  "media_invalid",
  "import_expired",
  "import_not_found",
] as const;

export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

/** Codes where the productive next step is pasting the post instead. */
export const PASTE_FALLBACK_CODES: ReadonlySet<ImportErrorCode> = new Set([
  "source_fetch_timeout",
  "source_fetch_failed",
  "source_access_denied",
  "source_login_required",
  "source_challenge",
  "source_too_large",
  "source_parse_failed",
  "source_unsupported",
]);

/** Codes where retrying the same step is worth offering. */
export const RETRYABLE_CODES: ReadonlySet<ImportErrorCode> = new Set([
  "source_fetch_timeout",
  "source_fetch_failed",
  "ai_unavailable",
  "ai_failed",
  "media_fetch_failed",
]);

const MESSAGES: Record<ImportErrorCode, string> = {
  source_invalid: "That doesn't look like a listing link. Check the URL and try again.",
  source_unsupported:
    "We can't read this site directly. Paste your existing post below and we'll finish the import.",
  source_private_address: "That address can't be reached from here. Check the URL and try again.",
  source_fetch_timeout: "The page took too long to respond. Try again, or paste your post instead.",
  source_fetch_failed: "We couldn't reach that page. Try again, or paste your post instead.",
  source_access_denied:
    "We couldn't read this page directly. Paste the post you've already written and we'll finish the import.",
  source_login_required:
    "That page needs a login we don't have. Paste the post you've already written and we'll finish the import.",
  source_challenge:
    "The site wouldn't show us the page. Paste the post you've already written and we'll finish the import.",
  source_too_large: "That page is too large to read. Paste the listing text instead.",
  source_not_sale_post:
    "This doesn't look like a for-sale post. If it is one, paste just the sale text below.",
  source_parse_failed:
    "We couldn't make sense of that page. Paste the post text below and we'll take it from there.",
  ai_unavailable: "Listing organization is temporarily unavailable. Try again in a minute.",
  ai_failed: "We couldn't finish organizing the details. Try again — your source is saved.",
  ai_invalid_output: "We couldn't finish organizing the details. Try again — your source is saved.",
  media_fetch_failed:
    "We couldn't bring over the photos. Your listing details are ready — add your original photos on review.",
  media_invalid:
    "Some photos couldn't be imported. Your listing details are ready — add your original photos on review.",
  import_expired: "This import expired. Start it again — it only takes a moment.",
  import_not_found: "We couldn't find that import. Start a new one from the sell page.",
};

export function messageForImportError(code: string | null | undefined): string {
  if (code && (IMPORT_ERROR_CODES as readonly string[]).includes(code)) {
    return MESSAGES[code as ImportErrorCode];
  }
  return "Something went wrong with this import. Try again, or paste your post instead.";
}

export function isImportErrorCode(value: unknown): value is ImportErrorCode {
  return typeof value === "string" && (IMPORT_ERROR_CODES as readonly string[]).includes(value);
}
