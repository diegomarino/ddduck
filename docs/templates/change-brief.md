# Optional change brief

Reuse an existing proposal, issue, or design brief first. Keep only sections that help a
decision; a few paragraphs may suffice. This file is not a canonical schema or a second backlog.
Use Observed, Open, Accepted, and Rejected as prose labels, never YAML lifecycle states.

## Problem and actor

Who needs what outcome, and why now?

## Examples and refusal cases

Describe concrete success, refusal, and uncertainty cases. Label expected behavior separately
from results actually observed.

## Observed evidence

Cite paths and headings, symbols, or tests; state provenance, inspected scope, and gaps.
Observed implementation may be a bug rather than intended behavior.

## Accepted constraints

Record accepted intent and its authority. Accepted does not mean implemented.

## Alternatives

Include doing nothing or reusing existing obligations, with tradeoffs and rejected choices.

## Open questions and conflicts

What still needs a decision? Which work depends on it? Keep unresolved assertions out of YAML.

## Affected canonical IDs

Select existing records explicitly; label proposed additions as proposals. Use fenced code
for IDs from another product when the repository scans documentation references.
Record partial or zero-model-change outcomes with a reason.

## Decision and rationale

Record who accepted what and why, plus what remains open. Link an ADR only if the durable
decision warrants a separate artifact.

## Planning handoff

Link the receiving plan and provide intent, scope, non-goals, acceptance/refusal examples,
dependencies, exclusions, unresolved decisions, and selected canonical context. State what
was verified, by which commands, and what has not been executed. A graph is not a delivery plan.
