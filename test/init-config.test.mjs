import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "scripts", "ddduck.mjs");

test("init pre-fills .ddduck/config.json with ignore defaults when absent", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "ddduck-init-config-"));
  mkdirSync(path.join(repo, ".git"), { recursive: true });

  const result = spawnSync(process.execPath, [cli, "init", "ddd", "--id", "model:sample"], {
    cwd: repo,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(readFileSync(path.join(repo, ".ddduck", "config.json"), "utf8"));
  assert.deepEqual(config, {
    schemaVersion: "1",
    productRoot: "ddd",
    ignore: ["vendor", "target", "build", "dist", "__pycache__"],
  });
});

test("init does not clobber an existing .ddduck/config.json", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "ddduck-init-config-keep-"));
  mkdirSync(path.join(repo, ".git"), { recursive: true });
  mkdirSync(path.join(repo, ".ddduck"), { recursive: true });
  const existing = `${JSON.stringify({ schemaVersion: "1", productRoot: "ddd", ignore: [] }, null, 2)}\n`;
  writeFileSync(path.join(repo, ".ddduck", "config.json"), existing);

  const result = spawnSync(process.execPath, [cli, "init", "ddd", "--id", "model:sample"], {
    cwd: repo,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(path.join(repo, ".ddduck", "config.json"), "utf8"), existing);
});

test("init rolls back the published product when the config write fails so a retry is not blocked", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "ddduck-init-config-fail-"));
  mkdirSync(path.join(repo, ".git"), { recursive: true });
  // A regular file where the .ddduck config directory belongs makes the config
  // write fail after the product tree would otherwise be published.
  writeFileSync(path.join(repo, ".ddduck"), "not a directory\n");

  const result = spawnSync(process.execPath, [cli, "init", "ddd", "--id", "model:sample"], {
    cwd: repo,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0, "init must fail when it cannot write the config");
  assert.equal(
    existsSync(path.join(repo, "ddd")),
    false,
    "the published product directory must be rolled back so a corrected retry is not refused",
  );
});
