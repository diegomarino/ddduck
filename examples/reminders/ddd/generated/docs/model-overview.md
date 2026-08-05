<!-- GENERATED FILE: do not edit by hand. Regenerate by running ddduck generate --root ../.. from this file's directory. -->

# Members and Reminders (`model:members-reminders`)

Name status: `stable`

Define member lifecycle and reminder creation contracts.

## Domains

### Members (`domain:members`)

Own the lifecycle and ordinary visibility of members.

#### Concepts

- `concept:member` - Member

#### Interfaces

- None.

#### Active guarantees

- `MEMBERS-INV-01` - An archived member is invisible and inassignable in ordinary flows.

### Reminders (`domain:reminders`)

Create reminders for members who remain available in ordinary flows.

#### Concepts

- `concept:reminder` - Reminder

#### Interfaces

- `interface:create-reminder` - Create reminder

#### Active guarantees

- `REMINDERS-AC-01` - Creating a valid reminder makes it available to its assigned member.
- `REMINDERS-INV-01` - A reminder can be assigned only to a member available in ordinary flows.

## Use Cases

### Create reminder (`use-case:create-reminder`)

Create a reminder for a member who is available in ordinary flows.

- Requires: `MEMBERS-INV-01`
- Preserves: `MEMBERS-INV-01`, `REMINDERS-INV-01`
- Establishes: `REMINDERS-AC-01`
- Interfaces: `interface:create-reminder`

## Interfaces

### Create reminder (`interface:create-reminder`)

Operation kind: `command`

- Guarantees: `REMINDERS-INV-01`

## Relationships

- `rel:reminder-assigned-to-member`: `concept:reminder` -> `concept:member` (`assigns`) - A reminder designates a member.

## Decisions

- `ADR-001`
- `ADR-002`
