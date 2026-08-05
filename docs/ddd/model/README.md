# Model

This directory contains the canonical ddduck product model.

`ddduck` is the stable model name, recorded as `nameStatus: stable` in `../product.yaml`. The model ID is now fixed; any future rename would go through a tracked decision or model update.

## Layout

- `../product.yaml` - the model root.
- `domains/` - ownership boundaries inside a model.
- `concepts/` - named concepts owned by domains.
- `relationships/` - typed edges between model nodes.
- `../../../examples/` - validated example models that illustrate the format without defining framework policy.

The root `product.yaml`, node directories under `model/`, decisions, and derived output form the
canonical layout. See `../../../examples/reminders/ddd/` for a validated example.

## Validation

Run the model checker from the repository root:

```bash
npm run check:model
```

The checker loads the canonical YAML graph, rejects disallowed YAML features, verifies unique node IDs, validates node schemas, and resolves model, domain, concept, relationship, rule, and ADR references.
