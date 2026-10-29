# Design — ide-state-as-it-is

## Context

`/ide/` and `/es/ide/` carry a section `state` ("Honest state, before 1.0") with a three-column
table: capability, status and notes. The home and the Diagrams page have their own state tables,
pinned since `state-as-it-is` by `STATE_AS_IT_IS` in `packages/site/test/site.test.ts`. That
constant compares two cells per row and asserts that no pinned page says "Not yet". The IDE's
table is pinned by nothing.

## Decisions

### D1. The words

| Row | State (en / es) | Note (en) | Note (es) |
| --- | --- | --- | --- |
| Daemon, terminal surface, spec engine | Published / Publicado | unchanged | unchanged |
| Desktop client | In development / En desarrollo | Installers ship with each release; Windows and macOS warn on first run until they carry platform signatures, and tool calls show only their title. | Los instaladores salen en cada release; Windows y macOS avisan en el primer arranque hasta que lleven firma de plataforma, y las llamadas a herramientas muestran solo su título. |
| Public SDK | Not yet / Todavía no | There is no packaged SDK yet; the contract is public as JSON Schemas, and the command line is scriptable with `--json`. | Todavía no hay un SDK empaquetado; el contrato es público como JSON Schemas, y la línea de comandos se programa con `--json`. |
| Mobile companion | In development / En desarrollo (style `pending`, `◔`) | Android, built from source and tested on an emulator; no APK is published yet. | Android, se compila desde el código y se probó en un emulador; todavía no se publica un APK. |

The notes are the ones the IDE writes into its own `docs/capacidades.toml`
(`estado-que-publica-la-release` D3). When `ide-state-from-release` starts painting the table from
the release, not a word changes.

The lead sentence becomes "Where each part stands, stated plainly" / «Dónde está cada parte, dicho
sin rodeos». The notice ("Pre-1.0 … the desktop client is in active development") stays: it is
true.

### D2. The check: its own pin, with notes

Two alternatives:

- Add the IDE pages to `STATE_AS_IT_IS`. It compares two cells of a four-column table and forbids
  "Not yet" on every pinned page, and the SDK row legitimately says "Not yet".
- **A separate `IDE_STATE_AS_IT_IS`** (recommended). It pins all three cells of each row, because
  the note is where this table went stale ("nothing is shipped"). It carries a comment with the
  date and how each row was verified, and the "Not yet" ban stays scoped to the pages it was
  written for.

A row whose name, state or note differs fails naming the page and the row. The test records a
verification and does not perform one: `pnpm test` reaches no network. The next verification
updates it, until `ide-state-from-release` replaces the record with the release's own.

## Modules

- `packages/site/public/{ide,es/ide}/index.html` and `packages/site/test/site.test.ts`. No script,
  no runtime change, nothing that reaches the network.
