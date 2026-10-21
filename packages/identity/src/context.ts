import type { Config } from "./config.js";
import type { Env } from "./env.js";
import type { Deps, Lang } from "./types.js";

/** What every route receives: the request and everything it needs, already read and checked. */
export interface Ctx {
  readonly request: Request;
  readonly url: URL;
  readonly env: Env;
  readonly deps: Deps;
  readonly config: Config;
  /** The language of the page that answers. */
  readonly lang: Lang;
  /** The captured parts of the path (`/sessions/:sid` gives `sid`). */
  readonly params: Readonly<Record<string, string>>;
}

export type Route = (ctx: Ctx) => Promise<Response>;
