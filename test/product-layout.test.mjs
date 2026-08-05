import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { detectProductLayout, loadProductSnapshot } from "../scripts/lib/product-layout.mjs";

test("detects a product root and its node directories", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ddduck-product-layout-"));
  mkdirSync(path.join(root, "model", "domains"), { recursive: true });
  writeFileSync(
    path.join(root, "product.yaml"),
    ['schemaVersion: "1"', "kind: Model", "id: model:test-product", "name: Test Product"].join("\n"),
  );

  const layout = detectProductLayout(root);

  assert.equal(layout.productPath, path.join(root, "product.yaml"));
  assert.deepEqual(layout.nodeDirectories, [
    "domains",
    "concepts",
    "relationships",
    "use-cases",
    "interfaces",
    "guarantees",
  ]);
  assert.equal(layout.decisionsDirectory, path.join(root, "decisions"));
  assert.equal(layout.generatedDirectory, path.join(root, "generated"));
});

test("loads an immutable transform snapshot with contained canonical paths", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ddduck-product-snapshot-"));
  mkdirSync(path.join(root, "model", "domains"), { recursive: true });
  writeFileSync(
    path.join(root, "product.yaml"),
    ['schemaVersion: "1"', "kind: Model", "id: model:test-product", "name: Test Product"].join("\n"),
  );
  writeFileSync(
    path.join(root, "model", "domains", "members.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Domain",
      "id: domain:members",
      "model: model:test-product",
      "name: Members",
      "purpose: Manage members.",
      "concepts: []",
      "interfaces: []",
      "guarantees: []",
    ].join("\n"),
  );

  const snapshot = loadProductSnapshot(detectProductLayout(root));

  assert.deepEqual(
    snapshot.nodes.map((node) => node.id),
    ["model:test-product", "domain:members"],
  );
  assert.equal(snapshot.canonicalPaths["model:test-product"], "product.yaml");
  assert.equal(snapshot.canonicalPaths["domain:members"], "model/domains/members.yaml");
  assert.throws(() => {
    snapshot.nodes[0].name = "Changed";
  }, TypeError);
});
