import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateProduct } from "../scripts/check-model.mjs";
import { detectProductLayout, loadProductNodes } from "../scripts/lib/product-layout.mjs";

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exampleRoot = path.join(frameworkRoot, "examples/control-relay/ddd");
const cli = path.join(frameworkRoot, "scripts/ddduck.mjs");

test("relay teaching model accepts no interfaces and references only its active obligations", () => {
  assert.deepEqual(validateProduct(exampleRoot, { includeDocumentation: false }).errors, []);
  const { nodes } = loadProductNodes(detectProductLayout(exampleRoot));
  assert.equal(
    [...nodes.values()].some(({ kind }) => kind === "DomainInterface"),
    false,
  );
  const useCase = nodes.get("use-case:relay-directive");
  assert.deepEqual(useCase.preconditions.requires, []);
  assert.deepEqual(useCase.interfaces ?? [], []);
  const references = [...useCase.success.preserves, ...useCase.success.establishes];
  assert.deepEqual(references, ["RELAY-INV-01", "RELAY-INV-02", "RELAY-AC-01"]);
  for (const id of references) {
    assert.equal(nodes.get(id).kind, "Guarantee");
    assert.equal(nodes.get(id).status, "active");
  }
  assert.equal(
    [...nodes.values()].some((node) => (node.evidence ?? []).length > 0),
    false,
  );
});

test("relay walkthrough reads fresh views and composes review context without changing files", () => {
  const before = snapshotFiles(exampleRoot);
  const spec = query("spec");
  assert.equal(spec.rootModelId, "model:relay-learning");
  assert.equal(spec.result.generatedViews.length, 4);
  assert.ok(spec.result.generatedViews.every(({ freshness }) => freshness === "fresh"));

  const impact = query("impact", "RELAY-INV-01");
  assert.ok(impact.result.impacts.some(({ node }) => node.id === "use-case:relay-directive"));
  const neighbors = query("neighbors", "concept:recipient");
  assert.ok(neighbors.result.incoming.some(({ edge }) => edge.id === "rel:directive-targets-recipient"));
  const relationship = query("node", "rel:directive-targets-recipient").result.node;
  assert.equal(relationship.from, "concept:directive");
  assert.equal(relationship.to, "concept:recipient");
  assert.equal(relationship.relationshipType, "targets");
  assert.ok(relationship.description.length > 0);
  query("context", "use-case:relay-directive");
  assert.deepEqual(snapshotFiles(exampleRoot), before);
});

function query(command, id) {
  const args = [cli, "query", command, "--root", exampleRoot, "--json"];
  if (id) args.push("--id", id);
  const result = spawnSync(process.execPath, args, { cwd: frameworkRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function snapshotFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? snapshotFiles(entryPath)
        : [[path.relative(exampleRoot, entryPath), readFileSync(entryPath).toString("base64")]];
    });
}
