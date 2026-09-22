# Control relay: definition to planning

This fictional teaching scenario distinguishes delivering a directive from carrying it out.
An operator requests delivery to a recipient; receiving the directive does not prove that
the recipient acted on it. All identities and requirements belong to this example, not to
an actual product or organization. It is not a runnable relay. No messages are sent.

Read [exploration](exploration.md), inspect the [canonical model](ddd/product.yaml), then
read the [planning handoff](planning-brief.md). The separate files expose teaching stages;
a consumer should normally reuse one existing brief. The accepted choices are for this
example only.

## Run the artifact walkthrough

From the ddduck checkout, use these commands serially. Installed users can substitute
`ddduck` for `node scripts/ddduck.mjs`. No service or application is needed.

```bash
node scripts/ddduck.mjs generate --root examples/control-relay/ddd
node scripts/ddduck.mjs check --root examples/control-relay/ddd
node scripts/ddduck.mjs query spec --root examples/control-relay/ddd --json
node scripts/ddduck.mjs query impact --id RELAY-INV-01 --root examples/control-relay/ddd --json
node scripts/ddduck.mjs query neighbors --id concept:recipient --root examples/control-relay/ddd --json
node scripts/ddduck.mjs query node --id rel:directive-targets-recipient --root examples/control-relay/ddd --json
node scripts/ddduck.mjs query context --id use-case:relay-directive --root examples/control-relay/ddd --json
```

Impact finds the use case that preserves the confirmation/refusal obligation. Neighbors
finds the incoming directive relationship; the relationship record explains its meaning.
Neither read establishes runtime impact. Context selects the use case and its perimeter;
the planner still needs the brief's intent and exclusions. No separate review query is needed.
An optional source-only check diagnoses invalid hand edits before generation. Keep sources
stable across the reads: impact, neighbors, and node are not an atomic multi-read snapshot.

The product has one domain, two concepts, three active Guarantees, one use case, one
relationship, and no interfaces or executable evidence. Its empty prerequisite list is
intentional: the interaction accepts requests that may be refused. Confirmation is an
enforced obligation, not an assumption that excludes invalid requests from the use case.

## Friction comparison and decisions

This is an artifact comparison, not a measured productivity study or a live-agent evaluation.

| Question                                 | Existing baseline                                                                                        | Choice and maintenance cost                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| What is settled?                         | A short brief labels open and accepted intent                                                            | Reuse the brief; the template is optional, not a proposal registry                                                               |
| Which obligations change independently?  | One bundled relay statement makes confirmation, non-enactment, and reporting harder to select separately | Keep three cohesive obligations; three files and one ownership list are maintained                                               |
| Which context matters?                   | Impact plus neighbors, then a relationship read when needed                                              | Drop the proposed review query; preserve interpretation by a reviewer rather than another report contract                        |
| What changed across snapshots?           | Read two records and both ownership lists manually                                                       | Stable-ID diff exposes moves/wording/removals; maintaining its report contract is the cost                                       |
| Can hand authoring suffice?              | A new concept needs its file and the domain list; a domain or use case needs its file and the root list  | Templates suffice here; implemented creation helpers coordinate those updates, at the cost of a small validated mutation surface |
| Is another architecture decision needed? | Decision and rationale fit in exploration                                                                | No ADR for this teaching boundary; retain one only if a durable decision needs separate history                                  |

The example puts a short goal next to explicit preserved/established references instead of
bundling every obligation into the goal. It does not split every sentence or invent
prerequisites. A relationship is kept only to make target identity reviewable.

Manual authoring here comprises nine YAML source files and three narrative teaching files.
Generated views are maintained by the CLI. The three normative statements live in YAML;
the brief adds concrete acceptance/refusal examples and links instead of copying them.
Three example choices are settled: confirmation/refusal, delivery without enactment, and
honest reporting. Authorization policy remains missing context, explicitly open.

A template-driven new concept still requires two coordinated file edits; a zero-change
decision requires none. The [creation helpers](../../docs/cli.md#creating-domains-concepts-and-use-cases)
reduce that bookkeeping to one operation without deciding product meaning. The command sequence
above makes the baseline reproducible without timing claims. For comparing two valid roots,
the implemented comparison command is:

```text
ddduck diff --base <root> [--root <root>] [--json]
```

The separate ownership-change fixture uses the existing fictional Members and Reminders
domains: it moves responsibility from Members to Reminders, preserves the Guarantee ID,
and updates both ownership lists. Inspect before-context as well as current references;
a current-only query cannot explain a removed node. The fixture belongs to the change-review
tests, not this relay's model, and does not describe a real product migration.
