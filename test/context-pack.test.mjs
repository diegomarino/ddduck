import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { resolveContextPack, sourceDigest } from "../scripts/lib/context-pack.mjs";
import { loadQueryProduct } from "../scripts/lib/product-query.mjs";

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frameworkProductRoot = path.join(frameworkRoot, "docs", "ddd");
const cli = path.join(frameworkRoot, "scripts", "ddduck.mjs");
const provingFixture = path.join(frameworkRoot, "examples", "reminders", "ddd");
const contextPackSchema = JSON.parse(
  readFileSync(path.join(frameworkRoot, "schemas", "context-pack.schema.json"), "utf8"),
);
const validateContextPack = new Ajv2020({ allErrors: true, strict: true }).compile(contextPackSchema);

test("resolves a selected domain with complete records and one-hop summaries", () => {
  const product = loadQueryProduct(provingFixture);
  const pack = resolveContextPack(product, ["domain:reminders"]);

  assert.equal(pack.query.operation, "context");
  assert.deepEqual(pack.query.ids, ["domain:reminders"]);
  assert.deepEqual(pack.result.selected, [
    {
      schemaVersion: "1",
      kind: "Domain",
      id: "domain:reminders",
      model: "model:members-reminders",
      name: "Reminders",
      purpose: "Create reminders for members who remain available in ordinary flows.",
      concepts: ["concept:reminder"],
      interfaces: ["interface:create-reminder"],
      guarantees: ["REMINDERS-INV-01", "REMINDERS-AC-01"],
      sourcePath: "model/domains/reminders.yaml",
    },
  ]);
  assert.deepEqual(
    pack.result.edges.map((edge) => edge.id),
    [
      "edge:owns|domain:reminders|concept:reminder",
      "edge:owns|domain:reminders|interface:create-reminder",
      "edge:owns|domain:reminders|REMINDERS-AC-01",
      "edge:owns|domain:reminders|REMINDERS-INV-01",
      "edge:owns|model:members-reminders|domain:reminders",
    ],
  );
  assert.deepEqual(pack.result.neighbors, [
    {
      id: "concept:reminder",
      kind: "Concept",
      name: "Reminder",
      sourcePath: "model/concepts/reminder.yaml",
    },
    {
      id: "interface:create-reminder",
      kind: "DomainInterface",
      name: "Create reminder",
      sourcePath: "model/interfaces/create-reminder.yaml",
    },
    {
      id: "model:members-reminders",
      kind: "Model",
      name: "Members and Reminders",
      sourcePath: "product.yaml",
    },
    {
      id: "REMINDERS-AC-01",
      kind: "Guarantee",
      name: null,
      sourcePath: "model/guarantees/reminders-ac-01.yaml",
    },
    {
      id: "REMINDERS-INV-01",
      kind: "Guarantee",
      name: null,
      sourcePath: "model/guarantees/reminders-inv-01.yaml",
    },
  ]);
  assert.equal(pack.result.neighbors[0].statement, undefined);
  assert.equal(validateContextPack(pack), true, JSON.stringify(validateContextPack.errors));
});

test("sorts a copied selection without changing the caller input", () => {
  const product = loadQueryProduct(provingFixture);
  const selectedIds = ["use-case:create-reminder", "domain:reminders"];

  const pack = resolveContextPack(product, selectedIds);

  assert.deepEqual(selectedIds, ["use-case:create-reminder", "domain:reminders"]);
  assert.deepEqual(pack.query.ids, ["domain:reminders", "use-case:create-reminder"]);
  assert.deepEqual(
    pack.result.selected.map((node) => node.id),
    ["domain:reminders", "use-case:create-reminder"],
  );
  assert.deepEqual(
    pack.result.edges.map((edge) => edge.id),
    [...pack.result.edges.map((edge) => edge.id)].sort((left, right) => left.localeCompare(right)),
  );
  assert.deepEqual(
    pack.result.neighbors.map((node) => node.id),
    [...pack.result.neighbors.map((node) => node.id)].sort((left, right) => left.localeCompare(right)),
  );
});

test("rejects empty, duplicate, unknown, and inactive selections", () => {
  const product = loadQueryProduct(provingFixture);

  assert.throws(() => resolveContextPack(product, []), /Context pack requires at least one selected ID/);
  assert.throws(
    () => resolveContextPack(product, ["domain:reminders", "domain:reminders"]),
    /Context pack selection contains duplicate ID domain:reminders/,
  );
  assert.throws(() => resolveContextPack(product, ["concept:missing"]), /Unknown model node concept:missing/);

  const retiredProduct = loadQueryProduct(retiredGuaranteeFixture());
  assert.throws(
    () => resolveContextPack(retiredProduct, ["REMINDERS-AC-01"]),
    /Cannot select inactive model node REMINDERS-AC-01 \(retired\)/,
  );
});

test("keeps shared selected endpoints out of neighbors and includes their edge once", () => {
  const product = loadQueryProduct(provingFixture);
  const pack = resolveContextPack(product, ["domain:reminders", "interface:create-reminder"]);

  assert.equal(
    pack.result.edges.filter((edge) => edge.id === "edge:owns|domain:reminders|interface:create-reminder").length,
    1,
  );
  assert.equal(
    pack.result.neighbors.some((node) => node.id === "domain:reminders"),
    false,
  );
  assert.equal(
    pack.result.neighbors.some((node) => node.id === "interface:create-reminder"),
    false,
  );
});

test("keeps the perimeter one hop while its full source digest tracks unselected changes", () => {
  const baselineProduct = loadQueryProduct(provingFixture);
  const baselinePack = resolveContextPack(baselineProduct, ["domain:reminders"]);
  const changedFixture = secondHopChangeFixture();
  const changedProduct = loadQueryProduct(changedFixture);
  const changedPack = resolveContextPack(changedProduct, ["domain:reminders"]);

  assert.deepEqual(changedPack.result.edges, baselinePack.result.edges);
  assert.deepEqual(changedPack.result.neighbors, baselinePack.result.neighbors);
  assert.notEqual(changedPack.snapshot.sourceDigest, baselinePack.snapshot.sourceDigest);
  assert.equal(changedPack.snapshot.sourceDigest, sourceDigest(changedProduct.root, changedProduct.sourcePaths));
});

test("is byte-stable for the same product snapshot", () => {
  const product = loadQueryProduct(provingFixture);

  assert.equal(
    JSON.stringify(resolveContextPack(product, ["domain:reminders", "use-case:create-reminder"])),
    JSON.stringify(resolveContextPack(product, ["use-case:create-reminder", "domain:reminders"])),
  );
});

test("resolves the canonical product through the context CLI", () => {
  const result = runDdd(["query", "context", "--id", "domain:metamodel", "--root", frameworkProductRoot, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const pack = JSON.parse(result.stdout);
  assert.deepEqual(pack.query, { operation: "context", ids: ["domain:metamodel"], history: false });
  assert.equal(pack.result.selected[0].id, "domain:metamodel");
  assert.match(pack.snapshot.sourceDigest, /^[a-f0-9]{64}$/);
});

test("resolves records and the digest from the loaded source snapshot after source mutation", () => {
  const fixture = snapshotMutationFixture();
  const product = loadQueryProduct(fixture);
  const loadedPack = resolveContextPack(product, ["domain:reminders"]);
  const domainPath = path.join(fixture, "model", "domains", "reminders.yaml");
  writeFileSync(
    domainPath,
    readFileSync(domainPath, "utf8").replace(
      "Create reminders for members who remain available in ordinary flows.",
      "Create reminders for members who remain available in changed ordinary flows.",
    ),
  );

  const resolvedAfterMutation = resolveContextPack(product, ["domain:reminders"]);

  assert.deepEqual(resolvedAfterMutation.result.selected, loadedPack.result.selected);
  assert.equal(resolvedAfterMutation.snapshot.sourceDigest, loadedPack.snapshot.sourceDigest);
  assert.notEqual(resolvedAfterMutation.snapshot.sourceDigest, sourceDigest(product.root, product.sourcePaths));
});

test("query context emits the sorted pack for repeatable selected IDs", () => {
  const result = runDdd([
    "query",
    "context",
    "--id",
    "use-case:create-reminder",
    "--id",
    "domain:reminders",
    "--root",
    provingFixture,
    "--json",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).query, {
    operation: "context",
    ids: ["domain:reminders", "use-case:create-reminder"],
    history: false,
  });
  assert.match(result.stdout, /\n$/);
});

test("query context requires an explicit root and selected IDs, with --json optional", () => {
  const withoutJson = runDdd(["query", "context", "--id", "domain:reminders", "--root", provingFixture]);
  assert.equal(withoutJson.status, 0, withoutJson.stderr);
  assert.equal(JSON.parse(withoutJson.stdout).query.operation, "context");

  const missingRoot = runDdd(["query", "context", "--id", "domain:reminders", "--json"]);
  assert.notEqual(missingRoot.status, 0);
  assert.match(missingRoot.stderr, /query context requires --root <product-root>/);

  const missingId = runDdd(["query", "context", "--root", provingFixture, "--json"]);
  assert.notEqual(missingId.status, 0);
  assert.match(missingId.stderr, /query context requires --id <model-node-id>/);
});

test("query context rejects history", () => {
  const result = runDdd([
    "query",
    "context",
    "--id",
    "domain:reminders",
    "--root",
    provingFixture,
    "--history",
    "--json",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /query context does not support --history/);
});

function retiredGuaranteeFixture() {
  const destination = mkdtempSync(path.join(tmpdir(), "ddduck-context-pack-retired-"));
  cpSync(provingFixture, destination, { recursive: true });
  const guaranteePath = path.join(destination, "model", "guarantees", "reminders-ac-01.yaml");
  writeFileSync(
    guaranteePath,
    readFileSync(guaranteePath, "utf8").replace("status: active", "status: retired\nlifecycleDecision: ADR-001"),
  );
  const useCasePath = path.join(destination, "model", "use-cases", "create-reminder.yaml");
  writeFileSync(
    useCasePath,
    readFileSync(useCasePath, "utf8").replace("  establishes:\n    - REMINDERS-AC-01", "  establishes: []"),
  );
  return destination;
}

function secondHopChangeFixture() {
  const destination = mkdtempSync(path.join(tmpdir(), "ddduck-context-pack-second-hop-"));
  cpSync(provingFixture, destination, { recursive: true });
  const useCasePath = path.join(destination, "model", "use-cases", "create-reminder.yaml");
  writeFileSync(
    useCasePath,
    readFileSync(useCasePath, "utf8").replace(
      "Create a reminder for a member who is available in ordinary flows.",
      "Create a reminder for a member who is available in changed ordinary flows.",
    ),
  );
  return destination;
}

function snapshotMutationFixture() {
  const destination = mkdtempSync(path.join(tmpdir(), "ddduck-context-pack-snapshot-"));
  cpSync(provingFixture, destination, { recursive: true });
  return destination;
}

function runDdd(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: frameworkRoot, encoding: "utf8" });
}
