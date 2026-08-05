---
id: ADR-001
title: Canonical Model Storage Format
status: accepted
date: 2026-07-30
deciders:
  - Diego
  - Codex
supersedes: []
supersededBy:
related:
  useCases: []
  domains:
    - domain:metamodel
    - domain:traceability
    - domain:tooling-runtime
    - domain:visualization-export
  guarantees: []
---

# ADR-001 - Canonical Model Storage Format

## Context

ddduck needs a source format for product models that is atomizable, reviewable in Git, friendly to human and AI authors, and precise enough for tooling to resolve IDs, validate relationships, and detect dangling or orphaned nodes.

The motivating journeys — starting a controlled ddd project, visualizing the domain graph, and detecting dangling or orphaned model nodes — are now implemented as ddduck CLI capabilities, though the self-model does not yet define UseCase nodes for them.

The candidate formats were JSON, JSONL, and YAML. The canonical source must support small, readable changes while allowing deterministic generated views for machine consumers.

## Decision

Use **YAML, one canonical node per file, as the editable source**.

Validate canonical YAML with **JSON Schema**. Generate JSON, NDJSON, and Markdown views from canonical source when a consumer needs them; generated output is never the source of truth.

Canonical model files must follow these rules:

- Each file contains exactly one node.
- Each node has `schemaVersion`, `kind`, and `id`.
- IDs are stable and never change when content, ownership, or placement changes.
- Relationships between nodes are explicit ID references, not implicit path references.
- YAML must parse as a mapping with unique keys and satisfy the schema for its node kind.
- IDs and enum values are written as strings unless a schema explicitly allows another type.
- Generated files are reproducible and may be deleted and regenerated from canonical YAML.

Canonical layout:

```text
product.yaml
model/
  domains/
  concepts/
  relationships/
  guarantees/
  use-cases/
  interfaces/
decisions/

schemas/
  product/
    model.schema.json
    domain.schema.json
    concept.schema.json
    relationship.schema.json
    guarantee.schema.json
    use-case.schema.json
    domain-interface.schema.json

generated/
  docs/model-overview.md
  graph/model-graph.json
  graph/model-graph.ndjson
```

## Considered Options

1. **Single JSON project file** - Rejected as the canonical source. JSON is excellent for machines and external interchange, but a single graph file creates noisy diffs, weak atomization, and poor review ergonomics for long statements and rationale.
2. **JSONL as canonical source** - Rejected as the canonical source. JSONL is good for append-only logs, event streams, snapshots, and generated graph exports, but rich model nodes become hard to read and edit as single lines.
3. **YAML as canonical source without a strict profile** - Rejected. Free-form YAML is too permissive for a framework whose value depends on mechanical validation.
4. **Strict YAML per node plus JSON Schema validation** - Accepted. It gives good human editing ergonomics, stable file-level atomization, comments where useful, and a clear path to machine validation and generated views.

## Consequences

The framework can start by modeling itself with small, reviewable files. A change to one guarantee, relationship, or decision can become a small Git diff and a bounded validation event.

The tooling must include a YAML parser, JSON Schema validation, and a graph assembler that emits derived artifacts. This adds early implementation cost, but that cost is aligned with the framework's core promise: model coherence must be checked by tooling, not remembered by people.

## Verification

The model checker is `scripts/check-model.mjs`. It must validate:

- every canonical YAML file parses as one mapping with unique keys;
- every node has a unique `id`;
- every `kind` is recognized by a schema;
- every edge target resolves to an existing node;
- every model concept has exactly one owning domain where ownership is required;
- every generated artifact is reproducible from canonical YAML.

The current checker covers YAML parsing, unique IDs, recognized product node kinds, JSON Schema validation, model graph reference resolution, ADR reference resolution, ownership consistency, policy declarations, documentation reference resolution, and validated examples. Separate freshness checks verify generated documentation and graph output.

## Links

- JSON specification: https://www.rfc-editor.org/info/rfc8259
- YAML specification: https://yaml.org/spec/1.2.2/
- JSON Schema specification: https://json-schema.org/specification
- JSON Lines format: https://jsonlines.org/
