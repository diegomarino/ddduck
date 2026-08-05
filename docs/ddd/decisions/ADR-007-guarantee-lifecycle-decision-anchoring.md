---
id: ADR-007
title: Guarantee Lifecycle Decision Anchoring
status: accepted
date: 2026-08-01
deciders:
  - Diego
  - Codex
supersedes: []
supersededBy: []
related:
  useCases: []
  domains:
    - domain:metamodel
    - domain:traceability
    - domain:authoring-workflow
    - domain:tooling-runtime
  guarantees: []
---

# ADR-007 - Guarantee Lifecycle Decision Anchoring

## Context

A Guarantee retains its stable identifier when its lifecycle changes to `split` or `retired`.
That preservation makes the history auditable, but the format previously had no explicit
product decision that authorized the transition.

## Decision

A non-effective Guarantee must record `lifecycleDecision: ADR-NNN`. The value is the logical
identifier of the product-local decision that changed the Guarantee lifecycle. It is not an
Evidence Anchor.

`active` Guarantees omit `lifecycleDecision`. `split` and `retired` Guarantees require it.
The checker resolves the identifier through the product layout's decision registry. The
schema and CLI contract use only the logical identifier; they do not encode a filesystem path.

The lifecycle commands require `--decision ADR-NNN` and preserve their refusal to make active
Use Case references invalid.

## Considered Options

1. **Treat lifecycle authorization as Evidence** - Rejected. An ADR changes the product's
   lifecycle policy; it is not source material supporting a claim.
2. **Record a literal decision path in every Guarantee** - Rejected. Paths couple canonical
   product data and command contracts to a layout detail.
3. **Use a logical ADR identifier resolved by the product registry** - Accepted. It keeps
   canonical references stable while the product layout supplies the current registry.

## Consequences

Lifecycle changes now leave a decision-level audit trail without adding a new graph node or
configuration surface. Alternate layouts and configurable registries remain deferred.

## Verification

The Guarantee schema rejects a missing lifecycle decision for non-effective states and rejects
one on an active Guarantee. The product checker resolves the logical identifier in the product-local
registry. CLI lifecycle commands require `--decision`, and generated views continue to omit
non-effective Guarantees.

## Links

- [ADR-006 - Product Model And Framework Contract Planes](ADR-006-product-model-and-framework-contract-planes.md)
