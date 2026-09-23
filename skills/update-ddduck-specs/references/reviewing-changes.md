# Reviewing changes

Read this reference when two product roots or revisions must be compared, or when a move, removal, or affected-context review is requested. Every `ddduck …` command below names the command resolved by [executable resolution](executable-resolution.md); substitute it before running.

## Structural comparison

Keep both roots stable and run:

```bash
ddduck diff --base <before-root> --root <after-root> --json
```

The command validates both roots independently and compares canonical YAML records by stable ID. It reports additions, removals, field changes, and relocations. Object-key order, comments, and YAML formatting are not semantic record changes; array order is significant. Raw canonical bytes still contribute to each source digest.

Exit `0` means the comparison completed, including when differences exist. It is not approval. Exit `2` means a root is busy; other failures exit `1`. The report excludes decision content, evidence content, delivery artifacts, and runtime. Empty output does not prove semantic equivalence or freshness outside that scope.

Source reads are not an atomic snapshot. Keep both roots unchanged during review and repeat the comparison if either tree changes.

## Inspect affected context

For each changed or removed ID, inspect both roots where the record exists:

```bash
ddduck query node --id <id> --root <root> --json
ddduck query impact --id <id> --root <root> --json
ddduck query neighbors --id <id> --root <root> --json
ddduck query context --id <id> --root <root> --json
```

`impact` follows reverse ownership and behavioral-reference edges. `neighbors` returns direct edges; relationships are review candidates, not causal proof. Filter incoming and outgoing edges with `edge.kind === "relationship"` and deduplicate by `edge.id`, because a self-relationship appears in both lists.

When the changed ID is a Relationship, query the relationship record and inspect its `from`, `to`, description, and constraints. `neighbors` matches endpoint IDs, not the Relationship record's own ID.

Inspect the before root for removed context; current-root queries cannot reconstruct deleted records. Use the consumer's own bridge for feature traces or delivery references outside the ddduck product root.

## Review outcome

For every reported ID, state the structural difference, before/after ownership and paths, affected obligations and use cases, supporting evidence, contradictions, and one of the exact classifications from the modeling reference. Preserve a Guarantee ID across ownership moves. Treat deletion and recreation under another ID as an identity break, not a move.

Conclude separately:

- structural comparison completed or incomplete;
- semantic change acceptable, not acceptable, or decision required;
- historical retention check required or satisfied;
- runtime and external effects verified or unverified.
