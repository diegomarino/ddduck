# Planning handoff: confirmed relay boundary

## Intent and selected context

Prepare a delivery design that preserves the accepted boundary in
[exploration](exploration.md#decision-and-rationale). Select the
[relay use case](ddd/model/use-cases/relay-directive.yaml) and its three referenced
Guarantees; use the [walkthrough commands](README.md#run-the-artifact-walkthrough) to
retrieve bounded context. Those records define obligations. This brief supplies delivery
intent and scope, which cannot be inferred from a graph.

## Scope, non-goals, and dependencies

In scope for planning: confirmation/refusal handling and honest result presentation.
A local simulation could explore these after its test design is agreed.

Non-goals: enacting directives, mutating a recipient's work state, choosing a production
transport, adding retries, or importing a consumer's complete architecture.

Dependency: resolve who may authorize each recipient before implementing a real send path.
Transport acknowledgement semantics also need an explicit contract. The open policy
question blocks that work; it does not invalidate the independent accepted boundaries.

## Acceptance and refusal examples

| Input and observation                                               | Required outcome                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------- |
| Confirmed content, one resolved recipient, delivery acknowledgement | Report delivered; make no enactment claim                 |
| Missing confirmation or ambiguous recipient                         | Refuse without attempting delivery                        |
| Confirmed attempt, no conclusive response                           | Report unknown; do not repeat using the same confirmation |

These cases are proposed acceptance criteria for downstream verification. They have not
been run against a relay. Reference the canonical obligations when refining them rather
than maintaining another normative copy.

## Evidence and exclusions

The example contains canonical YAML and CLI-generated views only. Model checks establish
schema/reference consistency; fresh views establish correspondence to source. Neither
executes a relay, verifies behavioral coverage, or settles the open authority policy.

There are no executable evidence anchors. A future audit's declared verdict or readiness
roles would still not be a test-run result. Record actual commands and observations only
when executed, distinguishing local simulations from provider or runtime effects.

Excluded: consumer runtime, external feature traces, real authorization, message delivery,
and recipient enactment. The receiving delivery tool owns task breakdown and progress;
ddduck does not create or synchronize that backlog.
