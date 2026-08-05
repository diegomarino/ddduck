---
id: ADR-002
title: Node Tooling Library Stack
status: accepted
date: 2026-07-30
deciders:
  - Diego
  - Codex
supersedes: []
supersededBy:
related:
  useCases: []
  domains:
    - domain:authoring-workflow
    - domain:metamodel
    - domain:tooling-runtime
    - domain:traceability
    - domain:visualization-export
  guarantees: []
---

# ADR-002 - Node Tooling Library Stack

## Context

ADR-001 made strict YAML the canonical editable source and generated JSON/JSONL the interchange surface. The project needs a coherent Node.js library stack for parsing Markdown, YAML, JSON, and JSON Schema before it can safely expand checkers, generated artifacts, or documentation verification.

The immediate checker already runs in Node.js. The library choices should preserve these properties:

- canonical model facts remain in strict YAML;
- JSON Schema remains the validation language for node shapes;
- Markdown may explain model facts, but must be parseable for verified views;
- imported seed material remains outside the canonical tooling gates.

Formatting and lint rule formats are intentionally handled by ADR-003.

## Decision

Use Node.js as the tooling runtime and standardize on these parsing and validation libraries:

| Concern      | Decision                                 | Role                                                                                                         |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| YAML         | `yaml`                                   | Parse canonical YAML with document-level errors, duplicate-key rejection, and strict-profile checks.         |
| JSON         | Native `JSON.parse` and `JSON.stringify` | Read schemas and generated JSON artifacts unless streaming or comment-preserving behavior becomes necessary. |
| JSON Schema  | `ajv` with the draft 2020-12 entrypoint  | Compile and run schemas under strict mode.                                                                   |
| Markdown AST | `unified` plus `remark-parse`            | Parse narrative Markdown into an AST for verified documentation checks.                                      |

The model checker must use these libraries rather than ad hoc parsers for canonical data.

## Considered Options

1. **Ruby scripts plus ad hoc checks** - Rejected. Ruby was useful for the first sanity check but is not the desired project tooling direction.
2. **Python tooling** - Rejected for now. Python is strong for repository checkers, but choosing it would introduce a second stack before the project needs one.
3. **Node.js with minimal libraries** - Accepted. It aligns with future CLI and visualization work while keeping the current checker small.
4. **`markdown-it` for Markdown** - Rejected as the primary Markdown library. It is strong for rendering, but ddduck needs AST inspection and documentation verification more than HTML rendering.
5. **`unified` and `remark-parse` for Markdown** - Accepted. They provide an AST pipeline suitable for verified documentation views.
6. **`js-yaml` for YAML** - Rejected. It is mature, but `yaml` provides document inspection and strict parser diagnostics that fit the current checker.
7. **Custom JSON Schema validator** - Rejected. JSON Schema semantics are subtle, and Ajv already supports draft 2020-12 and strict mode.

## Consequences

The project gets a single Node.js validation surface early, before more generated artifacts exist.

Adding Ajv increases dependency count, but it converts the existing JSON Schemas from passive documentation into an executable gate.

Documentation verification can parse Markdown through `unified` and `remark-parse`, resolve model IDs, and reject structural claims that do not point back to model facts.

## Verification

The checker must validate current YAML files against JSON Schema through Ajv 2020-12. Tests must include at least one negative schema validation case.

The repository-level gate that runs the checker is defined by ADR-003.

## Links

- YAML package: https://github.com/eemeli/yaml
- Ajv: https://ajv.js.org/
- Unified: https://unifiedjs.com/
- remark-parse: https://github.com/remarkjs/remark/tree/main/packages/remark-parse
