import assert from "node:assert/strict";
import test from "node:test";
import { defaultIgnoredEntryNames, shouldIgnoreScanEntry } from "../scripts/lib/scan-ignore.mjs";

test("ignores dot-directories and node_modules by default", () => {
  for (const name of [".remember", ".worktrees", ".git", ".superpowers", "node_modules"]) {
    assert.equal(shouldIgnoreScanEntry(name), true, name);
  }
});

test("does not ignore ordinary product directories", () => {
  for (const name of ["docs", "model", "domains", "vendor"]) {
    assert.equal(shouldIgnoreScanEntry(name), false, name);
  }
});

test("honors caller-supplied extra ignore names", () => {
  assert.equal(shouldIgnoreScanEntry("vendor", ["vendor"]), true);
  assert.equal(shouldIgnoreScanEntry("dist", ["vendor"]), false);
});

test("default ignore names are exactly the non-dotdir universals", () => {
  assert.deepEqual([...defaultIgnoredEntryNames], ["node_modules"]);
});
