# Authoring and verification

Read this reference before proposing or applying canonical ddduck changes.

## Resolve and classify once

Root resolution is delegated to the executable, so resolve one first with the probe order in [executable resolution](executable-resolution.md). Then use an explicitly requested root. Otherwise let ddduck resolve the enclosing product root, then `.ddduck/config.json`, then the unique repository candidate. `ddduck query spec --root <root> --json` reports the resolved root. Ambiguity is a stop condition: report candidates and ask rather than initializing a second model.

Classify the selected path. These three states are observations; each requires an inspection that actually ran.

- `existing`: `product.yaml` exists. Run `query spec` and `check` independently. A failing model remains existing and invalid.
- `absent`: the root is missing or empty. Inspect the repository before proposing initialization.
- `path-collision`: the path is non-empty but is not a recognizable product. Report it and do not initialize over it.

When no executable resolves, or the inspection that distinguishes those states did not complete, the state is `undetermined`: the absence of an observation rather than a fourth thing observed. Report `undetermined` and stop; never downgrade it to `absent`, because `absent` is the only state that authorizes initialization.

Stop before mutation when the executable is unresolved, missing, or incompatible, the model state is `undetermined`, the root is ambiguous, the path collides, bootstrap identity or seams are ungrounded, evidence conflicts change the proposal materially, target files overlap inseparable user work, or the analyzed working tree changed.

## Plan-only report

Before any write, report in this order:

1. Mode, resolved root, and model state.
2. Independent query and validation outcomes.
3. Inspected coverage, exclusions, and gaps.
4. Proposed changes with classification, evidence, affected IDs, and exact files.
5. Contradictions, uncertainties, and required decisions.
6. Exact authoring, generation, and verification commands.

Without explicit application authorization, stop here. Plan-only performs no initialization or generation.

## Apply canonical changes

Recheck Git status, intended files, and decisive evidence immediately before writing.

Use the supported operation instead of coordinating parent collections by hand:

```bash
ddduck create domain --id domain:<slug> --name <text> --purpose <text> --root <root>
ddduck create concept --id concept:<slug> --owner domain:<slug> --name <text> --purpose <text> --root <root>
ddduck create use-case --file <yaml-file> --root <root>
```

Use ddduck lifecycle commands for Guarantee creation, movement, splitting, and retirement. Author canonical YAML directly only for kinds or field changes without a supported mutation command, following installed schemas and existing conventions. Never edit generated views.

Apply only approved, unambiguous changes. Leave unresolved findings unchanged. A helper coordinates structure and publication; it does not supply product meaning.

## Verify and read back

For hand-authored canonical edits, run the source-only check before generation. Mutation commands already stage validation and generation, but still perform the common final readback:

```bash
ddduck check --root <root> --source-only
ddduck generate --root <root>
ddduck check --root <root>
ddduck query spec --root <root> --json
git diff -- <root>/product.yaml <root>/model <root>/decisions <root>/generated
```

When only mutation commands were used, the first two commands may be redundant; run them when hand edits occurred or when generated freshness is uncertain. Always require the final `check`, fresh generated views in `query spec`, and a scoped diff.

Any failure makes the result `incomplete`. Inspect the resulting tree without destructive rollback. Report changed canonical, decision, and generated files; evidence for every material change; skipped and unresolved findings; exact diagnostics; freshness; and remaining coverage gaps.
