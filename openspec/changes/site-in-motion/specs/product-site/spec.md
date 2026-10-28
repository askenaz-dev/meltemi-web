## RENAMED Requirements

- FROM: `### Requirement: Static assets with no script and no external resource`
- TO: `### Requirement: Self-hosted scripts and no external resource`

## MODIFIED Requirements

### Requirement: Self-hosted scripts and no external resource
A page MAY load module scripts served by the site itself from `/assets/`. No page SHALL contain any of the following:
- an inline `<script>` (one without `src`);
- a script whose address is not under `/assets/`;
- an inline event handler or a `javascript:` address;
- a stylesheet, image or font from another origin.

`_headers` SHALL apply to `/*` the following headers:
- `Content-Security-Policy: default-src 'none'; script-src 'self'; img-src 'self'; style-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types 'none'`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=31536000`

`wrangler.jsonc` SHALL declare `assets`, `dev: { port: 8789 }` and no `main`.

#### Scenario: Headers present
- **WHEN** the checks read `public/_headers`
- **THEN** the rule for `/*` names every header above with those values

#### Scenario: An external stylesheet fails
- **WHEN** a page links `https://fonts.googleapis.com/css`
- **THEN** `pnpm test` fails naming the page and the address

#### Scenario: The site's own module passes
- **WHEN** a page loads `<script type="module" src="/assets/site.js">`
- **THEN** the checks pass, and the browser check reports no Content-Security-Policy violation on that page

#### Scenario: An inline or foreign script fails
- **WHEN** a page carries `<script>` with a body, an `onclick` attribute, or `<script src="https://cdn.jsdelivr.net/…">`
- **THEN** `pnpm test` fails naming the page and the offending element
