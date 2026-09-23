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
  executable: path.join(root, "skills", "update-ddduck-specs", "references", "executable-resolution.md"),
};
const modeling = readFileSync(references.modeling, "utf8");
const authoring = readFileSync(references.authoring, "utf8");
const reviewing = readFileSync(references.reviewing, "utf8");
const executable = readFileSync(references.executable, "utf8");

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
    "These three states are observations; each requires an inspection that actually ran.",
    "the state is `undetermined`: the absence of an observation rather than a fourth thing observed",
    "never downgrade it to `absent`, because `absent` is the only state that authorizes initialization",
    "Stop before mutation when the executable is unresolved, missing, or incompatible, the model state is `undetermined`",
  ]) {
    assert.ok(authoring.includes(instruction), `missing baseline instruction: ${instruction}`);
  }
});

test("update-ddduck-specs gives an ordered executable probe instead of a bare prohibition", () => {
  assert.ok(
    skill.includes(
      "Resolve a repository-compatible ddduck executable with the probe order in [executable resolution](references/executable-resolution.md). Do not install dependencies or substitute an unrelated global version.",
    ),
  );
  assert.match(
    skill,
    /Before the first ddduck command, read \[executable resolution\]\(references\/executable-resolution\.md\)\./,
  );
  assert.match(
    executable,
    /1\. A command or path supplied in the current request\.\n2\. `node_modules\/\.bin\/ddduck` at the repository root, then at any enclosing workspace root\.\n3\. `node scripts\/ddduck\.mjs`[\s\S]*?when the repository under analysis is ddduck itself\.\n4\. `ddduck` on `PATH`\.\n5\. A ddduck source checkout[\s\S]*?`ddduckVersion` in `\.ddduck\/agent-skills\.lock\.json`\./,
  );
  for (const instruction of [
    "Take the first candidate that runs.",
    "The command prints `ddduck <version>`; read the resolved version from that output.",
    "Do not install dependencies and do not substitute an unrelated global version.",
  ]) {
    assert.ok(executable.includes(instruction), `missing probe instruction: ${instruction}`);
  }
  assert.doesNotMatch(executable, /no `--version`|`--version` does not exist|There is no `--version` flag/);
});

test("update-ddduck-specs confirms each candidate with its own command, not the PATH command", () => {
  for (const instruction of [
    "Confirm a candidate by appending `--version` to that candidate's own command, never by running a different one",
    "`node_modules/.bin/ddduck --version` for probe 2",
    "`node scripts/ddduck.mjs --version` for probe 3",
    "the bare `ddduck --version` only when `ddduck` on `PATH` is itself the candidate being probed",
    "A working repository-local candidate must not be rejected because `ddduck` is absent from `PATH`.",
  ]) {
    assert.ok(executable.includes(instruction), `missing candidate-probe instruction: ${instruction}`);
  }
  assert.doesNotMatch(executable, /Confirm a candidate with `ddduck --version`/);
});

test("update-ddduck-specs names every ddduck command as the resolved candidate", () => {
  assert.ok(
    executable.includes(
      "Every `ddduck <subcommand>` form written in this skill and its references names the resolved command, not the literal `ddduck` on `PATH`.",
    ),
  );
  assert.ok(
    executable.includes(
      "with probe 3 resolved, `ddduck check --root <root>` is run as `node scripts/ddduck.mjs check --root <root>`",
    ),
  );
  assert.ok(
    authoring.includes(
      "Every `ddduck …` command in this file names that resolved command; substitute it before running.",
    ),
  );
  assert.ok(
    reviewing.includes(
      "Every `ddduck …` command below names the command resolved by [executable resolution](executable-resolution.md); substitute it before running.",
    ),
  );
});

test("update-ddduck-specs forbids unbounded executable searches", () => {
  assert.ok(executable.includes("## Named paths only, never scan"));
  assert.ok(
    executable.includes(
      "Never search parent directories or the wider filesystem for a checkout. An unbounded search exhausts the available budget, times out, and still resolves nothing.",
    ),
  );
});

test("update-ddduck-specs treats an unresolved executable as undetermined, never absent", () => {
  for (const instruction of [
    "`existing`, `absent`, and `path-collision` are observations, and each one requires an inspection that actually ran.",
    "When no probe resolves, that inspection never ran and the model state is `undetermined`.",
    "Report `undetermined`, stop before any mutation, and never downgrade it to `absent`.",
    "initializing on an unverified `absent` bootstraps a second product root beside a healthy one",
    "A named `productRoot` in `.ddduck/config.json`, or an existing `product.yaml`, is evidence against `absent`",
  ]) {
    assert.ok(executable.includes(instruction), `missing undetermined instruction: ${instruction}`);
  }
  assert.ok(skill.includes("a root that was never inspected is `undetermined`, never absent"));
});

test("update-ddduck-specs offers remediation without installing anything", () => {
  for (const instruction of [
    "report every probe attempted and its outcome, then present these options and let the user choose",
    "- `npm i -g ddduck`",
    "- `npm i --save-dev ddduck`",
    "- `npx ddduck@<version>`, using the pinned version when the repository records one",
    "Present the options only. Do not install anything, and do not invoke an installer or `npx` on the user's behalf.",
  ]) {
    assert.ok(executable.includes(instruction), `missing remediation instruction: ${instruction}`);
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
  assert.match(skill, /references\/executable-resolution\.md/);
  assert.match(authoring, /\[executable resolution\]\(executable-resolution\.md\)/);
});

test("update-ddduck-specs teaches the supported review and authoring commands", () => {
  assert.match(skill, /ddduck diff --base <before-root> --root <after-root> --json/);
  assert.match(skill, /ddduck create domain/);
  assert.match(skill, /ddduck create concept/);
  assert.match(skill, /ddduck create use-case/);
});
