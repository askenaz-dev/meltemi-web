import type { Route } from "../context.js";
import { IDENTITY_CSS } from "../pages/css.js";

/** `GET /identity.css`: the stylesheet of the pages. */
export const cssRoute: Route = async () =>
  new Response(IDENTITY_CSS, {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });

/** `GET /.well-known/jwks.json`: the public keys, current first, never anything private. */
export const jwksRoute: Route = async (ctx) => {
  const keys = ctx.deps.keys.publicJwks.map(({ kty, crv, use, alg, kid, x, y }) => ({
    kty,
    crv,
    use: use ?? "sig",
    alg: alg ?? "ES256",
    kid,
    x,
    y,
  }));
  return new Response(JSON.stringify({ keys }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
