---
name: update-ddduck-specs
description: Use when a repository's ddduck product model needs to be created, audited against current code, tests, and documentation, or reconciled after product changes.
---

# Update ddduck Specs

Maintain or bootstrap a repository's ddduck product model from evidence visible in the current working tree.

## Inputs and boundaries

- Resolve the repository root, read all applicable repository instructions, and inspect Git status before analysis.
- Use an explicitly requested product root; otherwise let ddduck resolve it in its own order: the enclosing product root of the current directory, else the `productRoot` in `.ddduck/config.json`, else the unique discovered product root in the repository (the ddduck CLI reference documents the full order, including the example-candidate fallback). `ddduck query spec` reports the resolved root. Ambiguous resolution is a stop condition: report the candidates and ask; never bootstrap a second product root beside an existing one. When no executable resolves, name the `productRoot` from `.ddduck/config.json` as an unverified candidate in the report and derive no model state from it.
- Default to plan-only. Mutate files only when the current user request explicitly authorizes application, including prose that clearly authorizes the evidence-backed changes. `--root <path>` and `--apply` may be convenient shorthand, but ordinary prose must work.
- Preserve unrelated and uncommitted work. Stop when intended target files overlap user changes inseparably.
- Write only `<root>/product.yaml`, `<root>/model/**`, `<root>/decisions/**`, and regenerated `<root>/generated/**`.
- Never edit generated views directly. Regenerate them with ddduck.
- Use only evidence visible in the current working tree. Do not rely on prior chat, cursor, cache, or an assumed previous revision.
- Preserve stable IDs and Guarantee lifecycle. Never silently delete or reuse a Guarantee ID. Use ddduck lifecycle commands where they cover the mutation.
- Never create an ADR merely to satisfy validation or justify an inferred change.
- Keep unresolved questions out of canonical model facts.
- Prefer the smallest coherent product-model change. Avoid ornamental DDD vocabulary and speculative structure.
- Do not commit or push consumer changes unless the user separately requests it.

## Resolve the ddduck executable

Resolve the executable before the baseline. Probe in this order and take the first candidate that runs:

1. a command or path supplied in the current user request;
2. a repository-local install: `node_modules/.bin/ddduck` at the repository root and at any workspace root enclosing the product root;
3. the repository's own `package.json` `bin` target when the repository under analysis is ddduck itself, for example `node scripts/ddduck.mjs`;
4. `ddduck` on `PATH`;
5. a ddduck source checkout whose path the user named or that the repository records, run through its `package.json` `bin` target, and only when its `version` matches the pinned `ddduckVersion`.

Probe named paths; never scan for the executable. Do not search above the repository root, and never walk a parent directory tree looking for a checkout — an unbounded search times out without finding anything. A candidate outside the repository must be named by the user or recorded in the repository, and corroborated by version before use.

Confirm a candidate with `ddduck --help`. There is no `--version` flag; a failing `ddduck --version` does not mean the executable is absent or broken. Read the version from the candidate's `package.json` instead. When the repository pins a version (`ddduckVersion` in `.ddduck/agent-skills.lock.json`, or a `ddduck` dependency in `package.json`), prefer the repository-local install over `PATH` and disclose when only a `PATH` executable was available and its provenance could not be corroborated.

Only an exhausted probe list establishes that no executable exists. When no candidate runs, stop before any analysis conclusion, report the model state as `undetermined`, list every probed location verbatim, and offer the user these unblocking options instead of choosing one:

- `npm install -g ddduck` for a global CLI;
- `npm install --save-dev ddduck` to pin it in this repository;
- `npx ddduck@<version> <command>` for a one-off run, naming the version explicitly.

Never install a package, add a dependency, or invoke `npx` on your own initiative, and never silently fall back to an unrelated global version. Presenting the options is the deliverable; the user chooses.

## Establish the baseline

Classify the selected root exactly once:

- `existing`: `product.yaml` exists. Run `ddduck query spec --root <root> --json` and `ddduck check --root <root>`, recording both outcomes independently. A failing existing model is invalid, not absent, and must not be reinitialized.
- `absent`: the root is missing or empty. Inspect the repository before proposing initialization.
- `path-collision`: the root is non-empty but not a recognizable ddduck product. Report the collision and never initialize over it.
- `undetermined`: the executable or the root could not be resolved, so the model state was never observed. Report it as `undetermined` and stop.

`existing`, `absent`, and `path-collision` are observations; each requires an inspection that actually ran. Failing to look is `undetermined`, never `absent`. Never downgrade `undetermined` to `absent`, and never report an unobserved model state as fact.

Stop before mutation when the ddduck executable is missing or incompatible, multiple product roots are plausible and none was selected, the selected root is a non-empty path collision, bootstrap identity, purpose, or initial domain seams are not grounded, evidence conflicts materially change the proposed model, target model files overlap inseparable user changes, or the analyzed working-tree state changed before application.

### Red flags

| Thought                                                                 | Reality                                                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| "`which ddduck` found nothing, so there is no executable."              | `PATH` is the last probe, not the only one. Probe the repository-local install and the `package.json` `bin` target first. |
| "`ddduck --version` errored, so the executable is unusable."            | There is no `--version` flag. Confirm with `ddduck --help`.                                                               |
| "No root resolved, so there is no product model."                       | Not observing a model is not observing its absence. Report `undetermined`.                                                |
| "I will report `absent` and let the user correct me."                   | `absent` authorizes initialization. A false `absent` invites bootstrapping a second product root beside an existing one.  |
| "The repository looks greenfield, so initialization is safe."           | Only an inspected, missing or empty root is `absent`. Appearance is not observation.                                      |
| "I cannot run ddduck, so I will document findings as evidence instead." | Findings without a baseline are unverified. Report `undetermined` with the probes tried and the install options.          |
| "I will search the parent directories for a ddduck checkout."           | Probe named paths only. An unbounded parent search times out and still finds nothing.                                     |

## Gather evidence

Inspect relevant current code, tests, public interfaces, documentation, configuration, schemas, workspace structure, and accepted decisions. Record material exclusions and coverage gaps.

For every candidate fact, record:

- proposed model assertion;
- repository-relative path plus line, symbol, heading, or test name;
- evidence role: implementation, verification, documentation, decision, or configuration;
- contradictory evidence;
- inspected scope and remaining unknowns.

Executable behavior and passing tests establish observed behavior. Accepted requirements and decisions establish intended behavior. Treat conflicts between them as inconsistencies; do not silently encode either a possible bug or an unimplemented requirement as product truth.

The current schema restricts persisted interface evidence anchors to paths inside the product root. Cite repository-wide evidence in the plan and final report, but persist only schema-supported product-root anchors. Do not copy source evidence into the product root, invent unsupported metadata, or create bridge documents merely to manufacture provenance.

For a greenfield repository, use runtime-supported subagents only when no model exists and the relevant corpus spans several substantial, independent packages, applications, or domain areas that cannot be covered reliably in the coordinating context. Repository file count alone is not sufficient. Subagents are read-only evidence adapters: assign non-overlapping scopes, provide applicable repository instructions, forbid writes and canonical model synthesis, require candidate facts with exact evidence locations, conflicts, unknowns, and coverage, then re-read decisive evidence before adopting it. The coordinator is the sole writer. If subagents are unavailable, inspect the same scopes sequentially and disclose the coverage limitations.

## Compare and classify

Classify every material difference as exactly one of:

- verified omission;
- stale modeled fact;
- structural inconsistency with an unambiguous repair;
- contradiction or uncertainty requiring a human decision;
- irrelevant implementation detail;
- insufficiently covered.

For existing models, preserve identity and history.

## Plan-only workflow

Before any mutation, report in this order:

1. Mode, resolved root, and model state.
2. Baseline query and validation status.
3. Inspected coverage, exclusions, and gaps.
4. Proposed changes with classification, concrete evidence, and exact target files.
5. Contradictions, uncertainties, and required decisions.
6. Exact generation and verification commands.

Item 1 reports the model state as `existing`, `absent`, `path-collision`, or `undetermined`, and names the resolved executable. An `undetermined` report replaces items 2 through 6 with the probed locations, the unverified root candidate, and the install options; it asserts nothing about the model.

Without explicit application authorization, stop before all writes. Plan mode performs no writes, including initialization and generation.

## Apply workflow

When application is explicitly authorized:

1. Recheck Git status, intended target files, and decisive evidence.
2. Initialize only an absent or empty root whose model identity, purpose, and initial domain seams are explicit or unambiguously grounded. Otherwise request the missing decision.
3. Apply only planned, evidence-backed changes whose meaning is unambiguous.
4. Leave unresolved findings unchanged.
5. Use ddduck lifecycle commands for Guarantee transitions. Author other canonical YAML against installed schemas and existing model conventions.
6. Run `ddduck check --root <root> --source-only` before generation; hand-authored canonical edits legitimately leave generated views stale until step 7.
7. Run `ddduck generate --root <root>`.
8. Run `ddduck check --root <root>` again.
9. Run `ddduck query spec --root <root> --json` and require every generated view to be fresh.
10. Inspect the final diff for scope.

Any command failure makes the result incomplete. Inspect and report the resulting working tree; never destructively roll back unrelated user work.

Report changed canonical, decision, and generated files; evidence supporting each material change; skipped and unresolved findings; exact command outcomes and diagnostics; final generated-view freshness; and remaining coverage gaps. Explicitly report `incomplete` when any verification or scope check fails. A verified no-op is a valid result; do not create model content merely to demonstrate activity.
