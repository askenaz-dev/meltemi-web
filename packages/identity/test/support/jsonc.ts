// A reader for the JSON-with-comments files of the repository (`wrangler.jsonc`, tsconfig): it
// tells whether comments were there, so a test can say a file has none, and it accepts the
// trailing commas Prettier writes in `.jsonc` files.

export interface Jsonc {
  readonly value: unknown;
  /** Whether the text held a line or block comment outside its strings. */
  readonly hadComments: boolean;
  /** Whether the text held a comma before a closing `}` or `]`. */
  readonly hadTrailingCommas: boolean;
}

export function readJsonc(text: string): Jsonc {
  let out = "";
  let hadComments = false;
  let hadTrailingCommas = false;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      hadComments = true;
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      hadComments = true;
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else if (c === ",") {
      let next = i + 1;
      while (next < text.length && /\s/.test(text[next]!)) next++;
      if (text[next] === "}" || text[next] === "]") hadTrailingCommas = true;
      else out += c;
    } else {
      out += c;
    }
  }
  return { value: JSON.parse(out) as unknown, hadComments, hadTrailingCommas };
}

/** Every property name and every string value of a parsed document, at any depth. */
export function namesIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(namesIn);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...namesIn(inner)]);
  }
  return [];
}
