# From a product question to a planning brief

Start with the question, not a YAML record. Reuse an existing proposal or design brief;
the [optional change brief](templates/change-brief.md) is a checklist for missing context,
not a required document. A short note can be enough.

## Explore, decide, then model

1. Identify the actor and problem with concrete success and refusal examples.
2. Separate observed evidence from accepted intent and open questions. Record alternatives
   and contradictory evidence with provenance.
3. Make the semantic decision explicit. Record the decision and rationale in the brief;
   create an ADR only for a consequential, durable choice that needs its own history.
4. Update canonical YAML only where accepted meaning changed. Preserve stable IDs and use
   lifecycle commands for Guarantee transitions. A partial update can encode independent
   accepted obligations while an unresolved question stays in prose. Zero model change is
   correct when the existing model suffices, the change is implementation-only, or no
   decision has been reached.
5. Validate structure and refresh derived views, then hand selected context to the planner
   with delivery intent, scope, exclusions, dependencies, and acceptance examples.

**Observed** means evidence was inspected, not endorsed. **Open** means undecided.
**Accepted** means intended behavior, possibly not implemented. **Rejected** records an
alternative and rationale. These are prose labels, not new schema fields or Guarantee
statuses. A passing checker settles none of these semantic decisions.

For example, an admin capability need not be a member role. Existing code that grants one
from the other establishes observed behavior; whether that coupling is intended remains a
decision. Likewise, delivering a relay directive does not establish that the recipient
enacted it. Leave an unanswered question about who may authorize it open rather than
inventing an authority boundary.

## Model only what helps a decision

| Kind         | Useful meaning                                                             | Counterexample to avoid                            |
| ------------ | -------------------------------------------------------------------------- | -------------------------------------------------- |
| Domain       | A distinct product responsibility                                          | A domain for each package or screen                |
| Concept      | Vocabulary needed to reason about behavior                                 | A concept for every class, queue, or button        |
| Guarantee    | An observable obligation or invariant                                      | “Best effort delivery” with no concrete commitment |
| Use case     | An actor's goal and the obligations it requires, preserves, or establishes | An implementation task list                        |
| Relationship | A connection worth reviewing, with its meaning stated                      | Treating every connection as a causal dependency   |

Interfaces are optional. A useful behavioral model can have none. Empty prerequisite lists
are not inherently wrong; add a reference when it expresses a real prerequisite, not to
make the diagram look complete.

For a small relay, introducing separate UI, transport, and receipt domains and
concepts would obscure the one responsibility under discussion. Three cohesive obligations
can distinguish authorization/refusal, the limit of delivery, and honest reporting. Do not
split every clause: split when meaning, change, or verification is independent. Remove an
extra Guarantee, domain, brief section, or review step when it answers no additional question.
Consumer practice is inspiration, not proof that its artifact count or boundaries are right.

The [relay walkthrough](https://github.com/diegomarino/ddduck/tree/main/examples/control-relay)
is a fictional educational scenario. The
[reminders scenario](https://github.com/diegomarino/ddduck/tree/main/examples/reminders)
illustrates refusal. Neither specifies a real product or runs an application.

## Author and review with existing tools

After hand edits, `generate` validates the staged source and generated outputs before
publishing derived views. It is the normal refresh action. Run operations serially against a root.

```bash
ddduck generate --root <root>
ddduck check --root <root>
```

An optional `ddduck check --root <root> --source-only` diagnoses canonical edits before
generation; `query spec` can inspect individual view freshness when needed.
`check` is read-only and suitable for CI/final readback. Fresh generated views establish
consistency with source, not product acceptance or runtime correctness.

For each selected ID, compose the existing reads:

```bash
ddduck query impact --id <id> --root <root> --json
ddduck query neighbors --id <id> --root <root> --json
ddduck query node --id <relationship-id> --root <root> --json
ddduck query context --id <id> --root <root> --json
```

Impact follows reverse owns/requires/preserves/establishes/uses/guarantees edges.
Neighbors exposes direct incoming/outgoing edges, including explicit relationships. Read
the relationship record for its type, description, and constraints when needed. These are
review candidates requiring judgment; an empty result does not establish absence of risk.
To select explicit relationships, filter both edge lists by `edge.kind === 'relationship'`
and deduplicate by `edge.id`; a self-relationship appears in both lists. If the changed ID
is itself a Relationship, query its record and inspect its `from` and `to` endpoints:
neighbors matches endpoint IDs, not the relationship record's ID.
There is no separate review query. Do not infer transitive effects from relationship names.
Separate query calls are not an atomic snapshot: keep the source stable during review and
re-read if it changes. A source digest identifies the read source only when it did not race
a mutation; it does not make multiple reads transactionally consistent.

Inspect before and after roots when something moves or disappears. In the fictional
ownership fixture, the same Guarantee moves from Members to Reminders within the small
reference corpus:
review its owner, both domains' lists, wording, and use-case references without inventing a
new ID. Read-only current-root queries alone cannot recover removed context. External feature
references remain the consumer bridge's responsibility.

The comparison command is:

```text
ddduck diff --base <root> [--root <root>] [--json]
```

Its scope is canonical YAML records by stable identity, not decision/evidence
content, delivery artifacts, or runtime. Keep semantic review separate from structural
comparison and historical retention checking.

Use the implemented [domain, concept, and use-case creation commands](cli.md#creating-domains-concepts-and-use-cases)
to create records and update their parent lists coherently. Use-case creation consumes a
complete canonical YAML mapping; it does not invent obligations or decisions. See that
reference for syntax and refusal behavior. Schema-guided hand edits remain useful for
changes outside these helpers; update ownership/reference lists together before generation.

## Hand off intent, not just a graph

Select canonical context explicitly and link it from the receiving plan. Add why the work
is needed, scope and non-goals, success/refusal examples, dependencies, exclusions, open
decisions, and the next verification required. Reuse the exploration brief if it already
answers those questions; do not maintain duplicate requirement prose or a second backlog.

State evidence levels precisely: inspected implementation, declared evidence anchors,
structural checks, tests actually executed, and observed runtime are different claims.
An audit verdict is a declared assessment whose anchor integrity is checked; readiness
roles and valid links do not prove behavioral coverage. Keep anchors inside the supported
product root, and never create fake executable evidence or bridge documents to fill gaps.
