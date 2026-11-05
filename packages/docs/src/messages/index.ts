import { en, type Messages } from "./en.js";
import { es } from "./es.js";

export type { Messages, Section } from "./en.js";
export type Lang = "en" | "es";

export const LANGS: readonly Lang[] = ["en", "es"];

export const messages: Record<Lang, Messages> = { en, es };

/** The catalog of a language, English for anything else. */
export function messagesOf(lang: string | undefined): Messages {
  return lang === "es" ? es : en;
}
