---
name: update-ddduck-specs
description: Use when a repository's ddduck product model needs to be created, audited against current code, tests, and documentation, or reconciled after product changes.
---

# Update ddduck Specs

Maintain or bootstrap a repository's ddduck product model from evidence visible in the current working tree.

## Inputs and boundaries

- Resolve the repository root, read all applicable repository instructions, and inspect Git status before analysis.
- Use an explicitly requested product root; otherwise let ddduck resolve it in its own order: the enclosing product root of the current directory, else the `productRoot` in `.ddduck/config.json`, else the unique discovered product root in the repository. `ddduck query spec` reports the resolved root. Ambiguous resolution is a stop condition: report the candidates and ask; never bootstrap a second product root beside an existing one.
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

Use a repository-compatible ddduck executable. Do not install dependencies or silently fall back to an unrelated global version.

## Establish the baseline

Classify the selected root exactly once:

- `existing`: `product.yaml` exists. Run `ddduck query spec --root <root> --json` and `ddduck check --root <root>`, recording both outcomes independently. A failing existing model is invalid, not absent, and must not be reinitialized.
- `absent`: the root is missing or empty. Inspect the repository before proposing initialization.
- `path-collision`: the root is non-empty but not a recognizable ddduck product. Report the collision and never initialize over it.

Stop before mutation when the ddduck executable is missing or incompatible, multiple product roots are plausible and none was selected, the selected root is a non-empty path collision, bootstrap identity, purpose, or initial domain seams are not grounded, evidence conflicts materially change the proposed model, target model files overlap inseparable user changes, or the analyzed working-tree state changed before application.

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
