<!-- GENERATED FILE: do not edit by hand. Regenerate by running ddduck generate --root ../.. from this file's directory. -->

# ddduck (`model:ddduck`)

Name status: `stable`

Define and verify an opinionated DDD framework for modeling systems, tracing guarantees, and controlling change impact.

## Domains

### Authoring Workflow (`domain:authoring-workflow`)

Own the workflow for creating, reviewing, revising, and retiring model nodes.

#### Concepts

- `concept:decision-recording` - Decision Recording
- `concept:model-node-lifecycle` - Model Node Lifecycle

#### Interfaces

- None.

#### Active guarantees

- `AUTHORING-INV-01` - Unresolved proposals remain outside canonical product facts until their meaning is explicitly accepted; observed implementation alone does not establish accepted product intent.
- `AUTHORING-INV-02` - Selected canonical context constrains a planning brief but does not supply its delivery intent, scope, alternatives, tasks, or approval.

### Documentation (`domain:documentation`)

Own human-readable model views, explanations, and citations without owning structural model facts.

#### Concepts

- `concept:documentation-freshness` - Documentation Freshness
- `concept:documentation-view` - Documentation View
- `concept:model-reference` - Model Reference
- `concept:structural-claim` - Structural Claim
- `concept:verified-model-view` - Verified Model View

#### Interfaces

- None.

#### Active guarantees

- None.

### Metamodel (`domain:metamodel`)

Define the kinds of nodes and edges that can exist in a ddduck model.

#### Concepts

- `concept:canonical-model-node` - Canonical Model Node
- `concept:concept` - Concept
- `concept:domain` - Domain
- `concept:external-context` - External Context
- `concept:model` - Model
- `concept:node-kind` - Node Kind
- `concept:relationship` - Relationship

#### Interfaces

- None.

#### Active guarantees

- None.

### Tooling Runtime (`domain:tooling-runtime`)

Own the executable tools that validate, assemble, and generate artifacts from the canonical model.

#### Concepts

- `concept:command-output-contract` - Command Output Contract
- `concept:quality-gate` - Quality Gate

#### Interfaces

- None.

#### Active guarantees

- None.

### Traceability (`domain:traceability`)

Own the rules that prove model completeness, coherence, and guarantee lifecycle coverage.

#### Concepts

- `concept:coverage-gate` - Coverage Gate
- `concept:dangling-reference` - Dangling Reference
- `concept:disposition` - Disposition
- `concept:format-rule` - Format Rule
- `concept:guarantee` - Guarantee
- `concept:ledger-entry` - Ledger Entry
- `concept:lint-rule` - Lint Rule
- `concept:orphaned-node` - Orphaned Node
- `concept:rule-spec` - Rule Spec
- `concept:schema-validation` - Schema Validation

#### Interfaces

- None.

#### Active guarantees

- `TRACEABILITY-AC-01` - Comparing valid roots of the same Model reports added, removed, changed, and relocated canonical records by stable ID, including ownership changes and removed Guarantees.
- `TRACEABILITY-INV-01` - Structural differences and graph relationships are review evidence; they do not establish semantic acceptance, causal impact, or verified runtime behavior.

### Visualization Export (`domain:visualization-export`)

Own generated exports that adapt canonical model data for external visualization tools.

#### Concepts

- `concept:contextflow-project-json` - ContextFlow Project JSON

#### Interfaces

- None.

#### Active guarantees

- None.

## Use Cases

### Define a product change (`use-case:define-product-change`)

Help an author separate observations, open questions, and accepted obligations before making the smallest coherent canonical model change.

- Requires: none
- Preserves: `AUTHORING-INV-01`
- Establishes: none
- Interfaces: none

### Prepare planning context (`use-case:prepare-planning-context`)

Give a planner explicitly selected product obligations and their boundaries while the receiving workflow supplies delivery intent and acceptance examples.

- Requires: none
- Preserves: `AUTHORING-INV-01`, `AUTHORING-INV-02`, `TRACEABILITY-INV-01`
- Establishes: none
- Interfaces: none

### Review a product change (`use-case:review-product-change`)

Show a reviewer what changed between independently valid versions of a Model and which before-and-after context to inspect for a semantic decision.

- Requires: none
- Preserves: `TRACEABILITY-INV-01`
- Establishes: `TRACEABILITY-AC-01`
- Interfaces: none

## Interfaces

## Relationships

- `rel:authoring-workflow-metamodel`: `domain:authoring-workflow` -> `domain:metamodel` (`uses`) - Authoring Workflow creates and updates model nodes whose allowed kinds and edge rules are defined by Metamodel.
- `rel:documentation-metamodel`: `domain:documentation` -> `domain:metamodel` (`reads`) - Documentation reads canonical model node definitions when explaining structure, ownership, and relationships.
- `rel:tooling-runtime-traceability`: `domain:tooling-runtime` -> `domain:traceability` (`executes`) - Tooling Runtime executes traceability checks and reports validation results for the canonical model.
- `rel:traceability-documentation`: `domain:traceability` -> `domain:documentation` (`validates`) - Traceability validates that documentation references resolve and that verified views stay aligned with canonical model facts.
- `rel:traceability-metamodel`: `domain:traceability` -> `domain:metamodel` (`validates`) - Traceability validates that model nodes and edges defined under Metamodel resolve and remain coherent.
- `rel:visualization-export-metamodel`: `domain:visualization-export` -> `domain:metamodel` (`reads`) - Visualization Export reads canonical model topology and emits derived graph artifacts such as ContextFlow project JSON.

## Decisions

- `ADR-001`
- `ADR-002`
- `ADR-003`
- `ADR-004`
- `ADR-005`
- `ADR-006`
- `ADR-007`
- `ADR-008`
