# CLI reference

`ddduck` operates on a selected product root. Run `ddduck --help`, or pass `--help` anywhere
after a command name (including `ddduck <command> <subcommand> --help`), for the built-in usage
lines. Option values may be written as `--option value` or `--option=value`; a value that begins
with `--` must use the `--option=value` form. Every command rejects unknown options, duplicate
options, missing option values, and unexpected positional arguments. Expected failures write a
concise diagnostic (multi-error validation reports keep one line per error) plus a safe next
action to standard error and exit nonzero; errors without a specific next action fall back to a
command-specific hint. Help exits zero. Exit codes are part of the contract: the one retryable
failure — a busy product root, whose operation lock is held by a running process — exits 2, so
retry logic never has to string-match standard error; every other failure exits 1.

This package is published to npm as `ddduck`; install the CLI globally with `npm install -g ddduck`
(see [the getting-started guide](getting-started.md#install-ddduck)).

## `--version`

```text
ddduck --version [--json]
ddduck -v [--json]
```

| Option   | Default | Meaning                                        |
| -------- | ------- | ---------------------------------------------- |
| `--json` | false   | Emit one JSON object instead of the text line. |

`--version` (alias `-v`) prints the installed package name and version taken from the package's
own `package.json`, as one text line — `ddduck <version>` — or, with `--json`, one object:
`{"name":"ddduck","version":"<version>"}`. It resolves no product root and reads no product, so
it is the cheapest way to confirm that a candidate executable really is ddduck and which version
is installed. `ddduck --version --help` prints the flag's contract like every other command.
Exit status: 0 on success or help; 1 on invalid input (an unknown option, for example). The
retryable busy exit 2 cannot occur, because no product root is touched.

## Product root resolution

Product-facing commands accept `--root <product-root>`. When `--root` is omitted, ddduck resolves
the root in this order:

1. An enclosing product root found by walking upward from the current directory.
2. `.ddduck/config.json` `productRoot`, when present and the current directory is not inside a
   product root.
3. A unique primary `product.yaml` candidate under the repository boundary.
4. A relevant example candidate only when no primary candidate exists.

Discovery admits a candidate by shape — a ddduck `product.yaml` with a sibling `model/`
directory — not by full validation, so a broken product still resolves and the command's own
validation reports its errors. Discovery excludes `.git/`, `.ddduck/`, `node_modules/`,
`generated/`, `.superpowers/`, `.worktrees/`, `.ddduck-init-stage-*` staging left by an
interrupted `init` (the next `init` of the same destination sweeps that debris; staging for
other destinations is never touched), and test fixtures. Multiple
viable primary roots
fail and ask for `--root`, listing every candidate and flagging any that fail validation; the
resolver never uses an arbitrary first match.

Use `.ddduck/config.json` for a repository default:

```json
{
  "schemaVersion": "1",
  "productRoot": "docs/ddd",
  "ignore": ["vendor", "target", "build", "dist", "__pycache__"]
}
```

`ignore` lists extra directory names (basenames only, no globs) that
every ddduck scanner skips, in addition to the always-skipped dot-directories
and `node_modules`. Omit the key to accept the defaults shown above; set it to
`[]` to skip nothing beyond the built-in defaults. `ddduck init` writes this
file pre-filled when it does not already exist and reports the write in its result
(`config: <path> (created)` in text, `configPath` in `--json`; omitted when the file
pre-existed). The config is written at the enclosing repository root (the nearest ancestor
containing `.git`); without one, at the destination directory itself, so the file then lives
inside the new product root with `"productRoot": "."`. When the file already exists and selects a different product root, `init` prints a
standard-error note that the repository default still selects that other root.

## Common behavior

Product writes are `init`, `generate`, `create`, `move`, `split`, and `retire`; successful
mutations regenerate all required views. `check`, `diff`, and every `query` are read-only. A successful
`check` writes nothing to standard output; when `--root` was omitted, it prints one standard-error
note naming the validated root so an implicitly resolved (for example config-pinned) root is never
validated invisibly. Successful product mutations print one concise result line, or one JSON result
object when `--json` is available.

Command help includes minimal examples. For focused syntax, use `ddduck create domain --help`
or `ddduck query node --help`; these keep the same operational and JSON contracts.

## `update`

```text
ddduck update [--yes]
```

Updates the executing CLI only when it is the actual npm global installation. It resolves
the global prefix and package directory through npm, refuses a linked checkout or a different
installation, and reads the latest stable release version from the configured npm registry.
The target is the executing CLI, not a dependency discovered in the current directory:
running the global executable updates the global package even inside a project with a local
ddduck dependency; running that local dependency refuses the update.
It displays the installed and available versions, leaves an equal or newer installed release
alone, and prints the exact command before asking `[y/n]`. `--yes` skips this confirmation;
closed input declines it. `--json` and `--force` are not accepted.

The installation command pins the verified prefix and displayed version, requires compatible
Node.js engines, and disables npm's configured force override. After npm succeeds, the command
executes the updated package's CLI with `--version --json` and verifies its package name and
version. Only then does it report success and remind you to refresh project skills separately
with `ddduck install skill`. It does not modify product models or install agent skills.

Global stable releases are supported on macOS and Linux. Local dependencies, linked checkouts,
other installation methods, and prerelease builds should be updated through their package
manager or Git. A failed installation may require repairing the global package with npm;
the command does not attempt an automatic rollback.

Exit status is 0 when already current/newer or after a verified update; 1 on invalid input,
unsupported installation/version, declined confirmation, npm failure, or failed verification.

## `init`

```text
ddduck init [destination] [--name <name>] [--id model:<product-id>] [--yes] [--json]
```

| Option or argument | Required       | Default                                        | Meaning                                                                     |
| ------------------ | -------------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| `destination`      | no             | config, then `ddd/` directory                  | Empty directory to create as the product root.                              |
| `--name`           | no             | repository directory name, or explicit ID slug | Product display name.                                                       |
| `--id`             | no             | `model:<normalized-name>`                      | Root Model ID, matching `model:<lowercase-slug>`.                           |
| `--yes`            | for automation | false                                          | Accept defaults without prompting; never overwrite a non-empty destination. |
| `--json`           | no             | false                                          | Emit one JSON result object instead of text.                                |

In an interactive terminal, `init` pre-fills editable product name, Model ID, and destination
answers. Enter accepts the value; Ctrl+C or closed input cancels before any filesystem write.
Explicit arguments skip their prompts. Editing the name changes the proposed ID unless
`--id` was supplied. The destination affects storage only, never product identity.

Without `--name`, the name comes from the explicit ID slug or the repository directory name
(the current directory outside Git). ID inference lowercases the name, removes diacritics,
replaces runs of other characters with hyphens, and removes leading/trailing hyphens.
An unusable inferred ID fails with an instruction to supply `--id`.

`--yes` is required without an interactive terminal and with `--json`, including when all
values are explicit. Existing scripts using `init --id` must add `--yes`. For example:

```bash
ddduck init --yes
ddduck init specs --name "Reading Room" --id model:library --yes --json
```

`init` writes the canonical directory layout, `product.yaml`, and the four fresh generated views
(`generated/docs/model-overview.md`, `generated/graph/model-graph.json`,
`generated/graph/model-graph.ndjson`, and `generated/graph/model-graph.svg`). It refuses a
non-empty destination, including an already initialized product. Product files live inside
the destination (`ddd/` by default). Configuration is created at the Git repository root
as `.ddduck/config.json`, or inside the new product root outside Git; existing configuration
is preserved. `--force` is not supported.

On success it reports the Model ID, normalized root, full created paths, configuration
location when created, a next command to regenerate views after manual edits, and a strong recommendation for coding agents to
install the ddduck skill for model authoring and maintenance. The printed
`ddduck install skill` command detects the repository root from the working directory,
or uses the working directory outside Git; installation is a separate explicit action.
Use `--repo <repository-root>` to choose another installation target.
With `--json`, it emits the unchanged object containing
`operation`, `root`, `affectedIds`, `canonicalPaths`, and `generatedPaths`. On failure it exits
nonzero without reporting success.

## `check`

```text
ddduck check [--root <product-root>] [--base <previous-product-root>] \
  [--docs-root <docs-root> ...] [--source-only]
```

| Option          | Default       | Meaning                                                                                                                   |
| --------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `--root`        | resolved root | Product root to validate.                                                                                                 |
| `--base`        | none          | Previous product root used to check historical Guarantee retention.                                                       |
| `--docs-root`   | product root  | Directory scanned for documentation references; repeatable. Passing it replaces the default product-root scope.           |
| `--source-only` | false         | Validate canonical source only; skip derived-view freshness checks and skip documentation references inside `generated/`. |

By default, `check` validates canonical source, then requires fresh generated Markdown and graph
views. Documentation references are validated only inside the product root; pass one or more
`--docs-root` directories to widen (and replace) that scope, mirroring the framework's own
repository-wide gate. Documentation-reference scanning always skips the `docs/audits` and
`docs/superpowers` directories (paths relative to each scanned root). It writes nothing and keeps standard output empty on success; when `--root`
was omitted, one standard-error note names the validated root. It exits 2 for a busy root
(`.ddduck-operation.lock` held by a live ddduck operation — the retryable case), and 1 for
invalid source, stale views, invalid roots, invalid options, or leftover state from an
interrupted operation
(`.ddduck-operation.lock`, `.ddduck-operation.reclaim`, or `.ddduck-operation-stage-*` with no
live owning process); running any mutation, such as `ddduck generate`, reclaims that leftover
state.

## `generate`

```text
ddduck generate [--root <product-root>] [--json]
```

| Option   | Default       | Meaning                                                               |
| -------- | ------------- | --------------------------------------------------------------------- |
| `--root` | resolved root | Product root to validate and regenerate.                              |
| `--json` | false         | Emit one JSON mutation-result object instead of the text result line. |

`generate` validates canonical source before writing `generated/docs/model-overview.md`,
`generated/graph/model-graph.json`, `generated/graph/model-graph.ndjson`, and
`generated/graph/model-graph.svg`. A successful text
result identifies the root, canonical paths (none for generate), and generated paths. It exits
nonzero without an intended product mutation if validation or contained-output checks fail.

## `diff`

```text
ddduck diff --base <previous-product-root> [--root <product-root>] [--json]
```

Compare two independently valid versions of the same Model by stable node ID. `--base` is
required and `--root` uses normal root resolution. Generated output may be absent or stale.
The command does not apply historical retention validation first: removing a Guarantee must
remain visible in the comparison even when a subsequent `check --base` rejects that removal.

The text report shows IDs, field changes, and path relocations. `--json` emits one
`ModelDiff` version `"1"` document conforming to `schemas/model-diff.schema.json`:

- `before` and `after` contain `modelId` and canonical `sourceDigest`.
- `added` and `removed` contain full records with their product-relative source paths.
- `changed` contains field changes keyed by escaped JSON Pointer paths. `beforePresent` and
  `afterPresent` distinguish absent fields from explicit null values.
- `relocated` records path changes without treating the same ID as a new record.
- `scope` is `canonical-yaml-only`; `excludedScopes` names decision content, evidence content,
  delivery artifacts, and runtime.

Object-key order, comments, and YAML formatting are not record differences. Array order is
preserved, so a reordered list is reported. Raw canonical-file changes still affect digests.
Neither the digests nor an empty comparison establish ADR/evidence freshness or semantic
equivalence. Source reads are not atomic snapshots; run comparisons while neither root is
being edited. Busy and interrupted roots are refused.

Exit 0 means comparison completed, including when changes exist; it is not an approval.
Exit 2 means busy, and exit 1 covers invalid or incompatible inputs. Use existing `impact`
and `neighbors` queries on both roots to inspect changed/removed context, then review meaning
and run historical retention checking separately.

## Creating domains, concepts, and use cases

```text
ddduck create domain --id domain:<slug> --name <text> --purpose <text> [--root <product-root>] [--json]
ddduck create concept --id concept:<slug> --owner domain:<slug> --name <text> --purpose <text> [--root <product-root>] [--json]
ddduck create use-case --file <yaml-file> [--root <product-root>] [--json]
```

Domain creation writes the node and adds its ID to the Model's `domains` list. Concept creation
writes the node and adds its ID to the owning Domain's `concepts` list. These forms require
every displayed field; they take model identity from the selected product.

Use-case creation reads a complete canonical `UseCase` YAML mapping. Its `model` must match
the selected product and all Guarantee/interface references must already resolve. It writes
the new node and adds its ID to the Model's `useCases` list without changing the input file.
An empty prerequisite or outcome list is allowed; the tool does not invent obligations.

All three forms derive the destination filename from the validated ID. Duplicate IDs,
occupied canonical paths, unknown fields, invalid references, or validation/generation
failures reject the operation without intended publication. Successful operations update
the owning collection and generate all views through the existing staged mutation runner.
There is no overwrite mode. Existing YAML comments and unrelated parent fields are retained.
The result has `operation`, `root`, `affectedIds` (new node and parent), `canonicalPaths`, and
`generatedPaths`; append `--json` for one JSON document. Publication has the filesystem
interruption limitations described in the [architecture guide](architecture.md#staged-lifecycle-mutation).

## Guarantee mutations

All mutation results identify the selected root, affected Guarantee IDs, canonical paths, and
fresh generated paths. Append `--json` to any command below for one JSON result object.

### `create guarantee`

```text
ddduck create guarantee --origin <origin> --classification <invariant|acceptance-criterion> \
  --owner <domain-id> --statement <text> [--root <product-root>] [--json]
```

`--origin`, `--classification`, `--owner`, and `--statement` are required. The root is resolved
through the common product-root rules. `create` allocates the next stable ID for the origin and
classification, writes its canonical Guarantee YAML, updates the owning Domain, and regenerates
views. It exits nonzero if the owner is unknown or any input or staged product is invalid.

### `move guarantee`

```text
ddduck move guarantee <guarantee-id> --to <domain-id> [--root <product-root>] [--json]
```

`<guarantee-id>` and `--to` are required. `move` requires an active Guarantee and an existing
destination Domain. It changes ownership, records the prior owner in `ownershipHistory`, updates
both Domain records, and regenerates views. It exits nonzero without an intended mutation when
the Guarantee is inactive, missing, already owned by the destination, or the staged product fails.

### `split guarantee`

```text
ddduck split guarantee <guarantee-id> --into <successor-id[,successor-id ...]> \
  --decision ADR-NNN [--root <product-root>] [--json]
```

`<guarantee-id>`, `--into`, and `--decision` are required. `--into` accepts one or more distinct
active successor IDs; the decision must resolve in the product decision registry.
`split` preserves the source ID, marks it `split`, records its successors and lifecycle decision,
then regenerates views. It exits nonzero without an intended mutation if an active UseCase or
DomainInterface would retain a reference to the non-effective Guarantee.

### `retire guarantee`

```text
ddduck retire guarantee <guarantee-id> --decision ADR-NNN [--root <product-root>] [--json]
```

`<guarantee-id>` and `--decision` are required. `retire` requires an active Guarantee and a
registered decision, marks the Guarantee `retired`, records `lifecycleDecision`, and regenerates
views. The same active UseCase and DomainInterface safety gate applies. Invalid input or a failed
staged validation exits nonzero without an intended mutation.

## Queries

Every query emits exactly one JSON document and writes no source or generated output. While a
live ddduck mutation holds `.ddduck-operation.lock`, queries and `check` fail with a busy
diagnostic (exit code 2, the retryable case) instead of reading a partially published snapshot.
Queries also refuse leftover state from an interrupted operation — the same
`.ddduck-operation.lock`, `.ddduck-operation.reclaim`, or `.ddduck-operation-stage-*` entries
`check` reports — with exit code 1 and the reclaim next action (run any mutation, such as
`ddduck generate`, to reclaim), because the snapshot may be partially published. A read racing the very start of a
mutation, before the lock exists, may still observe a partial snapshot, so `sourceDigest` is
authoritative only for reads that did not race a mutation. `sourceDigest` covers the canonical
node YAML sources only — `product.yaml` and the files under `model/` — not decision records:
editing a file under `decisions/` does not change the digest. JSON is
the only output format, so `--json` is optional and accepted as a no-op for compatibility. The
document contains `schemaVersion`, `query`, `rootModelId`, `result`, and
`diagnostics`. Every query root is resolved through the common product-root rules.
Non-context queries accept optional `--history`; without it, a split or retired
Guarantee resolves to its lifecycle redirect rather than its historical contract.

```mermaid
sequenceDiagram
  participant Caller
  participant CLI as ddduck query
  participant Model as Canonical product root
  Caller->>CLI: query context --id ... --root ... --json
  CLI->>Model: Load and resolve selected source
  CLI-->>Caller: Full selection, direct edges, summaries, digest
  Note over CLI,Caller: Read-only; no source or generated output is written
```

| Command                                                                    | Required options | Result                                                                  |
| -------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| `ddduck query node --id <id> [--root <root>] [--history] [--json]`         | `--id`           | Full canonical node and product-relative source path.                   |
| `ddduck query neighbors --id <id> [--root <root>] [--history] [--json]`    | `--id`           | Deterministically sorted incoming and outgoing edges.                   |
| `ddduck query impact --id <id> [--root <root>] [--history] [--json]`       | `--id`           | Reverse impact closure over ownership and behavioral references.        |
| `ddduck query anchors --id <id> [--root <root>] [--history] [--json]`      | `--id`           | Evidence, reachable decisions, policies, and view freshness.            |
| `ddduck query spec [--id <model-id>] [--root <root>] [--history] [--json]` | none             | Root, domains, view freshness, and verification commands.               |
| `ddduck query context --id <id> [--id <id> ...] [--root <root>] [--json]`  | `--id`           | Selected records, touching edges, one-hop summaries, and source digest. |

`context` accepts one or more distinct, repeatable `--id` options; it rejects `--history`.
Its selected records are complete, while unselected endpoints appear only as one-hop summaries.
The command does not recursively expand the perimeter.

## Install an agent skill

```text
ddduck install skill [--repo <repository-root>] [--yes]
```

`--repo` defaults to the nearest Git repository root, or the current directory outside Git. ddduck installs nothing itself: it delegates to the
[`skills`](https://www.npmjs.com/package/skills) CLI, which supports 79 agent hosts and owns the
installed layout and its own state. The command prints the exact command it will run, on its own
line, and then runs it in `--repo`:

```text
npx --yes '--package=skills@^1.7.0' -- skills add <ddduck-package>/skills --skill '*' -y
```

The bundled skills directory is resolved inside the installed ddduck package
(`./node_modules/ddduck/skills` from a consumer repository, or the repository's own `skills/`
when the repository under analysis is ddduck itself). `--skill '*'` installs every bundled skill,
the absent `-g` keeps the install project-scoped, and `-y` answers the delegated CLI's own
prompts, because the command it applies has already been shown and confirmed here. `skills`
writes one canonical copy (by default `.agents/skills/<skill-name>/`) and symlinks it into the
agent directories that exist in the project.

`--package=` pins the delegated package so npx resolves it from the registry. Without it, npx
resolves the bare name `skills` against `--repo`'s own `node_modules/.bin` first, so an unrelated
binary under that generic name — a sibling package hoisted to a monorepo root, for example —
would run instead of the CLI the printed command names. The `--` separator keeps npx from
reading the command word as a second package specifier.

Before running it, ddduck asks `[y/n]` on standard input. Only `y` or `Y` proceeds; any other
answer — including an empty line and a closed standard input — aborts, installs nothing, and
exits 1. `--yes` skips that confirmation and keeps the command usable in CI and by agents; the
command is still printed. The delegated command's output streams through unchanged and its exit
status is propagated. `--json` is not accepted.

Invoke the skill from the relevant host:

```text
Codex:  $update-ddduck-specs
Claude: /update-ddduck-specs
```

The skill defaults to plan-only; changing a product model requires explicit apply authorization.
Its workflow behavior is defined by the installed skill bundle (see its packaged
[canonical entrypoint](../skills/update-ddduck-specs/SKILL.md)).

## Optional Archify integration (experimental)

```text
ddduck install archify [--repo <repository-root>] [--yes] [--version <integration-version>]
ddduck doctor archify [--repo <repository-root>] [--json]
ddduck export archify [--root <product-root>] [--out <directory>] [--open] [--json]
```

These commands are always advertised by `--help`, including before installation.
Help does not read `.ddduck/config.json` or load an installed runtime. Existing
commands work independently of Archify. After installation, the installer prints
`Next: ddduck export archify --open`.

This worktree trial downloads only the qualified source files from upstream commit
`73aaa0696e8f72c232ea710e6fa94fd953f3e773`, whose package declares version 3.0.1.
Integration version `0.1.0-experimental` identifies this ddduck adapter, separately
from the upstream version. Each file is checked against a bundled SHA-256 manifest
before installation and before export. No installation scripts run. The upstream
MIT license is included. This trial does not use a published npm integration
package or a globally installed agent skill.

The runtime lives at `<repository>/.ddduck/tools/archify/runtime/`, with its pin in
the adjacent `lock.json`. Commit the lock and ignore the runtime directory:

```gitignore
**/.ddduck/tools/archify/runtime/
**/.ddduck/exports/
```

`--repo` defaults to the enclosing Git repository, or the current directory without
Git. The directory must already exist. Installation asks for confirmation unless
`--yes` is passed. Re-running installation reuses a valid copy offline, or repairs
corrupted files using the same qualified revision. A failed download leaves the
previous installation intact. Only the integration version qualified by this
ddduck is accepted by `--version`; unsupported versions are rejected. An unrelated
directory or incompatible lock is never replaced automatically.

Interrupted installation/export trials retain their lock and any staging recovery
directory. The next attempt reports the recorded owner PID and lock path. After
confirming the owner has exited, preserve recovery directories and remove only the
reported lock before retrying. Automatic stale-lock reclamation is deferred.

`doctor archify` checks installation and integrity offline without executing the
runtime. It exits 0 when ready, 1 otherwise, and offers the install command for a
missing or corrupted installation. `--json` returns a single status object.

Export resolves and validates the canonical product source, builds its graph in
staging, and produces a complete grouped view, a Model overview with separate
sublevel diagrams, and individual Domain views with external context. It does not
require fresh canonical generated views or regenerate them. A missing or corrupted
runtime fails with an install remedy and downloads nothing. Generation works
offline after installation and uses ddduck's existing Graphviz WASM dependency;
Chrome is needed only for browser verification, not generation.

The default output is `<product-root>/.ddduck/exports/archify/`. `--out` resolves
relative to the current directory and must remain inside the invoking repository.
An existing directory is replaced only when its manifest identifies an atlas from
this integration. Source validation or rendering failures preserve the previous
atlas. The bundle includes a graph snapshot, source digest, view hashes and
ddduck/integration/upstream identities. `--json` emits one result with `root`,
`output`, `index` and `integration`. `--open` opens the resulting index in the system
browser; an opening failure reports the already generated path. Browser menus
provide SVG and PNG export. Publish the entire output directory so its relative
HTML links remain valid.

This is a static atlas: the grouped complete view does not collapse groups or
replace them interactively with aggregated nodes. The complete view uses a
compact two-dimensional layout with non-overlapping cards and Domain groups;
Model summaries and Domain details retain their hierarchical layout as separate
views. Release packaging and a supported-version upgrade
policy remain follow-up work before advertising a stable integration.

The passport displays the full node description in a wrapping text block before
the relationship list, outside the metadata chips. Long descriptions can be
scrolled within that block; canonical IDs remain compact metadata.

Diagram cards show a short title and the canonical ID, with the full description
reserved for the passport. A Guarantee without `name` shows only its ID on the
card; add an optional `name` for a readable title and keep `statement` unchanged.
Each view's JSON components expose `canonicalId`, `title`, and `description`,
derived from the existing model fields without changing the source format.

### Publishing the framework model

This repository's [Model atlas workflow](../.github/workflows/pages.yml) exports
`docs/ddd` and deploys the complete output directory to GitHub Pages on pushes to
`main`, or a manual dispatch on `main`. Feature branches do not deploy. The build
installs the qualified runtime explicitly and uses the same export command as
users; a failed build does not replace the deployed site. Deployment uses the
`github-pages` environment with Pages/OIDC permissions scoped to its deploy job.

GitHub Pages must use **GitHub Actions** as its publishing source in repository
**Settings → Pages**. The repository's **About → Website** points to
`https://diegomarino.github.io/ddduck/`. The first deployment happens after this
workflow and the exporter are integrated into `main`.

Consumer repositories can reuse the workflow with their own `--root` and Website
URL. Ordinary local export does not modify GitHub settings or publish a site.
The workflow follows [GitHub's custom Pages deployment guidance](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
