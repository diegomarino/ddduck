import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { shouldIgnoreScanEntry } from "../scripts/lib/scan-ignore.mjs";
import { findRepositoryRoot, resolveConfiguredIgnores } from "../scripts/lib/ddduck-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const retiredFormatLabel = new RegExp(String.raw`\bv[12](?:\b|[-/])`, "i");

test("repository contains no retired format labels", () => {
  assert.deepEqual(retiredFormatLabelsBelow(root), []);
});

test("retired-format scan excludes internal and historical material but detects reader-facing notes", () => {
  const fixture = path.join(root, "test", "fixtures", "legacy-format-labels");
  assert.deepEqual(retiredFormatLabelsBelow(fixture), ["notes.md"]);
});

function retiredFormatLabelsBelow(scanRoot) {
  const ignoredEntryNames = resolveConfiguredIgnores(findRepositoryRoot(scanRoot));
  const matches = [];
  for (const filePath of filesBelow(scanRoot, scanRoot, ignoredEntryNames)) {
    const relativePath = path.relative(scanRoot, filePath).split(path.sep).join("/");
    if (retiredFormatLabel.test(relativePath)) matches.push(relativePath);
    if (retiredFormatLabel.test(readFileSync(filePath, "utf8"))) matches.push(relativePath);
  }
  return matches;
}

function filesBelow(directory, scanRoot, ignoredEntryNames) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (shouldIgnoreScanEntry(entry.name, ignoredEntryNames)) continue;
    const entryPath = path.join(directory, entry.name);
    const relativePath = path.relative(scanRoot, entryPath).split(path.sep).join("/");
    if (entry.isDirectory() && !isIgnoredDirectory(relativePath, scanRoot))
      files.push(...filesBelow(entryPath, scanRoot, ignoredEntryNames));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files.sort();
}

function isIgnoredDirectory(relativePath, scanRoot) {
  return (
    (scanRoot === root && relativePath === "test/fixtures") ||
    relativePath === ".superpowers" ||
    relativePath === "docs/audits" ||
    relativePath === "docs/superpowers" ||
    relativePath.endsWith("/.superpowers") ||
    relativePath.endsWith("/docs/audits") ||
    relativePath.endsWith("/docs/superpowers")
  );
}
