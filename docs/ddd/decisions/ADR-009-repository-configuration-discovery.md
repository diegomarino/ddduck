---
id: ADR-009
title: Repository Configuration Discovery
status: accepted
date: 2026-11-24
deciders:
  - Diego
  - Claude
supersedes: []
supersededBy: []
related:
  useCases: []
  domains:
    - domain:tooling-runtime
    - domain:authoring-workflow
  guarantees: []
---

# ADR-009 - Repository Configuration Discovery

## Context

ddduck read repository configuration only from `.ddduck/config.json`. Repositories
increasingly avoid tool-specific root entries: the community [`.config/`
proposal](https://github.com/pi0/config-dir) groups tool configs under one directory, and
widely used loaders such as cosmiconfig already search `.config/`. Requiring a `.ddduck/`
directory just to hold one file is friction. The config also had no room for comments, so
the only way to discover its options was the CLI reference. Issue #35 asked for more
locations and formats with deterministic precedence and explicit conflict handling.

## Decision

Discover one repository config at the repository root, in this documented order:

1. `.config/ddduck.{json,jsonc,yaml,yml}`
2. `ddduck.config.{json,jsonc,yaml,yml}`
3. `.ddduck/config.{json,jsonc,yaml,yml}`

Generic file names (`config.*`) are accepted only inside the tool-owned `.ddduck/`
directory; tool-named files (`ddduck.*`) may live in `.config/` or at the root.

- At most one config may exist. Several are an error that lists every candidate in the
  order above; there is no silent precedence. The order exists for documentation and
  diagnostics.
- All formats share one content contract and validation. Errors name the actual file.
- `.json` uses native `JSON.parse`. `.jsonc` uses `jsonc-parser`: comments and trailing
  commas are allowed (Prettier writes trailing commas in `.jsonc`, as VS Code and
  `tsconfig` accept them); any other parse error fails. `.yaml`/`.yml` uses `yaml`
  with strict parsing and unique keys.
- `--root` overrides `productRoot`; `ignore` still applies, so an invalid or conflicting
  config still fails commands that scan.
- When no config exists, `init` writes a commented JSONC template documenting every option:
  `.config/ddduck.jsonc` when `.config/` already exists, otherwise `ddduck.config.jsonc`.
  `init` never creates `.ddduck/` only for configuration.

## Considered Options

1. **Keep only `.ddduck/config.json`** - Rejected. It forces a tool directory and offers no
   comments.
2. **Adopt cosmiconfig defaults** - Rejected. They include executable JS/TS configs, a
   `package.json` key, and many rc variants; ddduck needs deterministic data-only configs
   for repositories in any language.
3. **First match wins with a warning** - Rejected. A shadowed config is an invisible
   misconfiguration; the product root resolver already refuses arbitrary first matches.
4. **`.ddduckrc*` files** - Deferred. The rc convention adds no capability over
   `ddduck.config.*` and the extensionless form has an ambiguous format. It can be added
   later without breaking existing repositories.
5. **User-level config** - Deferred. ddduck has no user-level settings; if it ever does, they
   belong in `$XDG_CONFIG_HOME/ddduck/` (default `~/.config/ddduck/`).
6. **Three locations, four formats, init writes commented JSONC** - Accepted.

## Consequences

Existing `.ddduck/config.json` repositories keep working unchanged. New repositories get one
self-documenting file and no `.ddduck/` directory until another feature needs tool state.
`jsonc-parser` becomes a runtime dependency; ADR-002 is amended to record it. Adding a
location or format later is additive, but it must keep the single-config rule.

## Verification

`test/ddduck-config.test.mjs` covers every location and format, the documented order,
conflicts (including `.yaml` beside `.yml`), JSONC trailing commas, JSONC and YAML failures, and the `init`
location choice. `test/init-config.test.mjs` covers the template, no clobbering of any
existing location, rollback on a failed write, and a conflict reported by `check --root`.

## Links

- Source references: issue #35, `scripts/lib/ddduck-config.mjs`, `docs/cli.md`
  (Repository configuration)
- Follow-up decisions: none
