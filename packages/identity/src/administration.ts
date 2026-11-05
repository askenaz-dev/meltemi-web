import type { Env } from "./env.js";

/** Only the established service owners may control the family's documentation AI. */
export function isDocsAiOwner(env: Pick<Env, "ADMIN_SUBS">, sub: string): boolean {
  return (env.ADMIN_SUBS ?? "")
    .split(",")
    .map((owner) => owner.trim())
    .some((owner) => owner !== "" && owner === sub);
}
