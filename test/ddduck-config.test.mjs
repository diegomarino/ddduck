import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultConfigIgnore, loadDdduckConfig, resolveConfiguredIgnores } from "../scripts/lib/ddduck-config.mjs";

function makeRepo() {
  const repo = mkdtempSync(path.join(tmpdir(), "ddduck-config-"));
  mkdirSync(path.join(repo, ".git"), { recursive: true });
  return repo;
}

function writeConfig(repo, value) {
  mkdirSync(path.join(repo, ".ddduck"), { recursive: true });
  writeFileSync(path.join(repo, ".ddduck", "config.json"), `${JSON.stringify(value, null, 2)}\n`);
}

test("resolveConfiguredIgnores returns defaults when config is absent", () => {
  assert.deepEqual(resolveConfiguredIgnores(makeRepo()), [...defaultConfigIgnore]);
});

test("resolveConfiguredIgnores returns defaults when the ignore key is absent", () => {
  const repo = makeRepo();
  writeConfig(repo, { schemaVersion: "1", productRoot: "docs/ddd" });
  assert.deepEqual(resolveConfiguredIgnores(repo), [...defaultConfigIgnore]);
});

test("resolveConfiguredIgnores returns the declared list verbatim, including empty", () => {
  const repo = makeRepo();
  writeConfig(repo, { schemaVersion: "1", productRoot: "docs/ddd", ignore: ["custom"] });
  assert.deepEqual(resolveConfiguredIgnores(repo), ["custom"]);
  writeConfig(repo, { schemaVersion: "1", productRoot: "docs/ddd", ignore: [] });
  assert.deepEqual(resolveConfiguredIgnores(repo), []);
});

test("loadDdduckConfig rejects a non-array ignore", () => {
  const repo = makeRepo();
  writeConfig(repo, { schemaVersion: "1", productRoot: "docs/ddd", ignore: "vendor" });
  assert.throws(() => loadDdduckConfig(repo), /ignore must be an array/);
});

test("loadDdduckConfig rejects ignore entries with path separators", () => {
  const repo = makeRepo();
  writeConfig(repo, { schemaVersion: "1", productRoot: "docs/ddd", ignore: ["a/b"] });
  assert.throws(() => loadDdduckConfig(repo), /plain directory names/);
});

test("loadDdduckConfig rejects empty ignore entries", () => {
  const repo = makeRepo();
  writeConfig(repo, { schemaVersion: "1", productRoot: "docs/ddd", ignore: [""] });
  assert.throws(() => loadDdduckConfig(repo), /non-empty/);
});

test("loadDdduckConfig rejects ignore entries equal to .", () => {
  const repo = makeRepo();
  writeConfig(repo, { schemaVersion: "1", productRoot: "docs/ddd", ignore: ["."] });
  assert.throws(() => loadDdduckConfig(repo), /plain directory names/);
});

test("loadDdduckConfig rejects ignore entries equal to ..", () => {
  const repo = makeRepo();
  writeConfig(repo, { schemaVersion: "1", productRoot: "docs/ddd", ignore: [".."] });
  assert.throws(() => loadDdduckConfig(repo), /plain directory names/);
});

test("loadDdduckConfig rejects ignore entries containing backslash", () => {
  const repo = makeRepo();
  writeConfig(repo, { schemaVersion: "1", productRoot: "docs/ddd", ignore: ["a\\b"] });
  assert.throws(() => loadDdduckConfig(repo), /plain directory names/);
});
