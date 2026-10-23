# The Meltemi family: repositories, domains and contracts

Meltemi is one brand with two products and one web. Each lives in its own repository because
they are written in different languages, release at different rhythms and make different
promises: the IDE promises no accounts and no cloud; Diagrams works without an account and adds
one as a layer; the web holds what both share. Decided on 13 October 2026
([decision 0001](decisions/0001-family-repositories.md)).

## Repositories

| Repository                                                                                              | Working folder         | Holds                                                                                                                                                                                        | Domains                         | Stack                                                         |
| ------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------- |
| **Meltemi IDE**, [`askenaz-dev/meltemi`](https://github.com/askenaz-dev/meltemi)                        | `C:\forge\agentic-ide` | The agentic IDE: desktop app, terminal app and the `meltemid` daemon; the design system and the brand sources                                                                                | Downloads from GitHub Releases  | Rust, Svelte                                                  |
| **Meltemi Diagrams**, [`askenaz-dev/meltemi-diagrams`](https://github.com/askenaz-dev/meltemi-diagrams) | `C:\development\dac`   | The `.meltemi` language, the CLI, the VS Code extension, the playground, and the hosted service (`packages/cloud`: accounts' projects, versions, sharing, collaboration, published catalogs) | `diagrams.meltemi.dev`          | TypeScript, pnpm, Cloudflare Workers, D1, R2, Durable Objects |
| **Meltemi Web**, [`askenaz-dev/meltemi-web`](https://github.com/askenaz-dev/meltemi-web)                | `C:\meltemi`           | The product site, the shared identity service, and the family's infrastructure as code (`packages/infra`)                                                                                    | `meltemi.dev`, `id.meltemi.dev` | TypeScript, pnpm, Cloudflare Workers, D1                      |

The IDE repository served the site from its `site/` folder through GitHub Pages until the
`product-site` change moved it here. Its change `release-con-el-push` then removed `site/`, the
Pages job of `.github/workflows/release.yml`, `core/meltemid/tests/site.rs` and
`core/meltemid/tests/scenarios_sitio.rs`, and retargeted `scripts/capture-desktop.ps1` and
`tui/examples/capture_svg.rs` to `docs/media/`, from where this repository copies the captures;
the token rule of `site.rs` (the site's tokens equal, name and value, to
`desktop/ui/src/app.css`) is `pnpm site:tokens --ide <path>` in this repository. The IDE
repository holds the IDE only.

Working folders on the owner's machine:

```
C:\forge\agentic-ide      Meltemi IDE (clone of askenaz-dev/meltemi)
C:\development\dac        Meltemi Diagrams (clone of askenaz-dev/meltemi-diagrams)
C:\meltemi                Meltemi Web, this repository (clone of askenaz-dev/meltemi-web)
  ├── packages/site       the product site          (product-site change)
  ├── packages/identity   the identity service      (identity-service change)
  ├── packages/infra      the family's infrastructure as code (delivery change)
  ├── docs/               this map and the decisions
  └── openspec/           changes and specifications
```

## Domains

| Address                | Served by                                         | From                                 |
| ---------------------- | ------------------------------------------------- | ------------------------------------ |
| `meltemi.dev`          | Cloudflare Workers, static assets                 | this repository, `packages/site`     |
| `id.meltemi.dev`       | Cloudflare Worker with D1                         | this repository, `packages/identity` |
| `diagrams.meltemi.dev` | Cloudflare Worker with D1, R2 and Durable Objects | Meltemi Diagrams, `packages/cloud`   |
| `meltemi.page`         | Cloudflare Worker reading D1 and R2               | Meltemi Diagrams, `packages/cloud`   |

Both domains are registered at Dynadot; their zones are on Cloudflare, declared with every record
in `packages/infra`, which also declares the four Workers, their Custom Domains, storage and
secrets ([decision 0004](decisions/0004-delivery.md)). The products' repositories upload their
Workers' code and create nothing. `meltemi.page` is a registrable domain of its own because it
serves what people publish, which must never share the cookie of `meltemi.dev`. GitHub Releases
keep serving the IDE's installers.

`id.meltemi.dev`, `diagrams.meltemi.dev` and Diagrams' publish host are deployed as Workers
Custom Domains (`routes: [{ pattern: "…", custom_domain: true }]` in each `wrangler.jsonc`),
never as Routes: a Worker can `fetch` another Worker on its zone only through a Custom Domain
(Cloudflare error 1042 otherwise), and the JWKS fetch, `GET /sessions/:sid` and the deletion
events are such fetches.

## What crosses between repositories

```
 meltemi.dev ──── links ────▶ diagrams.meltemi.dev      (open the app, install, docs)
      │   ▲                          │
      │   │ release notice           │ consumes
      ▼   │ (deploy dispatch)        ▼
 GitHub Releases (IDE)        id.meltemi.dev ── session contract ──▶ any product
                                    │
                                    └── signed events (user.deleted) ──▶ each product
```

1. **The session contract** (specification `identity-session`, package `packages/identity`):
   the cookie `meltemi_session` on `.meltemi.dev`, an ES256 JWT with `iss https://id.meltemi.dev`,
   `aud meltemi`, `sub`, `sid`, `name`, `picture`, `email`, `email_verified` and `exp`; the
   public keys at `/.well-known/jwks.json`; `GET /sessions/:sid` to learn that a session was
   revoked; `POST /logout` to end one; `GET /login?return_to=` to start one. A product verifies
   the JWT with the public key, keeps its own data by `sub`, and checks the session at most once
   an hour. The reference verifier is a module of the identity package with no Cloudflare
   dependency, and `@meltemi/identity/testing` mints sessions for a product's own tests. The
   package README is the full contract for products. The package is published on npm as
   `@meltemi/identity`, with provenance, by this repository's release workflow; Meltemi Diagrams
   depends on it from `packages/cloud`.
2. **Account deletion events**: a `POST` to each product's events address, signed with
   `Meltemi-Signature`, retried for seven days. A product deletes what it holds for that `sub`.
   The Diagrams entry is
   `PRODUCTS=[{"name":"diagrams","events":"https://diagrams.meltemi.dev/_identity/events"}]`
   with the secret `EVENTS_SECRET_DIAGRAMS` (the name upper-cased); in development the address
   is `http://localhost:8788/_identity/events`. Diagrams' `IDENTITY_EVENTS_SECRET` holds the
   same value.
3. **The site's links**: the Diagrams page links to the app and the install commands; the IDE
   pages link to the releases, and each deploy writes the IDE's latest published release into
   `/ide/` from GitHub's public API. Nothing else is shared at run time.
4. **Brand**: the normative design system and brand sources stay in the IDE repository
   (`design-system/`, `brand/`); the site and the identity pages carry a copy of the tokens
   (`tokens.css`) whose header names the source commit.
5. **The IDE's release path** (change `ide-releases`; the IDE's `release-con-el-push`): the IDE
   releases with no hand on it, from a version commit on its `main`. This repository's Terraform
   declares what that path relies on and nothing else of the IDE repository: the rulesets of its
   `main` and of its `v*` tags, its `release` environment (branch `main`) with the secret
   `WEB_DISPATCH_TOKEN`, and read-only workflow permissions. Once a release is published, the
   IDE's release workflow starts this repository's `deploy.yml` with that token, which can start
   this repository's workflows and cannot write its code; the notice carries no data.

Each product owns its own data, API, storage and quotas. The identity service never holds a
product's data and never receives a provider's token from a product.

## Two rules the shared cookie imposes on every product

The cookie is sent to every host under `meltemi.dev`, and every host under it is the same site
for `SameSite`: a form on one subdomain posts to another with the cookie attached.

- A product checks the `Origin` header of every request that changes state against its own
  origin, and never treats a bare cookie as consent.
- A product never serves content it did not author (a person's uploaded or published HTML)
  from a host under `meltemi.dev`; such content goes to a separate registrable domain. Meltemi
  Diagrams' published catalogs follow this rule.

## Delivery

By the owner's decision of 13 October 2026, functionality came first: each repository
implemented and tested its changes locally (`wrangler dev`, in-memory stores, stub providers,
browser checks). Delivery followed on 20 October 2026 with two rules: infrastructure is Terraform,
and everything runs as GitHub pipelines ([decision 0004](decisions/0004-delivery.md)). This
repository delivers first (the zones, every Worker's entity, storage and secrets, the identity
service, the site, the published package); Meltemi Diagrams then installs the package and uploads
its two Workers onto what `packages/infra` declared.
