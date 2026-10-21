# 0003. The family's web on Cloudflare

Status: accepted (identity-service and product-site changes, 13 October 2026)

## Context

The site is served by GitHub Pages from the IDE repository; Meltemi Diagrams decided to host its
service on Cloudflare Workers (free plan: Workers, D1, R2, Durable Objects). The identity
service needs a runtime with a database, and the shared cookie needs `id.meltemi.dev` and
`diagrams.meltemi.dev` under one registrable domain that Cloudflare serves. The owner holds
`meltemi.dev`; its nameservers are at the registrar today.

## Decision

- **One platform.** The site becomes static assets of a Worker (no Worker code: `_headers` for
  the policy, `_redirects` for the old addresses), and the identity service a Worker with a D1
  database and a cron trigger. Both deploy with `wrangler`; both run locally with `wrangler dev`.
- **The zone on Cloudflare.** The delivery change moves the nameservers of `meltemi.dev` to
  Cloudflare, keeps GitHub Releases for the IDE's downloads, and retires GitHub Pages once the
  site answers from Cloudflare.
- **Nothing needs the cloud to be built.** Handlers are plain functions; stores have in-memory
  implementations; tests stub the providers. The D1 implementation is tested over `node:sqlite`
  where Node offers it.

## Alternatives considered

- **Keep the site on GitHub Pages.** Free and already working, but no response headers (no
  Content-Security-Policy), no redirects beyond a page's `<meta>`, and a second platform to
  operate.
- **Cloudflare Pages.** The same assets with a dashboard-first workflow; Workers static assets
  give the same result under one tool and one configuration file per Worker.
- **Vercel or Netlify.** More platforms, no benefit over the one Diagrams already uses.

## Consequences

- Two Workers in this repository (`site`, `identity`), each with its `wrangler.jsonc`.
- `.dev.vars.example` lists the secrets' names; the delivery change puts the real values in
  Worker secrets.
- The site's `_redirects` keeps every address GitHub Pages served answering.
- `id.meltemi.dev`, `diagrams.meltemi.dev` and Diagrams' publish host are Workers Custom
  Domains (`routes: [{ pattern: "…", custom_domain: true }]`), never zone Routes: a Worker can
  `fetch` another Worker on the same zone only through a Custom Domain (error 1042 otherwise),
  and the JWKS fetch, the session check and the deletion events cross between Workers. The
  delivery change inherits it.
