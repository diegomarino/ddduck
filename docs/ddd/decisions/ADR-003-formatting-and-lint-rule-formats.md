---
id: ADR-003
title: Formatting And Lint Rule Formats
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
    - domain:tooling-runtime
    - domain:traceability
  guarantees: []
---

# ADR-003 - Formatting And Lint Rule Formats

## Context

ADR-002 selected the Node.js parsing and validation library stack. The project also needs a separate decision for formatting, linting, rule specifications, and the aggregate quality gate because those choices define authoring policy rather than parser/runtime capability.

ddduck needs low-noise formatting and linting that keeps canonical files reviewable in Git. It also needs a path for model and documentation policy rules to become canonical model data rather than hidden code.

## Decision

Use these tool formats and rule boundaries:

| Concern                | Decision                   | Role                                                        |
| ---------------------- | -------------------------- | ----------------------------------------------------------- |
| JavaScript linting     | ESLint flat config         | Lint Node.js tooling and host local custom rules when used. |
| Formatting             | Prettier                   | Enforce stable formatting for Markdown, YAML, JSON, and JS. |
| Markdown style linting | `markdownlint-cli2`        | Enforce low-noise Markdown rules for canonical docs.        |
| Code style config      | Tool-native config files   | Keep style configuration in conventional tool configs.      |
| Policy rule specs      | Strict YAML in `policies/` | Make durable model/documentation policy reviewable as data. |

Lint rule formats:

- **Code style rules** live in standard tool configuration files: `eslint.config.js`, `.prettierrc.json`, and `.markdownlint.json`.
- **Model/documentation policy rules** are represented as canonical YAML policy specifications once they become data-driven. Their location is `policies/`, outside imported evidence.
- **Executable rules** live in Node.js modules under `scripts/` or a future `src/` directory. Rule specs declare the executable check that enforces them, and code should not encode durable policy only in implementation when that policy is part of the framework language.
- **Generated lint outputs** should be JSON or JSONL artifacts under the generated output directory (`generated/` within the product root), not canonical source.

The initial repository-level quality gate is:

```bash
npm run check
```

This gate runs model validation, JavaScript linting, Markdown linting, formatting checks, and tests.

## Considered Options

1. **No formatter or linter yet** - Rejected. Canonical YAML, Markdown, and JavaScript are already part of the project surface, and early drift would make review harder.
2. **Prettier only** - Rejected. Prettier stabilizes format but does not catch JavaScript errors or Markdown policy concerns.
3. **ESLint, Prettier, and markdownlint with a single gate** - Accepted. This keeps checks familiar, explicit, and easy to run locally or in CI.
4. **Encode all policy in executable JavaScript** - Rejected for durable framework rules. Executable code is appropriate for enforcement, but canonical policy should become inspectable rule data when stable.
5. **Represent policy rule specs as strict YAML** - Accepted for data-driven rules because it matches ADR-001's canonical source format.

## Consequences

Prettier, ESLint, and markdownlint add early ceremony, but they prevent format drift while the canonical project structure is still small.

`npm run check` becomes the single local quality gate for canonical changes.

Policy rules live in `policies/` as strict YAML specifications, while executable tooling remains responsible for enforcement through declared rule implementations.

## Verification

The current gate is:

```bash
npm run check
```

The gate must pass before committing canonical model, decision, schema, checker, or documentation changes.

The checker must reject PolicySpecs that point to unknown executable checks.

## Links

- ESLint flat config: https://eslint.org/docs/latest/use/configure/configuration-files
- Prettier: https://prettier.io/
- markdownlint-cli2: https://github.com/DavidAnson/markdownlint-cli2
