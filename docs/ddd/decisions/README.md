# Decisions

This directory contains ddduck's own architecture decision records.

Imported evidence is intentionally not part of the canonical project structure. Decisions made for ddduck itself start here.

## Rules

- Use sequential IDs: `ADR-001`, `ADR-002`, and so on.
- Keep the ID stable forever, even if the file is renamed.
- Use frontmatter for machine-readable metadata.
- Use the body for the human rationale.
- Mark reversals through `supersedes` and `supersededBy`; do not delete historical decisions.
- Link to model nodes by ID once those nodes exist.

## Current Decisions

- [ADR-001 - Canonical Model Storage Format](ADR-001-canonical-model-storage-format.md)
- [ADR-002 - Node Tooling Library Stack](ADR-002-node-tooling-library-stack.md)
- [ADR-003 - Formatting And Lint Rule Formats](ADR-003-formatting-and-lint-rule-formats.md)
- [ADR-004 - Documentation As Verified Model Views](ADR-004-documentation-as-verified-model-views.md)
- [ADR-005 - Model Language Change Control](ADR-005-model-format-evolution-and-additive-compatibility.md)
- [ADR-006 - Product Model And Framework Contract Planes](ADR-006-product-model-and-framework-contract-planes.md)
- [ADR-007 - Guarantee Lifecycle Decision Anchoring](ADR-007-guarantee-lifecycle-decision-anchoring.md)
- [ADR-008 - Delivery Adapter Boundary And Context Pack](ADR-008-delivery-adapter-boundary-and-seed.md)
