import type { User } from "./types.js";

export const ACCOUNT_THEMES = ["system", "light", "dark"] as const;
export const ACCOUNT_LANGUAGES = ["system", "en", "es"] as const;
export type AccountTheme = (typeof ACCOUNT_THEMES)[number];
export type AccountLanguage = (typeof ACCOUNT_LANGUAGES)[number];
export interface AccountPreferences {
  readonly displayName: string | null;
  readonly theme: AccountTheme;
  readonly language: AccountLanguage;
}
export const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = Object.freeze({
  displayName: null,
  theme: "system",
  language: "system",
});

export const isAccountTheme = (value: unknown): value is AccountTheme =>
  typeof value === "string" && (ACCOUNT_THEMES as readonly string[]).includes(value);
export const isAccountLanguage = (value: unknown): value is AccountLanguage =>
  typeof value === "string" && (ACCOUNT_LANGUAGES as readonly string[]).includes(value);

/** Empty restores the provider's name; invalid input is distinct from an explicit reset. */
export function readDisplayName(value: unknown): string | null | undefined {
  if (
    typeof value !== "string" ||
    /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069]/u.test(value)
  )
    return undefined;
  const name = value.trim().normalize("NFC");
  if ([...name].length > 80) return undefined;
  return name === "" ? null : name;
}

export function personalizedUser(user: User, preferences: AccountPreferences): User {
  return preferences.displayName === null ? user : { ...user, name: preferences.displayName };
}
