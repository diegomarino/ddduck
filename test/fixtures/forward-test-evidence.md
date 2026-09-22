# Update ddduck Specs Forward-Test Evidence

**Date:** 2026-09-20
**Verification kind:** Static/local package and adapter verification. This is not a live Codex or Claude Code host execution.

## Tested skill bytes

- Packaged source: `skills/update-ddduck-specs/SKILL.md`
- SHA-256: `b3a5f94be48dc256ab64a11120427efa81a95221984dfac01f919eb15ba95182`
- Bundle SHA-256: `b8acf4321df31cbea06a3d18152331dee997a2628296740b1eb46e76e96d702a`
- Codex fallback canonical path: `.agents/skills/update-ddduck-specs/SKILL.md`
- Claude-only canonical path: `.claude/skills/update-ddduck-specs/SKILL.md`

The local installer fixture verifies two host-topology cases. A repository with no existing host directories uses the Codex fallback path and does not create `.claude/`. A repository with `.claude/` and no `.agents/` installs directly into the Claude Code path and does not create `.agents/`. Each installed skill bundle must equal the packaged source bytes. The installer lock records the entrypoint digest, bundle digest, file manifest, and selected canonical path.

## Static forward-test checklist

The following cases are checked against the packaged skill-bundle contract. They are behavior expectations for every installed host topology because each topology installs the same packaged bytes; they do not prove either host executed the skill in this worktree.

| Case                          | Expected behavior                                                                                                                          | Static/local evidence                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Plan-only default             | No mutation occurs without explicit apply authorization.                                                                                   | The canonical skill states the plan-only default and stops before all writes.                    |
| No invented facts             | Model claims come only from visible working-tree evidence.                                                                                 | The canonical skill requires concrete evidence, contradictions, exclusions, and unknowns.        |
| Read-only subagents           | Greenfield subagents collect scoped evidence only; the coordinator is the sole writer.                                                     | The canonical skill forbids subagent writes and canonical model synthesis.                       |
| Scope preservation            | Unrelated work is preserved and writes remain inside the selected product root.                                                            | The canonical skill limits writable paths and stops on inseparable overlap.                      |
| Evidence coverage             | Each candidate fact carries location, role, contradictions, inspected scope, and remaining unknowns.                                       | The canonical skill lists all required evidence fields.                                          |
| Exact report shape            | Plan results use the six ordered sections before mutation; apply results also disclose commands, freshness, gaps, and incomplete outcomes. | The canonical skill defines the ordered plan report and apply report fields.                     |
| Invalid existing model        | A failed existing baseline remains invalid and is never reinitialized.                                                                     | The canonical skill classifies `product.yaml` roots as `existing` even when validation fails.    |
| Grounded greenfield bootstrap | Initialization waits for grounded product identity, purpose, and initial domain seams.                                                     | The canonical skill stops before mutation when those bootstrap facts are not grounded.           |
| Explicit conflicts            | Conflicting intent and implementation remain an inconsistency, not a guessed model fact.                                                   | The canonical skill requires contradictory evidence and a human decision for material conflicts. |

## Reproduction

Run the focused fixture and final repository gates from the package root:

```bash
node --test test/forward-test-evidence.test.mjs
npm_config_cache=/private/tmp/ddduck-npm-cache npm pack --dry-run
npm run check
```

The fixture verifies both digests, the complete source-to-Codex-fallback and source-to-Claude-only bundle equality, and the static contract evidence described above. Live Codex and Claude Code invocation remains unverified in this worktree.
