import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frameworkProductRoot = path.join(root, "docs", "ddd");
const checker = path.join(root, "scripts", "check-model.mjs");

test("canonical product validates", () => {
  const result = runChecker(frameworkProductRoot);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("canonical product check reports details with verbose output", () => {
  const result = runChecker(frameworkProductRoot, ["--verbose"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /nodes=47/);
  assert.match(result.stdout, /decisions=8/);
  assert.match(result.stdout, /policies=3/);
  assert.match(result.stdout, /ok/);
});

test("documentation reference validation can include repository-level Markdown", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "ddduck-docs-root-"));
  mkdirSync(path.join(repo, "docs"), { recursive: true });
  cpSync(frameworkProductRoot, path.join(repo, "docs", "ddd"), { recursive: true });
  writeFileSync(path.join(repo, "README.md"), "Missing reference: domain:not-real\n");

  const result = spawnSync(
    process.execPath,
    [
      checker,
      "--root",
      path.join(repo, "docs", "ddd"),
      "--docs-root",
      path.join(repo, "docs", "ddd"),
      "--docs-root",
      repo,
    ],
    { cwd: root, encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /README\.md: missing documentation reference domain:not-real/);
});

test("documentation reference scan skips dot-directories and default artifact dirs", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "ddduck-scan-ignore-"));
  mkdirSync(path.join(repo, "docs"), { recursive: true });
  cpSync(frameworkProductRoot, path.join(repo, "docs", "ddd"), { recursive: true });
  mkdirSync(path.join(repo, ".remember"), { recursive: true });
  writeFileSync(path.join(repo, ".remember", "now.md"), "Buffer mentions domain:not-real\n");
  mkdirSync(path.join(repo, "dist"), { recursive: true });
  writeFileSync(path.join(repo, "dist", "notes.md"), "Output mentions domain:not-real\n");

  const result = spawnSync(
    process.execPath,
    [
      checker,
      "--root",
      path.join(repo, "docs", "ddd"),
      "--docs-root",
      path.join(repo, "docs", "ddd"),
      "--docs-root",
      repo,
    ],
    { cwd: root, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("documentation reference scan honors a product ignore list that overrides defaults", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "ddduck-scan-ignore-override-"));
  mkdirSync(path.join(repo, ".git"), { recursive: true });
  cpSync(frameworkProductRoot, path.join(repo, "docs", "ddd"), { recursive: true });
  mkdirSync(path.join(repo, ".ddduck"), { recursive: true });
  writeFileSync(
    path.join(repo, ".ddduck", "config.json"),
    `${JSON.stringify({ schemaVersion: "1", productRoot: "docs/ddd", ignore: ["vendored-docs"] }, null, 2)}\n`,
  );
  mkdirSync(path.join(repo, "vendored-docs"), { recursive: true });
  writeFileSync(path.join(repo, "vendored-docs", "a.md"), "mentions domain:not-real\n");
  mkdirSync(path.join(repo, "dist"), { recursive: true });
  writeFileSync(path.join(repo, "dist", "b.md"), "mentions domain:not-real\n");

  const result = spawnSync(process.execPath, [checker, "--root", path.join(repo, "docs", "ddd"), "--docs-root", repo], {
    cwd: root,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /vendored-docs/);
  assert.match(result.stderr, /dist\/b\.md: missing documentation reference domain:not-real/);
});

function runChecker(checkRoot, extraArgs = []) {
  return spawnSync(process.execPath, [checker, "--root", checkRoot, ...extraArgs], {
    cwd: root,
    encoding: "utf8",
  });
}
