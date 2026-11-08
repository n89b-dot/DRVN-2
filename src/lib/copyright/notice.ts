/**
 * A copyright notice, as the /copyright form sends it (R69-dmca). Pure: the
 * server action validates with this, and the database checks the same rules
 * again (copyright_notices, 20261107231002).
 *
 * The fields are the ones a valid notice needs: who is complaining and how
 * to reach them, the work, where on DRVN it appears, a good-faith statement,
 * a statement that the notice is accurate and the sender is authorised, and
 * a signature (the sender's typed full name).
 */

export const COPYRIGHT_URL_LIMIT = 20;

export type CopyrightNoticeInput = {
  claimant_name: string;
  claimant_email: string;
  claimant_address: string;
  claimant_phone: string | null;
  rights_holder: string | null;
  work_description: string;
  content_urls: string[];
  good_faith: true;
  accurate_and_authorised: true;
  signature: string;
};

export type CopyrightNoticeField =
  | "claimant_name"
  | "claimant_email"
  | "claimant_address"
  | "claimant_phone"
  | "rights_holder"
  | "work_description"
  | "content_urls"
  | "good_faith"
  | "accurate_and_authorised"
  | "signature";

export type CopyrightNoticeErrors = Partial<Record<CopyrightNoticeField, string>>;

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/**
 * The URLs a notice names, one per line (commas and spaces also separate).
 * Only DRVN's own pages and DRVN's own photo storage count: a notice is about
 * something DRVN shows. `hosts` are the hostnames that qualify.
 */
export function parseContentUrls(raw: string, hosts: string[]): { urls: string[]; error?: string } {
  const parts = raw.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
  const urls: string[] = [];
  for (const part of parts) {
    let url: URL;
    try {
      url = new URL(part);
    } catch {
      return { urls, error: `"${part.slice(0, 60)}" isn't a full web address. Paste each link as it appears in your browser.` };
    }
    if (!["https:", "http:"].includes(url.protocol) || !hosts.includes(url.hostname.toLowerCase())) {
      return { urls, error: `"${part.slice(0, 60)}" isn't on DRVN. List the DRVN pages or photos that show your work.` };
    }
    if (!urls.includes(url.toString())) urls.push(url.toString());
  }
  if (!urls.length) return { urls, error: "Add at least one DRVN link where your work appears." };
  if (urls.length > COPYRIGHT_URL_LIMIT) return { urls, error: `Up to ${COPYRIGHT_URL_LIMIT} links per notice. Send another notice for the rest.` };
  return { urls };
}

export function validateCopyrightNotice(
  formData: FormData,
  hosts: string[]
): { notice?: CopyrightNoticeInput; errors: CopyrightNoticeErrors } {
  const errors: CopyrightNoticeErrors = {};
  const name = text(formData, "claimant_name");
  const email = text(formData, "claimant_email");
  const address = text(formData, "claimant_address");
  const phone = text(formData, "claimant_phone");
  const holder = text(formData, "rights_holder");
  const work = text(formData, "work_description");
  const signature = text(formData, "signature");

  if (name.length < 2 || name.length > 200) errors.claimant_name = "Enter your full name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) errors.claimant_email = "Enter an email address we can reply to.";
  if (address.length < 5 || address.length > 1000) errors.claimant_address = "Enter a postal address.";
  if (phone.length > 50) errors.claimant_phone = "That phone number is too long.";
  if (holder.length > 200) errors.rights_holder = "Keep the rights holder's name under 200 characters.";
  if (work.length < 10 || work.length > 4000) errors.work_description = "Describe the work in 10 to 4,000 characters.";
  const { urls, error: urlError } = parseContentUrls(text(formData, "content_urls"), hosts);
  if (urlError) errors.content_urls = urlError;
  if (formData.get("good_faith") !== "yes") errors.good_faith = "This statement is required.";
  if (formData.get("accurate_and_authorised") !== "yes") errors.accurate_and_authorised = "This statement is required.";
  if (signature.length < 2 || signature.length > 200) errors.signature = "Type your full name as your signature.";

  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    notice: {
      claimant_name: name,
      claimant_email: email,
      claimant_address: address,
      claimant_phone: phone || null,
      rights_holder: holder || null,
      work_description: work,
      content_urls: urls,
      good_faith: true,
      accurate_and_authorised: true,
      signature,
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LISTING_PATH = /^\/listings\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;
const STORAGE_PATH = /^\/storage\/v1\/object\/(?:public|sign|authenticated)\//;

/**
 * What a takedown would act on, read from a notice's links plus anything the
 * admin adds (links or bare listing ids, separated by spaces, commas or new
 * lines): DRVN listing pages become listing ids, DRVN storage URLs become
 * photos. Anything else (a post page, a profile) is returned as `other` for
 * the admin to resolve by hand: its photos can be pasted as photo links.
 */
export function takedownTargets(
  values: string[],
  hosts: { site: string[]; storage: string[] }
): { listingIds: string[]; mediaUrls: string[]; other: string[] } {
  const listingIds = new Set<string>();
  const mediaUrls = new Set<string>();
  const other = new Set<string>();
  const tokens = values.flatMap((value) => value.split(/[\s,]+/)).map((token) => token.trim()).filter(Boolean);
  for (const token of tokens) {
    if (UUID.test(token)) {
      listingIds.add(token.toLowerCase());
      continue;
    }
    let url: URL;
    try {
      url = new URL(token);
    } catch {
      other.add(token);
      continue;
    }
    const host = url.hostname.toLowerCase();
    const listing = url.pathname.match(LISTING_PATH);
    if (hosts.storage.includes(host) && STORAGE_PATH.test(url.pathname)) mediaUrls.add(url.toString());
    else if (hosts.site.includes(host) && listing) listingIds.add(listing[1].toLowerCase());
    else other.add(token);
  }
  return { listingIds: [...listingIds], mediaUrls: [...mediaUrls], other: [...other] };
}
