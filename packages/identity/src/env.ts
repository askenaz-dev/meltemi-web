/**
 * The minimal D1 surface the service uses. A D1 binding satisfies it, and so does the
 * `node:sqlite` adapter of the tests, so the same SQL runs in both.
 */
export interface D1PreparedLike {
  bind(...values: unknown[]): D1PreparedLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  /** What D1 answers for a write: `meta.changes` is the number of rows the statement changed. */
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface D1Like {
  prepare(sql: string): D1PreparedLike;
  /** Runs the statements in order in one transaction. */
  batch(statements: D1PreparedLike[]): Promise<unknown[]>;
}

/**
 * What `wrangler.jsonc` (vars), `.dev.vars` (development values) and the secrets give the
 * service. Everything is a string; `config.ts` reads it. In production each secret arrives as a
 * Secrets Store binding named `<NAME>_STORE` (`wrangler.jsonc`, `secrets_store_secrets`), which
 * `secrets.ts` reads into `<NAME>` at the Worker's entry, so nothing below the entry sees a
 * binding; in development and in the tests the secret is the string of `.dev.vars`.
 */
export interface Env {
  /** The address of this service, `https://id.meltemi.dev` (the token's `iss`). */
  readonly ISSUER: string;
  /** The registrable domain of the family's hosts, `meltemi.dev`. */
  readonly COOKIE_DOMAIN: string;
  /** The family's site: the default return address and the home of the legal pages. */
  readonly SITE_URL: string;
  /** A JSON array of public JWKs, current first. */
  readonly SESSION_PUBLIC_KEYS: string;
  /** A JSON array of `{ name, events }`, one entry per product that receives deletion events. */
  readonly PRODUCTS: string;
  readonly GITHUB_CLIENT_ID: string;
  readonly GOOGLE_CLIENT_ID: string;
  /** `"true"` only in `.dev.vars`, never in `wrangler.jsonc`. */
  readonly DEV?: string;
  /** Comma-separated origins accepted as return addresses and form targets in development. */
  readonly DEV_ORIGINS?: string;

  readonly GITHUB_CLIENT_SECRET: string;
  readonly GOOGLE_CLIENT_SECRET: string;
  /** A private JWK with a `kid`. */
  readonly SESSION_PRIVATE_KEY: string;
  /** The HMAC key of the `meltemi_oauth` cookie and of the account forms' `csrf`. */
  readonly STATE_SECRET: string;
  /** `EVENTS_SECRET_<PRODUCT>`: the key that signs the deletion events of one product. */
  readonly [secret: `EVENTS_SECRET_${string}`]: string | undefined;

  readonly DB: D1Like;
}
