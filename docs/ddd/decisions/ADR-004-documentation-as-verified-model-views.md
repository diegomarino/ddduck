---
id: ADR-004
title: Documentation As Verified Model Views
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
    - domain:documentation
    - domain:metamodel
    - domain:traceability
    - domain:tooling-runtime
  guarantees: []
---

# ADR-004 - Documentation As Verified Model Views

## Context

ddduck needs prose documentation, but uncontrolled prose can drift away from the canonical model. ADR-001 made strict YAML the source of truth for model facts. ADR-002 selected Markdown parsing libraries so documentation can later be inspected as an AST. ADR-003 established a quality gate and placed durable policy rules in `policies/`.

The project needs a boundary that lets documentation explain the model without becoming a competing source of structural facts.

## Decision

Treat documentation as verified views over the canonical model.

Documentation may introduce narrative, examples, diagrams, and onboarding structure. Structural claims about model nodes, ownership, relationships, policies, and decisions must either be generated from canonical model data or cite resolvable model IDs.

Canonical documentation policy:

- The model owns facts.
- Documentation owns human-readable views and explanation.
- A documentation view may be generated, manually authored, or mixed.
- A manually authored structural claim must cite model IDs when the claim depends on model facts.
- Tooling may reject unresolved documentation references or stale generated views.
- Generated documentation artifacts are reproducible and are not canonical source.

## Considered Options

1. **Keep documentation outside the model** - Rejected. This would preserve short-term flexibility but leave documentation drift as an unmanaged risk.
2. **Make documentation the source of truth for facts** - Rejected. Prose is useful for explanation, but structural model facts need stable IDs, schemas, and graph validation.
3. **Generate all documentation from model data** - Rejected for now. Fully generated docs would be consistent, but they would weaken narrative quality and make early design exploration too rigid.
4. **Treat documentation as verified model views** - Accepted. It preserves human-readable explanation while giving tooling a clear path to verify structural claims.

## Consequences

The model gains a Documentation domain. Traceability can define rules that verify documentation references. Tooling Runtime can later execute Markdown AST checks through the library stack selected in ADR-002.

Narrative documentation remains allowed, but important structural claims should become either model data or citations to model IDs.

## Verification

The checker loads the documentation-reference policy, parses Markdown, resolves cited model IDs and ADR IDs, and rejects missing documentation references. The generated-documentation check rejects stale generated views.

The repository-level gate remains:

```bash
npm run check
```

## Links

- ADR-001 - Canonical Model Storage Format
- ADR-002 - Node Tooling Library Stack
- ADR-003 - Formatting And Lint Rule Formats
