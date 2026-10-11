import type { ReactNode } from "react";

/**
 * The shared language of DRVN's generated images (`opengraph-image.tsx`,
 * `icon.tsx`, `apple-icon.tsx`). Satori renders these, so it cannot read CSS
 * variables: the palette is the DAY values from
 * `src/app/styles/00-tokens-base.css`, written out by hand. Keep them in step.
 */
export const OG_SIZE = { width: 1200, height: 630 } as const;

export const OG_COLORS = {
  /** `--ink` — the plate every card sits on. */
  ink: "#20232a",
  /** `--on-ink` — text on the ink plate. */
  onInk: "#f8f6f0",
  /** `--paper` — the day canvas; the manifest's background. */
  paper: "#efede6",
  /** The brand full stop on an ink plate: the signal hue the share cards have
   *  carried since the first build card. */
  dot: "#e8593d",
  /** Secondary text on the ink plate (microlabels, bylines, the foot line). */
  dim: "#a3a6ae",
  /** `--photo-scrim` — laid over a photograph so text stays legible. */
  photoScrim: "rgba(10, 11, 14, 0.74)",
} as const;

/**
 * `next/og` ships one face (Geist Regular) and Satori never synthesises a
 * bold, so `fontWeight` alone does nothing. A same-colour stroke is what
 * gives the wordmark and the monogram their weight. Satori spells the
 * property the WebKit way.
 */
export function ogWeight(size: number, color: string) {
  return { WebkitTextStrokeWidth: Math.max(1, Math.round(size * 0.035)), WebkitTextStrokeColor: color } as const;
}

/** The width of the photo column: a 660 × 630 cover beside a text column. */
export const OG_PHOTO_WIDTH = 660;

/** The wordmark: `DRVN.` with the terminal dot in the signal colour. */
export function OgWordmark({ size = 34 }: { size?: number }) {
  return (
    <div style={{ display: "flex", fontSize: size, fontWeight: 700, letterSpacing: -size / 34 }}>
      DRVN<span style={{ color: OG_COLORS.dot }}>.</span>
    </div>
  );
}

/** An uppercase, tracked label naming what the card is — a microlabel. */
export function OgMicrolabel({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <div
      style={{
        display: "flex",
        fontSize: size,
        letterSpacing: 3,
        textTransform: "uppercase",
        color: OG_COLORS.dim,
      }}
    >
      {children}
    </div>
  );
}

/** The one line at the foot of every card. */
export function OgFoot({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", fontSize: 20, color: OG_COLORS.dim }}>{children}</div>;
}

/**
 * The card frame: an ink plate, an optional 660px photo on the left, and a
 * text column (wordmark top, content middle, foot line bottom) that takes the
 * rest. Satori needs `display: flex` on anything with more than one child.
 */
export function OgFrame({
  photo,
  children,
  foot,
}: {
  photo?: string | null;
  children: ReactNode;
  foot: ReactNode;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: OG_COLORS.ink,
        color: OG_COLORS.onInk,
        fontFamily: "sans-serif",
      }}
    >
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" style={{ width: OG_PHOTO_WIDTH, height: OG_SIZE.height, objectFit: "cover" }} />
      )}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 48,
        }}
      >
        <OgWordmark />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
        <OgFoot>{foot}</OgFoot>
      </div>
    </div>
  );
}

/**
 * The site card, and the fallback for every object card whose object is not
 * public: the wordmark large, the microlabel that names both front doors, and
 * the positioning line. Nothing on it comes from data.
 */
export function OgBrandCard() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: OG_COLORS.ink,
        color: OG_COLORS.onInk,
        fontFamily: "sans-serif",
      }}
    >
      <OgMicrolabel size={24}>Builds and parts</OgMicrolabel>
      <div
        style={{
          display: "flex",
          fontSize: 232,
          fontWeight: 700,
          lineHeight: 1,
          letterSpacing: -12,
          ...ogWeight(232, OG_COLORS.onInk),
        }}
      >
        DRVN<span style={{ color: OG_COLORS.dot, ...ogWeight(232, OG_COLORS.dot) }}>.</span>
      </div>
      <div style={{ display: "flex", fontSize: 28, color: OG_COLORS.dim }}>
        The home for your car and its build.
      </div>
    </div>
  );
}

/** Cut a headline so it fits the card instead of running off it. */
export function ogClamp(text: string, max: number) {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The icon mark: a `D` on an ink plate (brand.md — there is no drawn logo; in
 * tight spaces the monogram is a D on ink with radius 10px). The radius is
 * 10px at the 40px monogram, so it scales at a quarter of the side.
 */
export function OgMonogram({ side }: { side: number }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: OG_COLORS.ink,
        color: OG_COLORS.onInk,
        borderRadius: Math.round(side * 0.25),
        fontFamily: "sans-serif",
        fontSize: Math.round(side * 0.72),
        fontWeight: 700,
        lineHeight: 1,
        ...ogWeight(side * 0.72, OG_COLORS.onInk),
        // Optical centring: a capital sits a little low in its box.
        paddingBottom: Math.round(side * 0.06),
      }}
    >
      D
    </div>
  );
}
