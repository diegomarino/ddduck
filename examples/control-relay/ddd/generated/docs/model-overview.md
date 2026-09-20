<!-- GENERATED FILE: do not edit by hand. Regenerate by running ddduck generate --root ../.. from this file's directory. -->

# Relay learning example (`model:relay-learning`)

Define a confirmed directive relay without claiming enactment.

## Domains

### Relay (`domain:relay`)

Bound confirmed delivery and report what is known about its result.

#### Concepts

- `concept:directive` - Directive
- `concept:recipient` - Recipient

#### Interfaces

- None.

#### Active guarantees

- `RELAY-AC-01` - A completed relay interaction reports delivered only with delivery acknowledgement, refused when no attempt was permitted, or unknown when the attempted delivery has no conclusive result; it never reports enactment from delivery alone.
- `RELAY-INV-01` - The relay attempts delivery at most once per confirmation, only when the operator confirmed the exact content and uniquely resolved recipient; missing confirmation or an ambiguous recipient causes refusal without sending.
- `RELAY-INV-02` - Relaying a directive neither enacts it nor changes the recipient's work state.

## Use Cases

### Relay a directive (`use-case:relay-directive`)

Let an operator request bounded delivery and learn its known result, including refusal or uncertainty.

- Requires: none
- Preserves: `RELAY-INV-01`, `RELAY-INV-02`
- Establishes: `RELAY-AC-01`
- Interfaces: none

## Interfaces

## Relationships

- `rel:directive-targets-recipient`: `concept:directive` -> `concept:recipient` (`targets`) - A directive names the recipient whose resolved identity the operator confirms.

## Decisions
