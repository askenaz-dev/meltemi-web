# Design — ide-state-from-release

## Context

`deploy.yml` builds the site, uploads the identity Worker, runs `scripts/ide-release.mjs public`
with the run's read-only token, then uploads the site Worker. `ide-release.mjs` fetches the
latest release, validates it and writes a sentence between markers. When GitHub does not answer,
it keeps the committed sentence and exits 0. When a page lacks its markers, it exits 1 and the
deploy stops before uploading.

The IDE's `estado-que-publica-la-release` publishes `capabilities.json` with every release. It
has a stable name, so `releases/latest/download/capabilities.json` resolves, and it is covered by
the release's `SHA256SUMS` and attestation:

```json
{
  "version": "0.3.0",
  "capabilities": [
    {
      "id": "mobile",
      "state": "in-development",
      "name": { "en": "Mobile companion", "es": "Compañero móvil" },
      "note": { "en": "…", "es": "…" },
      "assets": [{ "name": "…", "platformSigned": false }]
    }
  ]
}
```

## Decisions

### D1. Verify in the workflow, render in the script

Two alternatives:

- The script fetches the file itself, as `ide-release.mjs` fetches the release. It is simpler,
  but the site would paint whatever answered at that URL, attested or not.
- **The workflow downloads and verifies, the script renders a local file** (recommended).
  `gh release download` and `gh attestation verify --signer-workflow
  askenaz-dev/meltemi/.github/workflows/release.yml` are the same two commands the downloads page
  tells people to run. The site then shows only what the IDE's release workflow published, and
  the script stays a pure function of files that tests feed from fixtures.

```bash
dir="$RUNNER_TEMP/ide"
if tag=$(gh release view --repo askenaz-dev/meltemi --json tagName -q .tagName) &&
  gh release download "$tag" --repo askenaz-dev/meltemi --pattern capabilities.json --dir "$dir" &&
  gh attestation verify "$dir/capabilities.json" --repo askenaz-dev/meltemi \
    --signer-workflow askenaz-dev/meltemi/.github/workflows/release.yml; then
  node scripts/ide-capabilities.mjs public "$dir/capabilities.json" "$tag"
else
  echo "The IDE's capabilities could not be fetched or verified: the pages keep their rows"
fi
```

The chain sits in the `if` condition, so a failure there takes the `else` branch even under the
runner's `set -e`. The `node` call is in the body, so its exit 1 (markers missing) fails the step
and stops the deploy, as it must. A release without the file fails `gh release download`, which is
the "keep the committed rows" branch: that is every release before the IDE ships the file.

### D2. What the script accepts

`capabilitiesOf(json, tag)` returns the model or a reason. The file is used only when every check
passes; one bad entry discards the whole file rather than painting a partial table:

- `version` is `x.y.z` and `v${version}` equals the tag;
- `capabilities` is a non-empty array;
- every entry has a unique `id`, a `state` among `published`, `in-development` and `not-yet`, and
  non-empty `name.en`, `name.es`, `note.en` and `note.es`.

The rendering escapes every value. States map to the styles and words the table already uses:

| State | Class | Symbol | en | es |
| --- | --- | --- | --- | --- |
| `published` | `ok` | ● | Published | Publicado |
| `in-development` | `pending` | ◔ | In development | En desarrollo |
| `not-yet` | `absent` | ○ | Not yet | Todavía no |

Rows keep the file's order. `assets` and `platformSigned` are read and not shown: the note is
what speaks to people, and the IDE writes it.

Exit codes are the same as `ide-release.mjs`: 0 written or kept, 1 a page lacks its markers,
2 bad arguments.

### D3. One helper for both scripts

`scripts/blocks.mjs` exports `escape(text)` and `between(html, begin, end, block)`, which returns
`undefined` unless each marker appears exactly once and in order. `ide-release.mjs` keeps its
exported names (`inject` becomes a thin call), so its tests do not change.

### D4. The switch changes no words

`test/fixtures/capabilities.json` mirrors the IDE's `docs/capacidades.toml` as written by
`estado-que-publica-la-release` (D3 there). A test renders it into the committed pages and
asserts the rows equal the committed ones, cell by cell, in both languages. While the record and
the IDE agree, a deploy paints the same table people already read. When the IDE's file changes,
the fixture and the committed rows are updated together in this repository, and
`ide-state-as-it-is`'s pin goes with them.

## Modules

- `packages/site/scripts/blocks.mjs` (new): `escape`, `between`.
- `packages/site/scripts/ide-capabilities.mjs` (new): `BEGIN`, `END`, `PAGES`, `capabilitiesOf`,
  `renderRows`, `main(publicDir, file, tag)`.
- `packages/site/scripts/ide-release.mjs`: uses `blocks.mjs`.
- `.github/workflows/deploy.yml`: the step of D1, before "Family site".

## Runs locally, tests without network

`node scripts/ide-capabilities.mjs public <file> <tag>` runs against any local file. The tests
feed fixtures (valid, wrong version, unknown state, missing Spanish note, invalid JSON, page
without markers) and never call `gh` or `fetch`.
