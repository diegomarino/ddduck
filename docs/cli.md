# CLI reference

`ddduck` operates on a selected product root. Run `ddduck --version` for the installed version and
`ddduck --help`, or pass `--help` anywhere
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
ddduck --version | ddduck -v [--json]
```

`--version` (or `-v`) prints the version of the installed `ddduck` package as one text line,
`ddduck <version>`. With `--json` it emits one JSON object, `{"name":"ddduck","version":"<version>"}`.
It reads nothing but the package's own `package.json`, writes nothing, and exits zero;
`ddduck --version --help` prints the flag's contract like any command help.

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
mutations regenerate all required views. `check` and every `query` are read-only. A successful
`check` writes nothing to standard output; when `--root` was omitted, it prints one standard-error
note naming the validated root so an implicitly resolved (for example config-pinned) root is never
validated invisibly. Successful product mutations print one concise result line, or one JSON result
object when `--json` is available.

## `init`

```text
ddduck init [destination] --id model:<product-id> [--json]
```

| Option or argument | Required | Default                       | Meaning                                           |
| ------------------ | -------- | ----------------------------- | ------------------------------------------------- |
| `destination`      | no       | config, then `ddd/` directory | Empty directory to create as the product root.    |
| `--id`             | yes      | none                          | Root Model ID, matching `model:<lowercase-slug>`. |
| `--json`           | no       | false                         | Emit one JSON result object instead of text.      |

`init` writes the canonical directory layout, `product.yaml`, and the four fresh generated views
(`generated/docs/model-overview.md`, `generated/graph/model-graph.json`,
`generated/graph/model-graph.ndjson`, and `generated/graph/model-graph.svg`). It refuses a
non-empty destination. On success it reports the Model ID, normalized root,
`product.yaml`, and all generated paths as one text line or, with `--json`, one object containing
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
ddduck install skill [<skill-name>] [--repo <repository-root>] [--json]
```

`--repo` defaults to the current directory. Omitting `<skill-name>` installs every skill bundled
in the package — each directory under the package's `skills/` that holds a `SKILL.md` — in name
order; naming a skill installs only that one. An unknown name is a usage error that lists the
bundled skill names. The installer chooses the least intrusive host
topology from the repository's existing directories:

```text
no .agents/ or .claude/   -> .agents/skills/update-ddduck-specs/SKILL.md
.agents/ only             -> .agents/skills/update-ddduck-specs/SKILL.md
.claude/ only             -> .claude/skills/update-ddduck-specs/SKILL.md
.agents/ and .claude/     -> .agents/skills/update-ddduck-specs/SKILL.md
                             .claude/skills/update-ddduck-specs -> ../../.agents/skills/update-ddduck-specs
```

The topology in force is read from the repository, not from a record: an existing installation is
recognized by its canonical `SKILL.md` and the shape of the Claude Code skill path beside it. A
Codex installation in a repository that later adopts `.claude/` gains the symlink on the next
install; a Claude Code installation is never relocated, because that would move the canonical file
rather than add a link beside it. A host adapter that was removed is re-created on the next
install. The installer does not create a host directory for a host that is absent from the
repository, except for the `.agents/` fallback when no host directory exists.

The installer writes one `.ddduck/agent-skills.lock.json` for the repository, holding one entry
per installed skill — its name, the canonical path, host adapters, package version, and installed
`SKILL.md` SHA-256 — sorted by skill name. The file is `"schemaVersion": 2`; a `"schemaVersion": 1`
lock written by an earlier ddduck recorded exactly one skill at the top level and is still read,
then migrated to the current shape the next time a skill is created or upgraded.

The lock is a provenance note, not an authority. No install decision is taken from it: a lock that
is missing, damaged, truncated, or written by a future schema degrades to "no entries" and is
rewritten rather than failing the command. The single field consulted is `skillSha256`, as a hint —
when it matches the installed file, those bytes are ones ddduck wrote, so replacing them is a
silent `upgraded`. Without that hint an installed file that differs from the bundled one is
indistinguishable from a file you wrote yourself, and the command refuses it by name instead of
overwriting it; restore the file or move it aside and re-run. Each skill is planned and applied
independently, so a topology is chosen per skill, and a lost entry re-appears on the next install.

On success it prints one result line per selected skill naming the action (`created`, `upgraded`,
or `no-op`), the repository, the canonical skill path, and the lock path. With `--json` it emits
one JSON object containing `operation`, `repository`, and `skills` — one result object per
selected skill with its `skill`, `action` (`create`, `upgrade`, or `no-op`), `canonicalPath`,
`lockPath`, and `skillSha256`.

A skill that cannot be installed — conflicting host state, an inconsistent lock — does not block
the others: every selected skill is attempted, the command exits 1, and the diagnostic names each
failed skill with its reason plus each skill that did install, because those installations are
already durable. Nothing is written to standard output in that case.

Invoke the skill from the relevant host:

```text
Codex:  $update-ddduck-specs
Claude: /update-ddduck-specs
```

The skill defaults to plan-only; changing a product model requires explicit apply authorization.
Its workflow behavior is defined by the installed `SKILL.md` (and its packaged
[canonical source](../skills/update-ddduck-specs/SKILL.md)).
