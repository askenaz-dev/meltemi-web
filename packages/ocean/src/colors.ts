// The sea's colours, read from four CSS custom properties on the canvas so every product dresses
// the sea in its own tokens: `--sea-point`, `--sea-crest`, `--sea-wind` and `--sea-bg`. A missing
// or unreadable value falls back to the brand's: Aegean blue and wind cyan.

export interface Colour {
  /** Channels between 0 and 1, not premultiplied. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
  /** The same colour as CSS. */
  readonly css: string;
}

export interface Palette {
  readonly point: Colour;
  readonly crest: Colour;
  readonly wind: Colour;
  readonly bg: Colour;
}

/** The brand's values, used when a property is missing. */
export const BRAND = {
  point: "#2563eb",
  crest: "#22d3ee",
  wind: "#22d3ee",
  bg: "rgba(0, 0, 0, 0)",
} as const;

/** A CSS colour as channels, for `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`. */
export function parseColour(text: string): Colour | undefined {
  const value = text.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
  if (hex) {
    let digits = hex[1]!;
    if (digits.length <= 4) digits = [...digits].map((c) => c + c).join("");
    const n = (i: number) => parseInt(digits.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: digits.length === 8 ? n(6) : 1, css: value };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(
    value,
  );
  if (rgb) {
    const alpha =
      rgb[4] === undefined
        ? 1
        : rgb[4].endsWith("%")
          ? parseFloat(rgb[4]) / 100
          : parseFloat(rgb[4]);
    const channel = (s: string) => Math.min(255, Math.max(0, parseFloat(s))) / 255;
    return {
      r: channel(rgb[1]!),
      g: channel(rgb[2]!),
      b: channel(rgb[3]!),
      a: Math.min(1, Math.max(0, alpha)),
      css: value,
    };
  }
  return undefined;
}

/** Something that answers `getPropertyValue`, as `getComputedStyle` does. */
export interface StyleSource {
  getPropertyValue(name: string): string;
}

/** The palette a style declares, each missing value taking the brand's. */
export function paletteOf(style: StyleSource | undefined): Palette {
  const pick = (name: keyof typeof BRAND): Colour => {
    const declared = style?.getPropertyValue(`--sea-${name}`) ?? "";
    return parseColour(declared) ?? (parseColour(BRAND[name]) as Colour);
  };
  return { point: pick("point"), crest: pick("crest"), wind: pick("wind"), bg: pick("bg") };
}
