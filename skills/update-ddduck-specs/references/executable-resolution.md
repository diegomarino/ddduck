# Executable resolution

Read this reference before running any ddduck command. Root classification, baselines, and verification results are only as trustworthy as the executable that produced them, so resolving one is a precondition for the workflow rather than a step inside it.

## Probe in order

Take the first candidate that runs. Confirm a candidate with `ddduck --version`, which prints `ddduck <version>`, and read the resolved version from that output.

1. A command or path supplied in the current request.
2. `node_modules/.bin/ddduck` at the repository root, then at any enclosing workspace root.
3. `node scripts/ddduck.mjs`, the repository's own `package.json` `bin` target, when the repository under analysis is ddduck itself.
4. `ddduck` on `PATH`.
5. A ddduck source checkout that the user named or that the repository records, only when its reported version matches the version the repository pins: a `ddduck` dependency in `package.json`, or `ddduckVersion` in `.ddduck/agent-skills.lock.json`.

Do not install dependencies and do not substitute an unrelated global version. A candidate that fails to run, or that reports a version incompatible with the pinned one, is not a resolution; continue with the next probe.

Record which probe resolved, the exact command, and its reported version. Reuse that one command for every subsequent ddduck invocation.

## Named paths only, never scan

Probe only the paths listed above plus the paths the request or the repository explicitly names. Never search parent directories or the wider filesystem for a checkout. An unbounded search exhausts the available budget, times out, and still resolves nothing.

## An unresolved executable is `undetermined`

`existing`, `absent`, and `path-collision` are observations, and each one requires an inspection that actually ran. When no probe resolves, that inspection never ran and the model state is `undetermined`.

Report `undetermined`, stop before any mutation, and never downgrade it to `absent`. Only `absent` authorizes initialization, and initializing on an unverified `absent` bootstraps a second product root beside a healthy one. A named `productRoot` in `.ddduck/config.json`, or an existing `product.yaml`, is evidence against `absent` even while the executable remains unresolved.

## Remediation

When no probe resolves, report every probe attempted and its outcome, then present these options and let the user choose:

- `npm i -g ddduck`
- `npm i --save-dev ddduck`
- `npx ddduck@<version>`, using the pinned version when the repository records one

Present the options only. Do not install anything, and do not invoke an installer or `npx` on the user's behalf.
