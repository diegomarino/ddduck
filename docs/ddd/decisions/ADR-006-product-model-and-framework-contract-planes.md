---
id: ADR-006
title: Product Model And Framework Contract Planes
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

# ADR-006 - Product Model And Framework Contract Planes

## Context

ddduck currently demonstrates its own model, schemas, checkers, policies, decisions,
and generated outputs in one repository. A product that adopts the framework must not need
to copy the framework implementation into its own specification directory or model checks
as product facts.

Framework policies, query contracts, verification checks, and generated views are not product
facts. Leaving that distinction implicit would make product schemas confuse the product graph
with the tooling that reads and validates it.

## Decision

Separate the product-model plane from the framework-contract plane.

The product-model plane contains only product facts: `Model`, `Domain`, `Concept`,
`Relationship`, `UseCase`, `DomainInterface`, and `Guarantee`. Evidence Anchors are shared
embedded values, not nodes. Additional node kinds require their own evidence-backed decision.

Framework contracts include policies, verification checks, query response schemas,
generators, and their implementation. A `PolicySpec` is a global framework policy loaded by
the checker; it has no product `ownerDomain`, does not appear in the product graph, and needs
no `appliesTo` selector.

An adopting repository stores source at an explicit product root, conventionally `ddd/`. The
framework package provides schemas, standard policies, generators, and the `ddduck` command.
Derived documentation and graph files live below `<product-root>/generated/` and are never
canonical source.

## Considered Options

1. **Keep rules as product nodes** - Rejected. A framework check is not a product fact and
   does not acquire product ownership because it validates a product.
2. **Copy framework schemas and policies into every product** - Rejected. It makes updates
   ambiguous and lets implementation artifacts drift from the installed framework version.
3. **Select policies by model or profile from the first release** - Rejected. The current
   delivery model has one product root per `ddd/` directory. A selector would introduce
   multi-model complexity without a consumer need.
4. **Separate product facts from global framework contracts** - Accepted. It keeps the
   product graph small while making validation and agent queries explicit framework
   services.

## Consequences

The implementation keeps policy validation in its own plane, keeps policies out of generated
product graph outputs, and makes the installed framework package the source of schemas and
standard policies.

The first authoring commands are `ddduck init`, `check`, `generate`, `query`, and `create`.
Lifecycle-changing operations such as moving, splitting, or retiring a Guarantee must be
explicit commands; arbitrary YAML editing remains available for ordinary content changes.

## Verification

The implementation slice must prove that:

- a product graph contains no policy nodes;
- a global framework policy is still validated against the product root;
- generated outputs live below `ddd/generated/` and fail freshness checks when stale; and
- `npm run check` remains the repository gate while ddduck dogfoods the split.

## Links

- [ADR-005 - Model Language Change Control](ADR-005-model-format-evolution-and-additive-compatibility.md)
