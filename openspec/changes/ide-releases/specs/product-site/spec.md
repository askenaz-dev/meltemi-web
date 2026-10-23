## ADDED Requirements

### Requirement: The IDE's pages tell its release as it is
`/ide/` and `/es/ide/` SHALL carry, between `<!-- ide-release -->` and `<!-- /ide-release -->`, a
version-free sentence that links the IDE's latest release
(`https://github.com/askenaz-dev/meltemi/releases/latest`); at deploy time
`packages/site/scripts/ide-release.mjs` SHALL replace it with the version, the date and the link to
the tag of the newest published release, building the link from the tag and escaping every value,
and SHALL keep the committed sentence when the release it is given is a draft, a pre-release, a tag
that is not `v<x.y.z>` or has no ISO 8601 date. `/ide/downloads/` and `/es/ide/downloads/` SHALL
describe verification as two checks — the checksum, and `gh attestation verify` pinned with
`--signer-workflow` to the IDE's release workflow — and SHALL name no maintainer's key and no
`minisign`. The checks SHALL fail otherwise, naming the page.

#### Scenario: The block at rest
- **WHEN** the checks read `/ide/` and `/es/ide/`
- **THEN** each carries the two markers once, with a sentence between them that links the latest-release form and names no version

#### Scenario: A published release
- **WHEN** the script is given the latest release `v0.2.0`, published on 2026-10-24
- **THEN** the English block names `v0.2.0` and 2026-10-24 and links `https://github.com/askenaz-dev/meltemi/releases/tag/v0.2.0`, and the Spanish block says the same in Spanish

#### Scenario: A release that is not a version
- **WHEN** the script is given a tag `nightly`, a draft or a pre-release
- **THEN** it renders nothing and the committed sentence stays

#### Scenario: Markers missing
- **WHEN** one of the two pages lacks its markers
- **THEN** the script fails naming the page, before the site is uploaded

#### Scenario: The verification as it is
- **WHEN** the checks read `/ide/downloads/` and `/es/ide/downloads/`
- **THEN** each names `gh attestation verify` and `--signer-workflow askenaz-dev/meltemi/.github/workflows/release.yml`, and neither names `minisign` or the maintainer's key
