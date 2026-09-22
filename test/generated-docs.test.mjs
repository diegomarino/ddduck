import assert from "node:assert/strict";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { checkGeneratedDocs as checkGeneratedDocsInProcess } from "../scripts/check-generated-docs.mjs";
import { buildModelOverview } from "../scripts/generate-docs.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frameworkProductRoot = path.join(root, "docs", "ddd");
const generateDocs = path.join(root, "scripts", "generate-docs.mjs");
const checkGeneratedDocs = path.join(root, "scripts", "check-generated-docs.mjs");

test("a model without decisions generates exactly one terminal newline", () => {
  const overview = buildModelOverview(path.join(root, "examples/control-relay/ddd"));
  assert.match(overview, /## Decisions\n$/);
  assert.equal(overview.endsWith("\n\n"), false);
});

test("generated overview includes model identity, domains, relationships, and decisions", () => {
  const fixtureRoot = copyDocumentationFixture();

  const result = runNode(generateDocs, fixtureRoot);

  assert.equal(result.status, 0, result.stderr);
  const overview = readFileSync(path.join(fixtureRoot, "generated", "docs", "model-overview.md"), "utf8");
  assert.match(
    overview,
    /<!-- GENERATED FILE: do not edit by hand\. Regenerate by running ddduck generate --root \.\.\/\.\. from this file's directory\. -->/,
  );
  assert.match(overview, /# ddduck \(`model:ddduck`\)/);
  assert.match(overview, /Name status: `stable`/);
  assert.match(overview, /## Domains/);
  assert.match(overview, /### Metamodel \(`domain:metamodel`\)/);
  assert.match(overview, /- `concept:model` - Model/);
  assert.match(overview, /## Relationships/);
  assert.match(overview, /`rel:traceability-metamodel`/);
  assert.match(overview, /## Decisions/);
  assert.match(overview, /- `ADR-001`/);
});

test("generated overview omits the name-status line when nameStatus is not declared", () => {
  const fixtureRoot = copyDocumentationFixture();
  const productPath = path.join(fixtureRoot, "product.yaml");
  writeFileSync(
    productPath,
    readFileSync(productPath, "utf8")
      .split("\n")
      .filter((line) => !line.startsWith("nameStatus:"))
      .join("\n"),
  );

  const result = runNode(generateDocs, fixtureRoot);

  assert.equal(result.status, 0, result.stderr);
  const overview = readFileSync(path.join(fixtureRoot, "generated", "docs", "model-overview.md"), "utf8");
  assert.match(overview, /# ddduck \(`model:ddduck`\)/);
  assert.doesNotMatch(overview, /Name status:/);
});

test("generated overview freshness check fails when file is missing", () => {
  const fixtureRoot = copyDocumentationFixture();
  rmSync(path.join(fixtureRoot, "generated"), { recursive: true, force: true });

  const result = runNode(checkGeneratedDocs, fixtureRoot);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /generated\/docs\/model-overview\.md is missing or stale/);
  assert.match(result.stderr, /run ddduck generate --root /);
  assert.doesNotMatch(result.stderr, /npm run/);
});

test("generated overview freshness check fails when file is stale", () => {
  const fixtureRoot = copyDocumentationFixture();
  const generateResult = runNode(generateDocs, fixtureRoot);
  assert.equal(generateResult.status, 0, generateResult.stderr);
  writeFileSync(path.join(fixtureRoot, "generated", "docs", "model-overview.md"), "stale\n");

  const result = runNode(checkGeneratedDocs, fixtureRoot);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /generated\/docs\/model-overview\.md is missing or stale/);
});

test("generated overview freshness check is callable with an explicit root", () => {
  const fixtureRoot = copyDocumentationFixture();
  writeFileSync(path.join(fixtureRoot, "generated", "docs", "model-overview.md"), "stale\n");

  assert.throws(
    () => checkGeneratedDocsInProcess(fixtureRoot),
    /generated\/docs\/model-overview\.md is missing or stale/,
  );
});

test("generated overview freshness check passes after generation", () => {
  const fixtureRoot = copyDocumentationFixture();
  const generateResult = runNode(generateDocs, fixtureRoot);
  assert.equal(generateResult.status, 0, generateResult.stderr);

  const result = runNode(checkGeneratedDocs, fixtureRoot);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("generated overview freshness check reports details with verbose output", () => {
  const fixtureRoot = copyDocumentationFixture();
  const generateResult = runNode(generateDocs, fixtureRoot);
  assert.equal(generateResult.status, 0, generateResult.stderr);

  const result = runNode(checkGeneratedDocs, fixtureRoot, ["--verbose"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /generated docs ok/);
});

test("generated overview generation reports details with verbose output", () => {
  const fixtureRoot = copyDocumentationFixture();

  const result = runNode(generateDocs, fixtureRoot, ["--verbose"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /wrote generated\/docs\/model-overview\.md/);
});

test("generated overview refuses a generated directory symlink without writing outside the product", () => {
  const fixtureRoot = copyDocumentationFixture();
  const externalDirectory = mkdtempSync(path.join(tmpdir(), "ddduck-generated-docs-external-"));
  rmSync(path.join(fixtureRoot, "generated"), { recursive: true, force: true });
  symlinkSync(externalDirectory, path.join(fixtureRoot, "generated"));

  const result = runNode(generateDocs, fixtureRoot);

  assert.notEqual(result.status, 0, result.stdout);
  assert.equal(existsSync(path.join(externalDirectory, "docs", "model-overview.md")), false);
});

test("generated overview refuses a dangling output-file symlink without writing outside the product", () => {
  const fixtureRoot = copyDocumentationFixture();
  const externalDirectory = mkdtempSync(path.join(tmpdir(), "ddduck-generated-docs-dangling-"));
  const escapedOutput = path.join(externalDirectory, "model-overview.md");
  const outputPath = path.join(fixtureRoot, "generated", "docs", "model-overview.md");
  rmSync(outputPath);
  symlinkSync(escapedOutput, outputPath);

  const result = runNode(generateDocs, fixtureRoot);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /output path must not target a symbolic link/);
  assert.equal(existsSync(escapedOutput), false);
});

function runNode(scriptPath, fixtureRoot, extraArgs = []) {
  return spawnSync(process.execPath, [scriptPath, "--root", fixtureRoot, ...extraArgs], {
    cwd: root,
    encoding: "utf8",
  });
}

function copyDocumentationFixture() {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "ddduck-generated-docs-"));
  copyFileSync(path.join(frameworkProductRoot, "product.yaml"), path.join(fixtureRoot, "product.yaml"));
  cpSync(path.join(frameworkProductRoot, "model"), path.join(fixtureRoot, "model"), { recursive: true });
  cpSync(path.join(frameworkProductRoot, "decisions"), path.join(fixtureRoot, "decisions"), { recursive: true });
  cpSync(path.join(root, "policies"), path.join(fixtureRoot, "policies"), { recursive: true });
  cpSync(path.join(root, "examples"), path.join(fixtureRoot, "examples"), { recursive: true });
  if (existsSync(path.join(frameworkProductRoot, "generated"))) {
    cpSync(path.join(frameworkProductRoot, "generated"), path.join(fixtureRoot, "generated"), { recursive: true });
  }
  return fixtureRoot;
}
