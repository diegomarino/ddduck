import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = path.join(root, "skills", "update-ddduck-specs", "SKILL.md");
const skill = readFileSync(skillPath, "utf8");

test("update-ddduck-specs has the canonical frontmatter", () => {
  assert.match(
    skill,
    /^---\nname: update-ddduck-specs\ndescription: Use when a repository's ddduck product model needs to be created, audited against current code, tests, and documentation, or reconciled after product changes\.\n---\n/m,
  );
  assert.doesNotMatch(skill, /^---\n(?:.*\n)*?(?:version|metadata):/m);
});

test("update-ddduck-specs protects consumer work and defaults to planning", () => {
  for (const instruction of [
    "read all applicable repository instructions, and inspect Git status before analysis",
    "Use an explicitly requested product root; otherwise let ddduck resolve it in its own order: the enclosing product root of the current directory, else the `productRoot` in `.ddduck/config.json`, else the unique discovered product root in the repository (the ddduck CLI reference documents the full order, including the example-candidate fallback).",
    "`ddduck query spec` reports the resolved root.",
    "Ambiguous resolution is a stop condition: report the candidates and ask; never bootstrap a second product root beside an existing one.",
    "Default to plan-only. Mutate files only when the current user request explicitly authorizes application",
    "Preserve unrelated and uncommitted work. Stop when intended target files overlap user changes inseparably",
    "Write only `<root>/product.yaml`, `<root>/model/**`, `<root>/decisions/**`, and regenerated `<root>/generated/**`",
    "Never edit generated views directly",
    "Use only evidence visible in the current working tree",
    "Preserve stable IDs and Guarantee lifecycle. Never silently delete or reuse a Guarantee ID.",
    "Use ddduck lifecycle commands where they cover the mutation.",
    "Never create an ADR merely to satisfy validation or justify an inferred change",
    "Keep unresolved questions out of canonical model facts",
    "Avoid ornamental DDD vocabulary and speculative structure",
    "Do not commit or push consumer changes unless the user separately requests it",
    "For a greenfield repository, use runtime-supported subagents only when no model exists and the relevant corpus spans several substantial, independent packages",
    "Subagents are read-only evidence adapters",
  ]) {
    assert.ok(skill.includes(instruction), `missing instruction: ${instruction}`);
  }
  assert.doesNotMatch(skill, /otherwise use `ddd\/`/);
});

test("update-ddduck-specs defines root classification and independent baseline checks", () => {
  for (const instruction of [
    "`existing`: `product.yaml` exists.",
    "`absent`: the root is missing or empty.",
    "`path-collision`: the root is non-empty but not a recognizable ddduck product.",
    "A failing existing model is invalid, not absent, and must not be reinitialized.",
    "`ddduck query spec --root <root> --json`",
    "`ddduck check --root <root>`",
    "recording both outcomes independently",
  ]) {
    assert.ok(skill.includes(instruction), `missing baseline instruction: ${instruction}`);
  }
});

test("update-ddduck-specs gives an executable probe order instead of a bare prohibition", () => {
  for (const instruction of [
    "Resolve the executable before the baseline. Probe in this order and take the first candidate that runs:",
    "a repository-local install: `node_modules/.bin/ddduck`",
    "the repository's own `package.json` `bin` target when the repository under analysis is ddduck itself, for example `node scripts/ddduck.mjs`",
    "`ddduck` on `PATH`;",
    "a ddduck source checkout whose path the user named or that the repository records, run through its `package.json` `bin` target, and only when its `version` matches the pinned `ddduckVersion`.",
    "Probe named paths; never scan for the executable.",
    "never walk a parent directory tree looking for a checkout — an unbounded search times out without finding anything.",
    "There is no `--version` flag; a failing `ddduck --version` does not mean the executable is absent or broken. Read the version from the candidate's `package.json` instead.",
    "Only an exhausted probe list establishes that no executable exists.",
    "`npm install -g ddduck` for a global CLI;",
    "`npm install --save-dev ddduck` to pin it in this repository;",
    "`npx ddduck@<version> <command>` for a one-off run, naming the version explicitly.",
    "Never install a package, add a dependency, or invoke `npx` on your own initiative",
    "Presenting the options is the deliverable; the user chooses.",
  ]) {
    assert.ok(skill.includes(instruction), `missing executable instruction: ${instruction}`);
  }
});

test("update-ddduck-specs separates unobserved state from observed absence", () => {
  for (const instruction of [
    "`undetermined`: the executable or the root could not be resolved, so the model state was never observed.",
    "Failing to look is `undetermined`, never `absent`.",
    "Never downgrade `undetermined` to `absent`, and never report an unobserved model state as fact.",
    "name the `productRoot` from `.ddduck/config.json` as an unverified candidate in the report and derive no model state from it.",
    "Item 1 reports the model state as `existing`, `absent`, `path-collision`, or `undetermined`, and names the resolved executable.",
    "it asserts nothing about the model.",
    "### Red flags",
    "`PATH` is the last probe, not the only one.",
    "Not observing a model is not observing its absence.",
    "`absent` authorizes initialization.",
  ]) {
    assert.ok(skill.includes(instruction), `missing undetermined instruction: ${instruction}`);
  }
});

test("update-ddduck-specs requires evidence discipline and exact classifications", () => {
  for (const instruction of [
    "proposed model assertion;",
    "repository-relative path plus line, symbol, heading, or test name;",
    "evidence role: implementation, verification, documentation, decision, or configuration;",
    "contradictory evidence;",
    "inspected scope and remaining unknowns.",
    "Cite repository-wide evidence in the plan and final report, but persist only schema-supported product-root anchors.",
    "verified omission;",
    "stale modeled fact;",
    "structural inconsistency with an unambiguous repair;",
    "contradiction or uncertainty requiring a human decision;",
    "irrelevant implementation detail;",
    "insufficiently covered.",
  ]) {
    assert.ok(skill.includes(instruction), `missing evidence instruction: ${instruction}`);
  }
});

test("update-ddduck-specs defines plan and apply verification workflows", () => {
  assert.match(
    skill,
    /1\. Mode, resolved root, and model state\.\n2\. Baseline query and validation status\.\n3\. Inspected coverage, exclusions, and gaps\.\n4\. Proposed changes with classification, concrete evidence, and exact target files\.\n5\. Contradictions, uncertainties, and required decisions\.\n6\. Exact generation and verification commands\./,
  );
  assert.match(
    skill,
    /6\. Run `ddduck check --root <root> --source-only` before generation; hand-authored canonical edits legitimately leave generated views stale until step 7\.\n7\. Run `ddduck generate --root <root>`\.\n8\. Run `ddduck check --root <root>` again\.\n9\. Run `ddduck query spec --root <root> --json` and require every generated view to be fresh\.\n10\. Inspect the final diff for scope\./,
  );
  assert.ok(skill.includes("Without explicit application authorization, stop before all writes."));
  assert.ok(skill.includes("Any command failure makes the result incomplete."));
});
