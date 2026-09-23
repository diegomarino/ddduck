---
name: update-ddduck-specs
description: Use when a repository's ddduck product model needs to be created, audited against current code, tests, and documentation, compared across revisions, or reconciled after product changes.
---

# Update ddduck Specs

Maintain or bootstrap a ddduck product model from evidence in the current working tree. Preserve the difference between observed implementation, accepted intent, canonical product meaning, generated views, and runtime proof.

## Operating contract

- Resolve the repository root, read every applicable instruction file, and inspect Git status before analysis.
- Resolve a repository-compatible ddduck executable with the probe order in [executable resolution](references/executable-resolution.md). Do not install dependencies or substitute an unrelated global version.
- Default to plan-only. Mutate model files only when the current request explicitly authorizes applying the evidence-backed proposal.
- Preserve unrelated work. Stop when intended model edits overlap user changes inseparably or the analyzed tree changes before application.
- Write only `<root>/product.yaml`, `<root>/model/**`, `<root>/decisions/**`, and regenerated `<root>/generated/**`. Regenerate derived views; never edit them directly.
- Preserve stable IDs and Guarantee history. Use lifecycle commands for Guarantee transitions and the supported creation commands for Domain, Concept, and UseCase.
- Keep unresolved questions in prose. Canonicalize only meaning that is unambiguous and supported by inspected evidence or accepted authority.
- Commit, push, consumer migration, and external effects require separate authorization.

## Load the relevant reference

Read each selected reference completely before acting. All references are one level below this file.

- Before the first ddduck command, read [executable resolution](references/executable-resolution.md).
- For every bootstrap, audit, or reconciliation, read [modeling and evidence](references/modeling-and-evidence.md).
- When comparing revisions, reviewing moves/removals, or selecting affected context, read [reviewing changes](references/reviewing-changes.md). Start with `ddduck diff --base <before-root> --root <after-root> --json` when two valid roots exist.
- Before proposing or applying canonical changes, read [authoring and verification](references/authoring-and-verification.md). Use `ddduck create domain`, `ddduck create concept`, and `ddduck create use-case` for the kinds they support.

## Workflow

1. Resolve the executable, then resolve and classify the product root. Record `query spec` and `check` independently; an invalid existing model is not an absent model, and a root that was never inspected is `undetermined`, never absent.
2. Gather current code, tests, interfaces, documentation, configuration, schemas, and accepted decisions. Record contradictions, exclusions, and coverage gaps.
3. Separate observed behavior, accepted intent, open questions, and rejected alternatives. Classify every material model difference using the modeling reference.
4. Produce the plan-only report defined in the authoring reference. A partial or zero-model-change result is valid when it is the evidence-backed outcome.
5. If application is explicitly authorized, recheck Git status, decisive evidence, and target files; then apply only the approved unambiguous changes.
6. Run the complete verification sequence from the authoring reference. Any failed command makes the result `incomplete`.

## Completion criteria

Report the resolved root and mode, baseline outcomes, inspected coverage, changed or proposed IDs and files, supporting evidence, contradictions and open decisions, exact command results, generated-view freshness, and remaining gaps. For comparisons, distinguish structural differences from semantic approval. For applications, inspect the final scoped diff and report every skipped or unresolved finding.
