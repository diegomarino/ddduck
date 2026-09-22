import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { installSkill, loadSkillBundle } from "../scripts/lib/skill-installer.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = path.join(root, "skills", "update-ddduck-specs", "SKILL.md");
const evidencePath = path.join(root, "test", "fixtures", "forward-test-evidence.md");
const skillBytes = readFileSync(skillPath);
const evidence = readFileSync(evidencePath, "utf8");
const skillSha256 = createHash("sha256").update(skillBytes).digest("hex");
const bundle = loadSkillBundle({ skillName: "update-ddduck-specs", skillPath });

test("forward-test evidence identifies installed bytes for Codex fallback and Claude-only repositories", () => {
  const codexRepository = mkdtempSync(path.join(tmpdir(), "ddduck-forward-test-codex-"));
  const codexResult = installSkill({
    repository: codexRepository,
    skillName: "update-ddduck-specs",
    skillPath,
    packageVersion: "test-version",
  });
  const claudeRepository = mkdtempSync(path.join(tmpdir(), "ddduck-forward-test-claude-"));
  mkdirSync(path.join(claudeRepository, ".claude"), { recursive: true });
  const claudeResult = installSkill({
    repository: claudeRepository,
    skillName: "update-ddduck-specs",
    skillPath,
    packageVersion: "test-version",
  });

  assert.equal(codexResult.skillSha256, skillSha256);
  assert.equal(claudeResult.skillSha256, skillSha256);
  assert.equal(codexResult.bundleSha256, bundle.bundleSha256);
  assert.equal(claudeResult.bundleSha256, bundle.bundleSha256);
  assert.deepEqual(
    readFileSync(path.join(codexRepository, ".agents", "skills", "update-ddduck-specs", "SKILL.md")),
    skillBytes,
  );
  assert.deepEqual(
    readFileSync(path.join(claudeRepository, ".claude", "skills", "update-ddduck-specs", "SKILL.md")),
    skillBytes,
  );
  for (const file of bundle.files.filter(({ path: relativePath }) => relativePath !== "SKILL.md")) {
    assert.deepEqual(
      readFileSync(path.join(codexRepository, ".agents", "skills", "update-ddduck-specs", file.path)),
      file.bytes,
    );
    assert.deepEqual(
      readFileSync(path.join(claudeRepository, ".claude", "skills", "update-ddduck-specs", file.path)),
      file.bytes,
    );
  }
  assert.match(evidence, new RegExp(`SHA-256: \`${skillSha256}\``));
  assert.match(evidence, new RegExp(`Bundle SHA-256: \`${bundle.bundleSha256}\``));
  assert.match(evidence, /Codex fallback canonical path: `\.agents\/skills\/update-ddduck-specs\/SKILL\.md`/);
  assert.match(evidence, /Claude-only canonical path: `\.claude\/skills\/update-ddduck-specs\/SKILL\.md`/);
  assert.match(evidence, /This is not a live Codex or Claude Code host execution\./);
  assert.match(evidence, /npm_config_cache=\/private\/tmp\/ddduck-npm-cache npm pack --dry-run/);
});

test("forward-test evidence covers the required static behavior expectations", () => {
  for (const requirement of [
    "Plan-only default",
    "No invented facts",
    "Read-only subagents",
    "Scope preservation",
    "Evidence coverage",
    "Exact report shape",
    "Invalid existing model",
    "Grounded greenfield bootstrap",
    "Explicit conflicts",
  ]) {
    assert.match(evidence, new RegExp(`\\| ${requirement}\\s+\\|`));
  }
});
