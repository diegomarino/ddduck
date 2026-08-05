# ADR-002 - Member availability transition

## Context

The former `MEMBERS-INV-00` availability rule stated that every member remained visible and
assignable in ordinary flows. It did not distinguish archived members from active members.

## Decision

Retire `MEMBERS-INV-00` and replace it with the active archived-member rule
`MEMBERS-INV-01`: an archived member is invisible and inassignable in ordinary flows.

## Verification

`ddduck check --root <product-root>` resolves this decision as the lifecycle decision for
`MEMBERS-INV-00` and rejects active Use Case or Interface references to a retired Guarantee.
