<!-- GENERATED FILE: do not edit by hand. Regenerate by running ddduck generate --root ../.. from this file's directory. -->

# Polymorphic references (`model:polymorphic-references`)

Show how one field that can point to different kinds of concept is modeled with existing node kinds.

## Domains

### Contacts (`domain:contacts`)

Own the people and organizations other domains refer to.

#### Concepts

- `concept:organization` - Organization
- `concept:person` - Person

#### Interfaces

- None.

#### Active guarantees

- None.

### Deals (`domain:deals`)

Own deals and the parties taking part in them.

#### Concepts

- `concept:deal` - Deal
- `concept:party` - Party

#### Interfaces

- None.

#### Active guarantees

- `DEALS-INV-01` - A party references exactly one of a person or an organization, never both and never neither.

### Notes (`domain:notes`)

Own free-form notes and what each note is about.

#### Concepts

- `concept:note` - Note

#### Interfaces

- None.

#### Active guarantees

- `NOTES-INV-01` - A note may be about any number of people, organizations, and deals, in any mix; each subject it lists resolves to an existing record.

## Use Cases

### Add a party to a deal (`use-case:add-deal-party`)

Let a seller add a person or an organization as a party to a deal.

- Requires: none
- Preserves: `DEALS-INV-01`
- Establishes: none
- Interfaces: none

## Interfaces

## Relationships

- `rel:note-about-deal`: `concept:note` -> `concept:deal` (`about`) - A note about a deal. Guarantees: `NOTES-INV-01`.
- `rel:note-about-organization`: `concept:note` -> `concept:organization` (`about`) - A note about an organization. Guarantees: `NOTES-INV-01`.
- `rel:note-about-person`: `concept:note` -> `concept:person` (`about`) - A note about a person. Guarantees: `NOTES-INV-01`.
- `rel:party-is-organization`: `concept:party` -> `concept:organization` (`references`) - A party that is an organization. Guarantees: `DEALS-INV-01`.
- `rel:party-is-person`: `concept:party` -> `concept:person` (`references`) - A party that is a person. Guarantees: `DEALS-INV-01`.

## Decisions
