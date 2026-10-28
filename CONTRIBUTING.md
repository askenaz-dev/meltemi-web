# Contributing

## Ground rules

- Products consume a contract, not the service's internals: the session cookie, the JWT, the
  JWKS, `GET /sessions/:sid`, `POST /logout`, `GET /login` and the signed events. Changing any
  of them is a change to the `identity-session` specification, announced to the products'
  repositories.
- No leaked secret: provider secrets, signing keys and event secrets live in the family's Secrets
  Store (declared in `packages/infra`) and in `.dev.vars`; tests use generated keys and stub
  providers; nothing in a fixture is real.
- No data loss: deleting an account deletes everything the service holds about it and tells
  every product; a defect there is a release blocker and needs a regression test.
- Every page speaks English and Spanish and declares a Content-Security-Policy.

## Workflow

1. Changes are planned with OpenSpec: proposal, design, specs and tasks under
   `openspec/changes/<name>/`.
2. Implement the tasks in order and tick each checkbox when its test passes.
3. Run `pnpm typecheck`, `pnpm lint`, `pnpm build` and `pnpm test` before asking for review: CI
   runs the same on Node 22 and 24, on Linux and Windows. Changes to `packages/infra` also run
   `pnpm infra:fmt` and `pnpm infra:test` (Terraform; no credential needed).
4. Changes to the identity service also run `pnpm identity:dev` and sign in with the
   development OAuth apps named in `.dev.vars.example`, in a browser, before archiving.
5. Changes to the site also run `pnpm site:dev` and read every changed page in both languages.

## Delivery

Nothing is configured or deployed from a machine ([decision 0004](docs/decisions/0004-delivery.md)):

- **Infrastructure** is a pull request that changes `packages/infra`; `infra-plan.yml` writes its
  plan on the pull request, and merging applies that change (`infra-apply.yml`). A difference made
  in a dashboard shows up as the issue "Infrastructure drift".
- **Code** reaches production when it reaches `main`: `deploy.yml` applies the identity
  migrations and uploads the identity Worker and the site.
- **The packages** are released by pushing a tag equal to their version: `v<x.y.z>` for
  `packages/identity`, which `release.yml` publishes as `@meltemi/identity` with provenance and a
  GitHub release, and `ocean-v<x.y.z>` for `packages/ocean`, published as `@meltemi/ocean` with
  provenance.
- **Secrets** are never typed into a Worker: they live in the Secrets Store, generated or received
  by Terraform. The values only a person can obtain are the bootstrap of `packages/infra/README.md`.
