import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const bytes = Buffer.from("qualified runtime\n");
const pin = {
  integrationVersion: "test",
  commit: "test",
  files: { "template.html": createHash("sha256").update(bytes).digest("hex") },
};

test("installer preserves a destination that appears while files are downloading", async (t) => {
  const { installRuntime } = await import("../scripts/lib/archify-install.mjs");
  const repo = mkdtempSync(path.join(tmpdir(), "ddduck-archify-race-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const destination = path.join(repo, ".ddduck/tools/archify");
  await assert.rejects(
    installRuntime(repo, pin, async () => {
      mkdirSync(destination);
      writeFileSync(path.join(destination, "keep.txt"), "keep");
      return bytes;
    }),
    /destination changed/i,
  );
  assert.equal(readFileSync(path.join(destination, "keep.txt"), "utf8"), "keep");
});

test("interrupted installation lock reports its owner and recovery guidance", async (t) => {
  const { installRuntime } = await import("../scripts/lib/archify-install.mjs");
  const repo = mkdtempSync(path.join(tmpdir(), "ddduck-archify-lock-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(path.join(repo, ".ddduck/tools"), { recursive: true });
  writeFileSync(path.join(repo, ".ddduck/tools/.archify-install.lock"), "2147483647");
  await assert.rejects(
    installRuntime(repo, pin, async () => bytes),
    (error) => {
      assert.match(error.message, /2147483647/);
      assert.match(error.nextAction, /exited.*remove only/i);
      return true;
    },
  );
});

test("installer reuses verified files offline and a failed repair preserves the prior installation", async (t) => {
  const { installRuntime, inspectRuntime } = await import("../scripts/lib/archify-install.mjs");
  const repo = mkdtempSync(path.join(tmpdir(), "ddduck-archify-install-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  await installRuntime(repo, pin, async () => bytes);
  const installed = inspectRuntime(repo, pin);
  assert.equal(installed.status, "ready");
  assert.equal(readFileSync(path.join(installed.runtime, "template.html"), "utf8"), "qualified runtime\n");
  await installRuntime(repo, pin, async () => {
    throw new Error("offline");
  });
  writeFileSync(path.join(installed.runtime, "template.html"), "corrupt");
  assert.equal(inspectRuntime(repo, pin).status, "corrupt");
  await assert.rejects(
    installRuntime(repo, pin, async () => Buffer.from("wrong")),
    /integrity/i,
  );
  assert.equal(readFileSync(path.join(installed.runtime, "template.html"), "utf8"), "corrupt");
  await installRuntime(repo, pin, async () => bytes);
  assert.equal(inspectRuntime(repo, pin).status, "ready");
});

test("installer refuses unrelated existing directories", async (t) => {
  const { installRuntime } = await import("../scripts/lib/archify-install.mjs");
  const { mkdirSync } = await import("node:fs");
  const repo = mkdtempSync(path.join(tmpdir(), "ddduck-archify-unowned-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const runtime = path.join(repo, ".ddduck/tools/archify/runtime");
  mkdirSync(runtime, { recursive: true });
  writeFileSync(path.join(runtime, "keep.txt"), "keep");
  await assert.rejects(
    installRuntime(repo, pin, async () => bytes),
    /unmanaged/i,
  );
  assert.equal(existsSync(path.join(runtime, "keep.txt")), true);
});
