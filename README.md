# Meltemi Web

The web of the Meltemi family: the product site at [meltemi.dev](https://meltemi.dev) and the
shared identity service at `id.meltemi.dev`. Meltemi is one brand with two products, the
[Meltemi IDE](https://github.com/askenaz-dev/meltemi) and Meltemi Diagrams; each lives in its
own repository, and this one holds what they share: the site people arrive at and the account
they sign in with. [docs/repositories.md](docs/repositories.md) maps the three repositories,
their domains and the contracts between them.

## What is here

| Folder                 | What                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| `openspec/`            | Changes and specifications (OpenSpec): `identity-service`, `product-site` |
| `docs/repositories.md` | The family's repositories, domains and the contracts between them         |
| `docs/decisions/`      | Decision records                                                          |
| `packages/site`        | The static site, written by the `product-site` change                     |
| `packages/identity`    | The identity Worker, written by the `identity-service` change             |
| `packages/infra`       | The family's infrastructure as code (Terraform): Cloudflare and GitHub    |
| `.github/workflows/`   | CI, deploy, release, and the infrastructure's plan, apply and drift       |

## Status

Built and tested locally; delivered by the `delivery` change
([decision 0004](docs/decisions/0004-delivery.md)). The repository is
[`askenaz-dev/meltemi-web`](https://github.com/askenaz-dev/meltemi-web). Everything that runs in
the cloud is declared in `packages/infra` and applied by the pipelines: zones, records, Workers,
databases, the bucket, Custom Domains, secrets, deploy tokens and the GitHub repositories. Nothing
is configured from a machine; the few values only a person can obtain are the bootstrap that
[`packages/infra/README.md`](packages/infra/README.md) lists.

## Working here

Read [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md). Changes follow OpenSpec:
`/opsx:propose`, `/opsx:apply`, `/opsx:archive`; the context and rules the artifacts follow are
in [openspec/config.yaml](openspec/config.yaml).

## Licence

Apache-2.0, the licence of the site files this repository takes over from the IDE repository;
the owner confirms it before the first publication (decision 0001).
