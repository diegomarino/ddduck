---
id: ADR-008
title: Delivery Adapter Boundary And Context Pack
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

# ADR-008 - Delivery Adapter Boundary And Context Pack

## Context

ddduck must make its canonical product facts useful to delivery workflows without
making a particular workflow's vocabulary, directory layout, Markdown grammar, or lifecycle
part of the product model.

External delivery workflows use their own vocabulary and artifact shapes. The canonical product
model does not contain enough delivery-specific intent to truthfully author a complete feature
or change proposal.

## Decision

ddduck exposes a one-way, bounded **context pack**. It is not a delivery
handoff.

The framework validates and emits a versioned context pack from an explicit bounded selection
of canonical IDs and their resolved context. It carries model identity and a revision or
content digest. It does not contain delivery intent, a target adapter, or a universal
`Feature`, `Change`, `FR`, `SC`, `US`, `Task`, `Scenario`, or lifecycle-state model.

The current context-pack contract has one fixed boundary: its selected IDs are full canonical records; its perimeter
contains every direct incident typed edge exactly once and only summaries of unselected edge
endpoints. The pack does not expand a neighbor's full record, follow a second edge, infer
ownership closure, or read historical Guarantees. A caller that needs more context requests a
new pack with those IDs explicitly selected.

An eventual adapter may combine that context pack with a delivery brief owned by the receiving
workflow, then create target-native context or a scaffold. The brief and its output are not
ddduck sources and are not claimed to be complete delivery specifications. The receiving
team or agent owns scope, alternatives, UX, acceptance measurement, planning, and tasks.

Any future adapter must begin from a concrete consumer. It may create a scaffold from context,
but must not parse, synchronize round-trip, or autonomously author a final delivery
specification.

Native delivery artifacts can later be linked back to canonical Guarantees through a separate
binding manifest. That manifest is the source of truth only for the assertion that a qualified
artifact anchor has a ddduck relation to a canonical ID. It never imports
delivery prose, native lifecycle state, or task records into the product graph.

No output directory is part of this decision. Adapter registration or command arguments select
the source and output roots; the contracts use resolved paths relative to their declared root.

## Considered Options

1. **Parse and validate one strict Markdown grammar first** — Rejected. It would tie the
   boundary to one producer convention before a reusable semantic contract exists.
2. **Generate final native specs directly from the canonical model** — Rejected. Guarantees
   and Use Cases constrain a delivery proposal but do not determine its new intent, scope,
   alternatives, UX, success measures, or tasks. Pretending otherwise would produce
   authoritative-looking fiction.
3. **Prove a one-way context pack before any adapter** — Accepted. It is useful to agents in
   its own right, reviewable, independently validatable, and does not presume that a native
   scaffold is the right next output.
4. **Add two-way synchronization from the first release** — Rejected. It needs conflict,
   authorship, revision, and change-detection policy that no current consumer requires.

## Consequences

The adapter boundary has three distinct outputs, all derived from canonical source:

- a human-facing generated view, when a consumer needs explanation and review;
- a bounded JSON context packet for an agent, when a consumer needs exact graph context; and
- a context pack that a future adapter may combine with its own delivery brief.

These outputs may share a resolver but are not interchangeable contracts. A Markdown domain
brief is a possible generated view, not an MVP source or required universal output.

ddduck validation proves canonical IDs, selected-context closure, model identity, and
digest freshness. An adapter validates its target profile and the artifact it emits. The native
producer validates its own grammar. A future binding checker validates ddduck relations
and qualified anchors. Each layer reports its own failures rather than inferring success from
another layer's green result.

Any adapter needs a separate, evidence-backed decision after a concrete consumer justifies it.

## Verification

The first proving slice must show that:

- an invalid or stale canonical selection cannot produce a valid context pack;
- a context pack has bounded, deterministic canonical context and an inspectable model digest;
- selected records are complete while all unselected one-hop neighbors are summaries only;
- the pack is useful to an agent without reading arbitrary YAML or repository-wide Markdown;
- a future adapter can use the pack with a delivery brief without adding Feature, Change, FR,
  Task, Scenario, or lifecycle state to the product graph; and
- ddduck checks do not depend on an agent obeying generated commands, hooks, or a native
  producer parser.

## Links

- [ADR-006 - Product Model And Framework Contract Planes](ADR-006-product-model-and-framework-contract-planes.md)
