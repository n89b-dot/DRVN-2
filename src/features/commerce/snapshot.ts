import type { Json } from "@/lib/database.types";

/**
 * Reader for order_items.commercial_snapshot (migration 0049) — the versioned
 * jsonb record of what the buyer purchased, frozen at purchase time by the
 * order_items_purchase_snapshot trigger.
 *
 * The database is authoritative for the shape; this module only reads it, and
 * reads defensively: a missing or malformed field becomes null/[] rather than
 * a crash, because a historical evidence record must always render. Client-
 * safe (no server-only imports) — order pages pass parsed snapshots into
 * client components.
 */

export type SnapshotFitmentRow = {
  make: string;
  model: string;
  yearStart: number | null;
  yearEnd: number | null;
};

export type CommercialSnapshot = {
  version: number;
  capturedAt: string | null;
  /** True when 0049 backfilled this from post-purchase data — content is
   *  best-available, not provably purchase-time. */
  backfilled: boolean;
  /** True when the listing was already gone and only the order row's own
   *  columns could be frozen. */
  degraded: boolean;
  listing: {
    id: string | null;
    title: string | null;
    description: string | null;
    category: string | null;
    subcategory: string | null;
  };
  part: {
    partNumber: string | null;
    /** The listing's brand at purchase (20261020110000); null on older snapshots. */
    brand: string | null;
    altPartNumbers: string[];
  };
  condition: {
    condition: string | null;
    grade: string | null;
    compatibilityNotes: string | null;
  };
  fitment: SnapshotFitmentRow[];
  sourceCar: {
    id: string | null;
    name: string | null;
    year: number | null;
    make: string | null;
    model: string | null;
  } | null;
  commercial: {
    priceCents: number | null;
    listingPriceCents: number | null;
    currency: string | null;
    shippingCents: number | null;
    shippingMode: string | null;
    allowsCollection: boolean;
    /** Shop preference-return policy frozen at purchase (0056). Null =
     *  protection only. */
    returnPolicy: { returnsAccepted: boolean; windowDays: number } | null;
  };
  seller: {
    id: string | null;
    username: string | null;
    displayName: string | null;
    profileType: string | null;
    /** Verified-shop state at purchase (0056). Null pre-0056. */
    verifiedShop: boolean | null;
  } | null;
};

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readCommercialSnapshot(json: Json | null | undefined): CommercialSnapshot | null {
  const root = obj(json);
  if (!root) return null;

  const listing = obj(root.listing) ?? {};
  const part = obj(root.part) ?? {};
  const condition = obj(root.condition) ?? {};
  const commercial = obj(root.commercial) ?? {};
  const car = obj(root.source_car);
  const seller = obj(root.seller);

  const fitment: SnapshotFitmentRow[] = Array.isArray(root.fitment)
    ? root.fitment
        .map((row) => {
          const r = obj(row);
          if (!r) return null;
          const make = str(r.make);
          const model = str(r.model);
          if (!make || !model) return null;
          return {
            make,
            model,
            yearStart: num(r.year_start),
            yearEnd: num(r.year_end),
          };
        })
        .filter((row): row is SnapshotFitmentRow => row !== null)
    : [];

  const altPartNumbers = Array.isArray(part.alt_part_numbers)
    ? part.alt_part_numbers.filter((n): n is string => typeof n === "string" && n.length > 0)
    : [];

  return {
    version: num(root.version) ?? 1,
    capturedAt: str(root.captured_at),
    backfilled: root.backfilled === true,
    degraded: root.degraded === true,
    listing: {
      id: str(listing.id),
      title: str(listing.title),
      description: str(listing.description),
      category: str(listing.category),
      subcategory: str(listing.subcategory),
    },
    part: {
      partNumber: str(part.part_number),
      brand: str(part.brand),
      altPartNumbers,
    },
    condition: {
      condition: str(condition.condition),
      grade: str(condition.grade),
      compatibilityNotes: str(condition.compatibility_notes),
    },
    fitment,
    sourceCar: car
      ? {
          id: str(car.id),
          name: str(car.name),
          year: num(car.year),
          make: str(car.make),
          model: str(car.model),
        }
      : null,
    commercial: {
      priceCents: num(commercial.price_cents),
      listingPriceCents: num(commercial.listing_price_cents),
      currency: str(commercial.currency),
      shippingCents: num(commercial.shipping_cents),
      shippingMode: str(commercial.shipping_mode),
      allowsCollection: commercial.allows_collection === true,
      returnPolicy: (() => {
        const policy = obj(commercial.return_policy);
        if (!policy || policy.returns_accepted !== true) return null;
        const windowDays = num(policy.window_days);
        return windowDays ? { returnsAccepted: true, windowDays } : null;
      })(),
    },
    seller: seller
      ? {
          id: str(seller.id),
          username: str(seller.username),
          displayName: str(seller.display_name),
          profileType: str(seller.profile_type),
          verifiedShop:
            typeof seller.verified_shop === "boolean" ? seller.verified_shop : null,
        }
      : null,
  };
}

/** One-line fitment label: "BMW E46 M3 2001–2006". */
export function fitmentLabel(row: SnapshotFitmentRow): string {
  const years =
    row.yearStart && row.yearEnd && row.yearEnd !== row.yearStart
      ? ` ${row.yearStart}–${row.yearEnd}`
      : row.yearStart
        ? ` ${row.yearStart}`
        : "";
  return `${row.make} ${row.model}${years}`;
}
