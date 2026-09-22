# Exploration: should delivering a directive enact it?

## Problem and actor

An operator wants to relay a directive to a recipient and know what delivery established.
The teaching problem is accidental overclaiming of effects, not a design for a real transport.

## Examples and refusal cases

- Confirmed exact content and one recipient, followed by acknowledgement: report delivered,
  without asserting that work started or finished.
- Two possible recipients, or no confirmation: refuse without sending.
- A send attempt with no conclusive response: report unknown; the same confirmation does
  not authorize another attempt.

These are acceptance examples, not observed executions.

## Evidence boundary

This is a fictional design exercise, not an observation of an existing application.
Delivery without enactment is an explicit teaching assumption. No runtime findings,
real recipients, credentials, or external project documents are evidence for this scenario.

## Accepted constraints

Accepted for this educational scenario: a relay can bound delivery attempts and report a
known result without authority to enact the directive. Interfaces and transport selection
are unnecessary to express that boundary.

## Alternatives

Rejected: treat an acknowledged delivery as proof of enactment. A recipient may receive
a directive without carrying it out.

Rejected: introduce a domain for every component, or add one Guarantee per sentence.
A single relay responsibility and three independently reviewable obligations suffice.
Keep the attempt guard cohesive: confirmation, unique resolution, and refusal govern the
same decision to send.

## Open questions and conflicts

Open: which operators may authorize which recipients? The teaching model intentionally
does not decide that policy. Confirmation is not evidence of authorization. A real delivery
implementation is blocked on resolving this question; independent modeling work can proceed.
Observed permissive code, if later found, would not settle this question.

## Affected canonical IDs

The following records encode only the accepted teaching boundary:

```text
RELAY-INV-01
RELAY-INV-02
RELAY-AC-01
use-case:relay-directive
```

This is a partial model of the problem. A later UI wording change that preserves these
obligations can have zero canonical changes. The open authority question must not be
silently promoted to a new canonical fact.

## Decision and rationale

Accepted as the example author's teaching choice: separate the attempt guard, the
non-enactment boundary, and reporting. They answer distinct review questions while sharing
one responsibility. This is not acceptance for a real product or evidence of implementation.
A separate ADR would duplicate this small rationale without adding decision value.

## Planning handoff

The [planning brief](planning-brief.md) selects these obligations, supplies delivery scope
and examples, and keeps the authorization decision explicit.
