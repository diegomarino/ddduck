import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = path.join(root, "skills", "update-ddduck-specs", "SKILL.md");
const skill = readFileSync(skillPath, "utf8");
const references = {
  modeling: path.join(root, "skills", "update-ddduck-specs", "references", "modeling-and-evidence.md"),
  reviewing: path.join(root, "skills", "update-ddduck-specs", "references", "reviewing-changes.md"),
  authoring: path.join(root, "skills", "update-ddduck-specs", "references", "authoring-and-verification.md"),
};
const modeling = readFileSync(references.modeling, "utf8");
const authoring = readFileSync(references.authoring, "utf8");

test("update-ddduck-specs has the canonical frontmatter", () => {
  assert.match(
    skill,
    /^---\nname: update-ddduck-specs\ndescription: Use when a repository's ddduck product model needs to be created, audited against current code, tests, and documentation, compared across revisions, or reconciled after product changes\.\n---\n/m,
  );
  assert.doesNotMatch(skill, /^---\n(?:.*\n)*?(?:version|metadata):/m);
});

test("update-ddduck-specs protects consumer work and defaults to planning", () => {
  for (const instruction of [
    "read every applicable instruction file, and inspect Git status before analysis",
    "Default to plan-only. Mutate model files only when the current request explicitly authorizes",
    "Preserve unrelated work. Stop when intended model edits overlap user changes inseparably",
    "Write only `<root>/product.yaml`, `<root>/model/**`, `<root>/decisions/**`, and regenerated `<root>/generated/**`",
    "Keep unresolved questions in prose",
    "Commit, push, consumer migration, and external effects require separate authorization",
  ]) {
    assert.ok(skill.includes(instruction), `missing instruction: ${instruction}`);
  }
});

test("update-ddduck-specs defines root classification and independent baseline checks", () => {
  for (const instruction of [
    "`existing`: `product.yaml` exists.",
    "`absent`: the root is missing or empty.",
    "`path-collision`: the path is non-empty but is not a recognizable product.",
    "A failing model remains existing and invalid.",
    "`ddduck query spec --root <root> --json`",
    "Run `query spec` and `check` independently",
  ]) {
    assert.ok(authoring.includes(instruction), `missing baseline instruction: ${instruction}`);
  }
});

test("update-ddduck-specs requires evidence discipline and exact classifications", () => {
  for (const instruction of [
    "the proposed assertion;",
    "repository-relative path plus line, symbol, heading, or test name;",
    "role: implementation, verification, documentation, decision, or configuration;",
    "contradictory evidence;",
    "inspected scope and remaining unknowns.",
    "Repository-wide evidence belongs in the plan and final report.",
    "verified omission;",
    "stale modeled fact;",
    "structural inconsistency with an unambiguous repair;",
    "contradiction or uncertainty requiring a human decision;",
    "irrelevant implementation detail;",
    "insufficiently covered.",
  ]) {
    assert.ok(modeling.includes(instruction), `missing evidence instruction: ${instruction}`);
  }
});

test("update-ddduck-specs defines plan and apply verification workflows", () => {
  assert.match(
    authoring,
    /1\. Mode, resolved root, and model state\.\n2\. Independent query and validation outcomes\.\n3\. Inspected coverage, exclusions, and gaps\.\n4\. Proposed changes with classification, evidence, affected IDs, and exact files\.\n5\. Contradictions, uncertainties, and required decisions\.\n6\. Exact authoring, generation, and verification commands\./,
  );
  assert.match(
    authoring,
    /ddduck check --root <root> --source-only[\s\S]*ddduck generate --root <root>[\s\S]*ddduck check --root <root>[\s\S]*ddduck query spec --root <root> --json/,
  );
  assert.ok(authoring.includes("Without explicit application authorization, stop here."));
  assert.ok(skill.includes("Any failed command makes the result `incomplete`."));
});

test("update-ddduck-specs routes conditional detail to bundled references", () => {
  for (const [name, referencePath] of Object.entries(references)) {
    assert.equal(existsSync(referencePath), true, `missing ${name} reference`);
  }
  assert.match(skill, /references\/modeling-and-evidence\.md/);
  assert.match(skill, /references\/reviewing-changes\.md/);
  assert.match(skill, /references\/authoring-and-verification\.md/);
});

test("update-ddduck-specs teaches the supported review and authoring commands", () => {
  assert.match(skill, /ddduck diff --base <before-root> --root <after-root> --json/);
  assert.match(skill, /ddduck create domain/);
  assert.match(skill, /ddduck create concept/);
  assert.match(skill, /ddduck create use-case/);
});
