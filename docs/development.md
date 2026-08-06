# Development

This guide is the framework maintainer surface: the working gate, the agent-readiness evals,
the revision-scoped FR-to-code audits, and the framework contracts. Consumer-facing command
contracts live in [the CLI reference](cli.md).

## Working gate

`npm run check` is the gate that must pass before committing. It runs, in order:

- `check:model` — validates the canonical self-model at `docs/ddd`
  (`scripts/check-model.mjs --root docs/ddd --docs-root docs/ddd --docs-root .`, so
  documentation references are enforced repository-wide).
- `check:docs` — verifies the generated Markdown views are fresh.
- `check:graph` — verifies the generated graph views are fresh.
- `check:graph:svg` — verifies the generated graph SVG is fresh.
- `lint` — ESLint over the repository.
- `lint:md` — markdownlint over the repository's Markdown (audit reports and
  `docs/superpowers/` are excluded).
- `format:check` — Prettier formatting check.
- `test` — the full Node test suite (`node --test test/*.test.mjs`).

## Agent-readiness evals

The deterministic eval pack validates query-grounded structured evidence; it does not grade or
generate prose. Regenerate its result snapshot with:

```bash
node scripts/run-agent-readiness-evals.mjs \
  --input test/evals/agent-readable-product-specs.jsonl \
  --repo-root . \
  --output test/evals/agent-readable-product-specs.result.json
```

`--output` must be relative to `--repo-root`; absolute output paths (and `..` traversal) are
rejected. The result snapshot is derived review evidence, not canonical product source or eval
input. To inspect readiness issues for an explicit product root, generate the canonical-data
report with:

```bash
node scripts/generate-agent-readiness-report.mjs --root examples/reminders/ddd
```

## Revision-scoped FR-to-code audits

An audit report is external verification evidence for one qualified delivery requirement, not a
canonical product node or input to a delivery tool. It reads only declared source-relative
anchors from pinned Git revisions and emits one JSON report. Supply every source-root mapping at
invocation time; the framework does not assume a local checkout layout.

The published example proof is limited to `FR-005#ordinary-member-list`: the default
`GET /api/members` list. It excludes member pickers, assignment and recipient targets, and the
admin archived-member management tab.

```text
node scripts/audit-fr-to-code.mjs \
  --input examples/audit-reports/members-ordinary-list.yaml \
  --source-root source:example-app=<local-checkout> \
  --json
```

Audit record structure is declared by
[`schemas/fr-to-code-audit.schema.json`](../schemas/fr-to-code-audit.schema.json);
`verifyFrToCodeAudit` remains the normative semantic validator on top of it.

The report's three possible verdicts are `realized-and-tested`, `realized-untested`, and
`unrealized`. It does not parse a delivery grammar, infer missing evidence, or read a working
tree instead of the declared revision.

## Framework contracts

Global `PolicySpec` declarations live in `policies/`, outside any product graph, and are
validated against the framework policy schema. They are loaded by the checker but never
rendered as product nodes.
