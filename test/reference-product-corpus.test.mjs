import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { detectProductLayout, loadProductNodes } from "../scripts/lib/product-layout.mjs";

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(frameworkRoot, "scripts", "ddduck.mjs");
const referenceRoot = path.join(frameworkRoot, "examples", "reminders", "ddd");

test("reference product corpus contains every canonical node kind and retired lifecycle record", () => {
  const loaded = loadProductNodes(detectProductLayout(referenceRoot));

  assert.deepEqual(
    new Set([...loaded.nodes.values()].map((node) => node.kind)),
    new Set(["Model", "Domain", "Concept", "Relationship", "Guarantee", "UseCase", "DomainInterface"]),
  );
  assert.equal(loaded.nodes.get("MEMBERS-INV-00").status, "retired");
  assert.equal(loaded.nodes.get("MEMBERS-INV-00").lifecycleDecision, "ADR-002");
});

test("reference product queries expose relationship topology and bounded retired history", () => {
  const neighbors = runDdd(["query", "neighbors", "--id", "concept:member", "--root", referenceRoot, "--json"]);
  assert.equal(neighbors.status, 0, neighbors.stderr);
  assert.ok(
    JSON.parse(neighbors.stdout).result.incoming.some(({ edge }) => edge.id === "rel:reminder-assigned-to-member"),
  );

  const defaultNode = runDdd(["query", "node", "--id", "MEMBERS-INV-00", "--root", referenceRoot, "--json"]);
  assert.equal(defaultNode.status, 0, defaultNode.stderr);
  const defaultDocument = JSON.parse(defaultNode.stdout);
  assert.deepEqual(defaultDocument.result.lifecycleRedirect, {
    id: "MEMBERS-INV-00",
    status: "retired",
    lifecycleDecision: "ADR-002",
    successors: [],
  });
  assert.equal(Object.hasOwn(defaultDocument.result.lifecycleRedirect, "statement"), false);

  const historyNode = runDdd([
    "query",
    "node",
    "--id",
    "MEMBERS-INV-00",
    "--root",
    referenceRoot,
    "--history",
    "--json",
  ]);
  assert.equal(historyNode.status, 0, historyNode.stderr);
  const historyDocument = JSON.parse(historyNode.stdout);
  assert.equal(historyDocument.result.node.status, "retired");
  assert.equal(typeof historyDocument.result.node.statement, "string");
  assert.notEqual(historyDocument.result.node.statement, "");
  assert.equal(historyDocument.result.node.sourcePath, "model/guarantees/members-inv-00.yaml");
});

test("reference product query anchors declare source, decision, and verification evidence", () => {
  const anchors = runDdd(["query", "anchors", "--id", "interface:create-reminder", "--root", referenceRoot, "--json"]);
  assert.equal(anchors.status, 0, anchors.stderr);
  const declaredAnchors = JSON.parse(anchors.stdout).result.declaredAnchors;

  for (const role of ["source", "decision", "verification"]) {
    assert.ok(
      declaredAnchors.some((anchor) => anchor.role === role),
      `missing ${role} evidence anchor`,
    );
  }
});

test("reference product query spec is rooted at the explicit corpus", () => {
  const spec = runDdd(["query", "spec", "--root", referenceRoot, "--json"]);

  assert.equal(spec.status, 0, spec.stderr);
  const document = JSON.parse(spec.stdout);
  assert.equal(document.rootModelId, "model:members-reminders");
  assert.equal(document.result.root.sourcePath, "product.yaml");
  assert.deepEqual(document.result.generatedViews, [
    { path: "generated/docs/model-overview.md", freshness: "fresh" },
    { path: "generated/graph/model-graph.json", freshness: "fresh" },
    { path: "generated/graph/model-graph.ndjson", freshness: "fresh" },
    { path: "generated/graph/model-graph.svg", freshness: "fresh" },
  ]);
});

function runDdd(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: frameworkRoot, encoding: "utf8" });
}
