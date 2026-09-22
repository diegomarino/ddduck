import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createChangeReviewFixture } from "./helpers/change-review-fixture.mjs";

const cli = fileURLToPath(new URL("../scripts/ddduck.mjs", import.meta.url));

function run(args, cwd) {
  return spawnSync(process.execPath, [cli, "diff", ...args], { encoding: "utf8", cwd });
}

function bytes(root) {
  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [path.relative(root, file), readFileSync(file).toString("base64")];
      }),
  );
}

test("diff CLI emits one JSON report, resolves an enclosing root and never writes", (context) => {
  const { beforeRoot, afterRoot } = createChangeReviewFixture(context);
  const beforeBytes = bytes(beforeRoot);
  const afterBytes = bytes(afterRoot);
  const result = run(["--base", beforeRoot, "--json"], afterRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.kind, "ModelDiff");
  assert.ok(report.changed.some(({ id }) => id === "MEMBERS-AC-05"));
  assert.equal(report.removed.length, 0);
  assert.deepEqual(bytes(beforeRoot), beforeBytes);
  assert.deepEqual(bytes(afterRoot), afterBytes);
  const text = run(["--base", beforeRoot, "--root", afterRoot]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Changed MEMBERS-AC-05/);
  assert.match(text.stdout, /human interpretation/);
});

test("diff CLI rejects missing, duplicate and unknown options with no success output", () => {
  for (const args of [[], ["--base"], ["--base", ".", "--base", "."], ["--wrong", "."]]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Next:/);
  }
});

test("diff CLI preserves busy and interrupted roots and emits actionable diagnostics", (context) => {
  const { beforeRoot, afterRoot } = createChangeReviewFixture(context);
  const lock = path.join(beforeRoot, ".ddduck-operation.lock");
  writeFileSync(lock, String(process.pid));
  const held = bytes(beforeRoot);
  const busy = run(["--base", beforeRoot, "--root", afterRoot, "--json"]);
  assert.equal(busy.status, 2, busy.stderr);
  assert.equal(busy.stdout, "");
  assert.deepEqual(bytes(beforeRoot), held);
  writeFileSync(lock, "interrupted");
  const interrupted = bytes(beforeRoot);
  const result = run(["--base", beforeRoot, "--root", afterRoot, "--json"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ddduck generate --root/);
  assert.equal(result.stdout, "");
  assert.deepEqual(bytes(beforeRoot), interrupted);
});
