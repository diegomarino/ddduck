# Modeling and evidence

Read this reference for every ddduck bootstrap, audit, or reconciliation.

## Evidence ledger

For every candidate model fact, record:

- the proposed assertion;
- repository-relative path plus line, symbol, heading, or test name;
- role: implementation, verification, documentation, decision, or configuration;
- contradictory evidence;
- inspected scope and remaining unknowns.

Executable behavior and passing tests establish observed behavior. Accepted requirements and decisions establish intended behavior. A conflict between them is an inconsistency requiring a decision; neither side silently becomes product truth.

Repository-wide evidence belongs in the plan and final report. Persist only evidence fields supported by the installed schema. Interface anchors must remain inside the product root. Do not copy source into the model, invent metadata, or create bridge documents merely to manufacture provenance.

Valid anchors prove that declared text exists. Declared audit verdicts remain assessments. Readiness records and valid links do not execute tests or prove runtime behavior.

## Define before asserting

Reuse an existing proposal or brief. Capture the actor and problem, success and refusal examples, evidence provenance, accepted constraints, alternatives, open conflicts, affected IDs, decision and rationale, and receiving plan. Omit sections that add no decision value.

- `Observed`: inspected behavior, not endorsement.
- `Accepted`: intended behavior with identified authority; it may be unimplemented.
- `Open`: unresolved meaning that stays out of canonical YAML.
- `Rejected`: considered alternative retained with its rationale.

These labels are prose, not schema fields or Guarantee lifecycle states. Independent accepted obligations may be modeled while another question remains open. Zero canonical change is correct when existing obligations suffice, the proposal remains unresolved, or the change is implementation-only. Create an ADR only for a durable consequential decision worth maintaining.

## Model by meaning

- Domain: a distinct product responsibility, not a package or screen.
- Concept: vocabulary needed to reason about a decision, not every noun or class.
- Guarantee: an observable obligation or invariant, not an aspiration.
- UseCase: an actor goal and the obligations it requires, preserves, or establishes, not an implementation task list.
- Relationship: an explicit connection worth reviewing, not proof of causation.
- Interface: optional; add one only when an external behavioral boundary matters.

Prefer the smallest coherent model change. Preserve identity and history. Never silently delete or reuse a Guarantee ID.

Classify every material difference as exactly one of:

- verified omission;
- stale modeled fact;
- structural inconsistency with an unambiguous repair;
- contradiction or uncertainty requiring a human decision;
- irrelevant implementation detail;
- insufficiently covered.

## Greenfield coverage

Initialize only when identity, purpose, and initial domain seams are explicit or unambiguously grounded.

Use runtime-supported subagents only when no model exists and the evidence corpus spans several substantial independent packages, applications, or domains that cannot fit reliably in the coordinating context. File count alone is insufficient. Give each subagent a non-overlapping read-only scope and require candidate facts with exact evidence locations, conflicts, unknowns, and coverage. The coordinator re-reads decisive evidence and is the sole model writer.
