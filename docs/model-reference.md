# Model reference

Canonical YAML uses schema version `"1"`. IDs are lowercase, hyphenated after their structural
prefix, except stable Guarantee IDs and decision IDs such as `ADR-001`. A Guarantee ID is keyed
to its classification: `<ORIGIN>-INV-<serial>` for an `invariant`, `<ORIGIN>-AC-<serial>` for an
`acceptance-criterion`.
The checker requires exactly one Model root.

## Model root

`product.yaml` is the only `Model` node. Unlike every child node, it has no `model` field.
Required fields are `schemaVersion`, `kind`, `id`, `name`, `purpose`, and `domains`. Optional
top-level fields include `nameStatus`, `useCases`, `relationships`, `decisions`, and `notes`.
`nameStatus` is a free-form string describing how settled the model name is (for example
`stable` or `provisional`); generated views show it only when it is declared.

```yaml
schemaVersion: "1"
kind: Model
id: model:<product-slug>
name: A product name
purpose: Define the product.
domains:
  - domain:<domain-slug>
useCases: []
decisions: []
```

## Child-node fields

All child nodes include `schemaVersion`, `kind`, `id`, and `model`. `model` must name the root
Model ID. `Domain`, `Concept`, and `DomainInterface` respectively use `domain:`, `concept:`, and
`interface:` IDs. A child owned by a Domain uses `ownerDomain`; the owning Domain must also list
the child in the matching collection.

### Domain

Required: `name`, `purpose`. Optional owned lists: `concepts`, `excludedConcepts`, `interfaces`,
`guarantees`, and `decisions`.

```yaml
schemaVersion: "1"
kind: Domain
id: domain:<domain-slug>
model: model:<product-slug>
name: A domain name
purpose: Describe the domain responsibility.
concepts: []
interfaces: []
guarantees: []
```

### Concept

Required: `ownerDomain`, `name`, `purpose`. Optional: `decisions`.

```yaml
schemaVersion: "1"
kind: Concept
id: concept:<concept-slug>
model: model:<product-slug>
ownerDomain: domain:<domain-slug>
name: A concept name
purpose: Describe the concept responsibility.
```

### Relationship

Required: `from`, `to`, `relationshipType`, `mode`, and `ownedBy` (a Domain ID). Optional:
`description`, `constraints`, and `decisions`.

### UseCase

Required: `name`, `goal`, `preconditions`, and `success`. `preconditions.requires` is required;
`success` requires `preserves` and `establishes` lists. Optional: `interfaces` and evidence
anchors.

### DomainInterface

Required: `ownerDomain`, `name`, and `operationKind` (`command` or `query`). Optional:
`guarantees` and evidence anchors.

### Guarantee

Required: `ownerDomain`, `classification` (`invariant` or `acceptance-criterion`), `statement`,
and `status` (`active`, `split`, or `retired`). A split or retired Guarantee also requires a
`lifecycleDecision`; a split Guarantee names active `successors`. Optional `ownershipHistory`
records former owning Domains. Evidence anchors are also supported.

Evidence anchors contain a product-relative `path`, `anchor`, and `role` (`source`, `decision`,
or `verification`). The path must resolve to a regular file inside the selected product root.
For Markdown (`.md`) paths the checker also verifies that the `anchor` string occurs in the
file content; for non-Markdown paths the anchor is a free-form label and is not content-checked.

For full schema constraints, inspect the shipped files under `schemas/product/`; use
[the getting-started guide](getting-started.md) for the minimal working path.
