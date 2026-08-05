---
id: ADR-005
title: Model Language Change Control
status: accepted
date: 2026-08-01
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
    - domain:documentation
    - domain:tooling-runtime
  guarantees: []
---

# ADR-005 - Model Language Change Control

## Context

ddduck must be able to learn from richer product models without forcing every
future idea into the initial canonical language. Examples drawn from richer real-world
products may later justify first-class concepts such as actors, capabilities, guarantees,
interfaces, or more precise relationships.

The current model format is intentionally strict. Its JSON Schemas reject unknown
fields, `Domain.owns` currently lists concepts, and the checker and generated graph know
the existing node kinds. Consequently, an apparently additive change can be incompatible
with older tooling even when it does not change the meaning of an existing node.

The project needs an explicit distinction between safe growth of model content and
evolution of the language that represents that content.

## Decision

Treat canonical model evolution as additive by default, with an explicit compatibility
decision when the language itself must grow.

The compatibility policy is:

- Adding a new node, relationship, rule, decision, or optional field is compatible only
  when it preserves the meaning and stable ID of every existing canonical fact.
- Renaming, removing, or reinterpreting a stable ID is a breaking change. It requires a
  documented deprecation and upgrade path.
- A new node kind, a new required field, a new ownership shape, or a new relationship
  semantic is a format evolution. It requires a deliberate `schemaVersion` change, a
  documented upgrade path, and generated outputs or query responses that identify their
  contract.
- Tooling must fail explicitly rather than silently misinterpret an unsupported model
  contract.
- A product-specific idea begins as a `Concept` unless a stable query, executable rule,
  ownership/lifecycle distinction, or generated view proves that it needs its own kind.
- Generated artifacts and query contracts must declare their schema contract. Consumers
  may ignore unknown non-essential fields, but must reject an unsupported required semantic
  explicitly.

## Considered Options

1. **Freeze the initial node kinds indefinitely** - Rejected. It would make the model
   unable to promote proven product-spec language such as a first-class guarantee.
2. **Allow arbitrary fields and node kinds without validation** - Rejected. It would weaken
   deterministic validation and leave consumers to infer semantics from ungoverned data.
3. **Promote every likely future entity now** - Rejected. The model would gain vocabulary
   without real queries, rules, or ownership contracts to justify it.
4. **Add content freely and evolve the language through reviewed promotions** - Accepted.
   It preserves a small strict core while keeping proven future growth possible.

## Consequences

Product models may add ordinary concepts and their relationships without changing the
format. A later `Actor`, `Guarantee`, or similar type remains possible, but is not a
silent extension: it must have a reviewed upgrade path and an explicit consumer contract.

Before promoting a type, the proposal must show the concrete query, rule, ownership
ambiguity, or generated view that generic concepts cannot serve. The promotion should be
proven with a narrow reference-product slice before broad extraction.

This decision does not introduce a new kind, schema change, upgrade mechanism, or query API.
Those are separate implementation slices once a concrete promotion earns them.

## Verification

Current verification remains:

```bash
npm run check
```

When a model-language change is proposed, its implementation must add fixtures that prove
the supported contract and that an unsupported contract fails with an actionable error.
Generated exports and query responses must expose their declared schema contract in those
fixtures.

## Links

- [ADR-001 - Canonical Model Storage Format](ADR-001-canonical-model-storage-format.md)
- [ADR-004 - Documentation As Verified Model Views](ADR-004-documentation-as-verified-model-views.md)
