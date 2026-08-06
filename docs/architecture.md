# Architecture

ddduck keeps product facts separate from framework contracts. Canonical product YAML is the
source of truth. Schemas, policies, validation, generation, and query code interpret that source;
they do not become product nodes. Generated views flow outward and are never canonical input.

```mermaid
flowchart LR
  subgraph Product[Selected product root]
    Source[product.yaml and model YAML]
    Decisions[decisions]
    Derived[generated views]
  end
  subgraph Framework[ddduck framework]
    Schemas[Schemas and policies]
    Check[Validation]
    Generate[Generators]
    Query[JSON query]
  end
  Source --> Check
  Decisions --> Check
  Schemas --> Check
  Check --> Generate
  Generate --> Derived
  Source --> Query
  Decisions --> Query
```

## Authoring and verification

After manual canonical YAML edits, authors validate source with `ddduck check --source-only`, run
`ddduck generate`, then run default `ddduck check`. Default `check` verifies source and that
required generated views are fresh, so it cannot precede generation after a source edit.

```mermaid
flowchart LR
  Edit[Author canonical YAML] --> SourceCheck[ddduck check --source-only]
  SourceCheck -->|valid| Generate[ddduck generate]
  SourceCheck -->|invalid| Fix[Fix diagnostics]
  Generate --> FreshCheck[ddduck check]
  FreshCheck --> Views[Fresh Markdown and graph views]
  Fix --> Edit
```

## Staged lifecycle mutation

Guarantee mutations run against a contained staging copy. The CLI validates the complete staged
product and regenerated views before publication. A rejected operation publishes no intended
canonical or generated change; filesystem interruption beyond that tested boundary is a recovery
concern, not a database transaction guarantee.

```mermaid
flowchart LR
  Request[create move split or retire] --> Lock[Acquire product lock]
  Lock --> Stage[Copy canonical source to staging]
  Stage --> Validate[Transform, validate, generate]
  Validate -->|valid| Publish[Publish canonical and generated views]
  Validate -->|invalid| Cleanup[Discard staging and release lock]
  Publish --> Release[Release lock and report result]
```

## Query boundary

Queries are read-only and always emit exactly one JSON document (`--json` is accepted as a
no-op). A context query returns selected canonical records,
direct touching edges, one-hop summaries for unselected neighbors, and a source digest. The
source digest covers the canonical node YAML sources only — `product.yaml` and the files under
`model/` — so decision records under `decisions/` are outside its scope. It does
not recursively expand context or write canonical or generated files.

```mermaid
sequenceDiagram
  participant Caller
  participant CLI as ddduck query
  participant Product as Canonical product root
  Caller->>CLI: query context --id ... --root ... --json
  CLI->>Product: Load and resolve selected source
  CLI-->>Caller: Selected records, edges, summaries, digest
  Note over CLI,Caller: No source or generated output is written
```
