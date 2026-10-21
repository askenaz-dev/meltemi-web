import type { Lang } from "../types.js";
import { en, type Messages } from "./en.js";
import { es } from "./es.js";

export type { Messages } from "./en.js";

/** The catalog of a language. Look words up when a page is made, never at module load. */
export function messages(lang: Lang): Messages {
  return lang === "es" ? es : en;
}

/** The language of a request: `?lang=en|es`, else the best of those in `Accept-Language`, else English. */
export function resolveLang(url: URL, acceptLanguage: string | null): Lang {
  const asked = url.searchParams.get("lang");
  if (asked === "en" || asked === "es") return asked;
  const ranked: { lang: Lang; q: number; order: number }[] = [];
  (acceptLanguage ?? "").split(",").forEach((part, order) => {
    const [tag, ...params] = part.trim().split(";");
    const primary = (tag ?? "").trim().toLowerCase().split("-")[0];
    if (primary !== "en" && primary !== "es") return;
    const q = params
      .map((p) => /^\s*q\s*=\s*([\d.]+)\s*$/.exec(p)?.[1])
      .find((v) => v !== undefined);
    const weight = q === undefined ? 1 : Number(q);
    if (Number.isFinite(weight) && weight > 0) ranked.push({ lang: primary, q: weight, order });
  });
  ranked.sort((a, b) => b.q - a.q || a.order - b.order);
  return ranked[0]?.lang ?? "en";
}
