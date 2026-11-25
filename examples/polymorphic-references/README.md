# Polymorphic references: one field, several target kinds

This fictional scenario shows how to model a field that can point to different kinds of
concept with the node kinds ddduck already has, without extending the model language.
All identities belong to this example, not to an actual product.

Two fields need it:

- A deal's **party** is exactly one of a person or an organization.
- A **note** is about any number of people, organizations, and deals, in any mix.

## The pattern

A Relationship has a single `to`. Model one Relationship per possible target, and record
the rule that ties the siblings together once, as an invariant Guarantee that every
sibling lists in `guarantees`:

| Field | Relationships                                                                 | Guarantee      | Rule                       |
| ----- | ----------------------------------------------------------------------------- | -------------- | -------------------------- |
| party | `rel:party-is-person`, `rel:party-is-organization`                            | `DEALS-INV-01` | exactly one of the targets |
| note  | `rel:note-about-person`, `rel:note-about-organization`, `rel:note-about-deal` | `NOTES-INV-01` | any number, in any mix     |

Each relationship keeps `constraints` for what only that connection says: which domain
owns the data on the other side of the boundary. The cardinality rule lives in the
Guarantee, so it is written once, carries its own lifecycle, and can gain evidence anchors
that point at the code or tests enforcing it.

Adding a target is one new Relationship that lists the same Guarantee; no sibling changes.
If the rule itself changes, edit or replace the Guarantee, and every relationship that
lists it shows up in its impact.

## Run the walkthrough

From the ddduck checkout, use these commands serially. Installed users can substitute
`ddduck` for `node scripts/ddduck.mjs`.

```bash
node scripts/ddduck.mjs check --root examples/polymorphic-references/ddd
node scripts/ddduck.mjs query impact --id DEALS-INV-01 --root examples/polymorphic-references/ddd --json
node scripts/ddduck.mjs query neighbors --id concept:party --root examples/polymorphic-references/ddd --json
node scripts/ddduck.mjs query impact --id concept:person --include-relationships --root examples/polymorphic-references/ddd --json
```

Impact on the party invariant `DEALS-INV-01` returns both party relationships and the use case that
preserves it. Neighbors of the party concept lists one outgoing relationship per target.
With `--include-relationships`, impact on the person concept reaches both the party and
the note concepts.

## What this does and does not verify

`check` verifies that every listed Guarantee exists and is active, and the graph draws one
`guarantees` edge from each relationship to its rule. It does not verify that the code
honors "exactly one": that is the job of the code's own tests, which the Guarantee can
cite as evidence.

The cost is more records than fields. The two fields here take five relationships, and the
graph draws one edge per target. The model does not record that siblings form one field
except through the Guarantee they share.
