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
    "Use an explicitly requested product root; otherwise let ddduck resolve it in its own order: the enclosing product root of the current directory, else the `productRoot` in `.ddduck/config.json`, else the unique discovered product root in the repository.",
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
