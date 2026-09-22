# Members and reminders: invalid assignment

This reference corpus demonstrates the schema, lifecycle, relationships, and declared
evidence anchors. It is not a running reminder application. The evidence document is
illustrative; valid anchors do not prove executed tests or runtime behavior.

## Definition scenario

An actor wants to assign a reminder. An archived member is unavailable in ordinary flows,
so assigning a new reminder to that member must be refused. This expected refusal follows
the [member invariant](ddd/model/guarantees/members-inv-01.yaml) and
[assignment invariant](ddd/model/guarantees/reminders-inv-01.yaml). The
[use case](ddd/model/use-cases/create-reminder.yaml) selects the relevant obligations.

Accepted intent and observed behavior are separate. If an implementation permits this
assignment, record the behavior and its provenance as Observed, then reconcile the conflict;
do not silently change the model to endorse it. Whether a special administrative recovery
flow should allow another operation is Open and outside this ordinary-flow example.

No model change is needed to plan enforcement of the existing refusal. A short receiving
brief can say: implement ordinary-flow refusal, preserve valid assignments, exclude recovery
flows, and verify both cases. There is no need for a new Guarantee or proposal registry.

## Inspect the modeled context

From the ddduck checkout, run serially:

```bash
node scripts/ddduck.mjs query impact --id MEMBERS-INV-01 --root examples/reminders/ddd --json
node scripts/ddduck.mjs query neighbors --id concept:member --root examples/reminders/ddd --json
node scripts/ddduck.mjs query node --id rel:reminder-assigned-to-member --root examples/reminders/ddd --json
```

Impact follows reverse dependency edges; neighbors shows the assignment relationship as a
review candidate. Inspect its record for meaning, and use the consumer's own bridge to find
external feature references. These reads do not execute the refusal case.

For a no-interface model and an unresolved authorization question, see the
[relay example](../control-relay/README.md). For a reusable brief, see the
[definition workflow](../../docs/definition-workflow.md).
