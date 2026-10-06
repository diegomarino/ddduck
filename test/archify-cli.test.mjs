import { URL } from "node:url";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("../scripts/ddduck.mjs", import.meta.url));
test("install accepts options before its Archify subject", () => {
  const result = spawnSync(process.execPath, [cli, "install", "--yes", "--version", "unsupported", "archify"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported integration version/);
});
test("optional Archify help works without installation or a valid config", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ddduck-archify-help-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(path.join(cwd, ".ddduck"));
  writeFileSync(path.join(cwd, ".ddduck/config.json"), "invalid");
  for (const args of [
    ["--help"],
    ["install", "archify", "--help"],
    ["export", "archify", "--help"],
    ["doctor", "archify", "--help"],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /archify/);
    assert.equal(result.stderr, "");
  }
  const version = spawnSync(process.execPath, [cli, "--version"], { cwd, encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);
});

test("missing Archify is diagnosed offline and export gives an install remedy without writes", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ddduck-archify-absent-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const doctor = spawnSync(process.execPath, [cli, "doctor", "archify", "--json"], { cwd, encoding: "utf8" });
  assert.equal(doctor.status, 1, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).status, "missing");
  const exported = spawnSync(process.execPath, [cli, "export", "archify"], { cwd, encoding: "utf8" });
  assert.equal(exported.status, 1);
  assert.match(exported.stderr, /ddduck install archify/);
  assert.equal(existsSync(path.join(cwd, ".ddduck")), false);
});
