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
import { checkGeneratedGraph as checkGeneratedGraphInProcess } from "../scripts/check-generated-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frameworkProductRoot = path.join(root, "docs", "ddd");
const generateGraph = path.join(root, "scripts", "generate-graph.mjs");
const checkGeneratedGraph = path.join(root, "scripts", "check-generated-graph.mjs");

test("generated graph JSON includes metadata, nodes, ownership edges, and relationship edges", () => {
  const fixtureRoot = copyGraphFixture();

  const result = runNode(generateGraph, fixtureRoot);

  assert.equal(result.status, 0, result.stderr);
  const graph = JSON.parse(readFileSync(path.join(fixtureRoot, "generated", "graph", "model-graph.json"), "utf8"));
  assert.equal(graph.schemaVersion, "1");
  assert.equal(graph.modelId, "model:ddduck");
  assert.equal(graph.modelName, "ddduck");
  assert.equal(graph.nameStatus, "stable");
  assert.equal(graph.generatedBy, "scripts/generate-graph.mjs");
  assert.ok(graph.nodes.some((node) => node.id === "domain:metamodel" && node.kind === "Domain"));
  assert.ok(graph.nodes.some((node) => node.id === "concept:model" && node.ownerDomain === "domain:metamodel"));
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.id === "edge:owns|model:ddduck|domain:metamodel" &&
        edge.from === "model:ddduck" &&
        edge.to === "domain:metamodel" &&
        edge.kind === "owns",
    ),
  );
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.id === "edge:owns|domain:metamodel|concept:model" &&
        edge.from === "domain:metamodel" &&
        edge.to === "concept:model" &&
        edge.kind === "owns",
    ),
  );
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.id === "rel:traceability-metamodel" &&
        edge.from === "domain:traceability" &&
        edge.to === "domain:metamodel" &&
        edge.kind === "relationship" &&
        edge.relationshipType === "validates" &&
        edge.mode === "graph-read",
    ),
  );
});

test("generated graph NDJSON includes metadata, node, and edge records", () => {
  const fixtureRoot = copyGraphFixture();

  const result = runNode(generateGraph, fixtureRoot);

  assert.equal(result.status, 0, result.stderr);
  const records = readFileSync(path.join(fixtureRoot, "generated", "graph", "model-graph.ndjson"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(records.some((record) => record.type === "metadata" && record.modelId === "model:ddduck"));
  assert.ok(records.some((record) => record.type === "node" && record.id === "domain:metamodel"));
  assert.ok(records.some((record) => record.type === "edge" && record.id === "rel:traceability-metamodel"));
});

test("generated graph renders a Relationship without a description using the documented fallback", () => {
  const fixtureRoot = copyGraphFixture();
  const relationshipPath = path.join(fixtureRoot, "model", "relationships", "traceability-metamodel.yaml");
  writeFileSync(
    relationshipPath,
    readFileSync(relationshipPath, "utf8").replace(
      "description: Traceability validates that model nodes and edges defined under\n  Metamodel resolve and remain coherent.\n",
      "",
    ),
  );

  const result = runNode(generateGraph, fixtureRoot);

  assert.equal(result.status, 0, result.stderr);
  const graph = JSON.parse(readFileSync(path.join(fixtureRoot, "generated", "graph", "model-graph.json"), "utf8"));
  const node = graph.nodes.find((candidate) => candidate.id === "rel:traceability-metamodel");
  assert.equal(node.purpose, "Unspecified");
});

test("generated graph treats an absent relationships listing the same as an empty one", () => {
  const fixtureRoot = copyGraphFixture();
  const productPath = path.join(fixtureRoot, "product.yaml");
  writeFileSync(productPath, readFileSync(productPath, "utf8").replace(/relationships:(\n  - rel:[^\n]+)+\n/, ""));

  const result = runNode(generateGraph, fixtureRoot);

  assert.equal(result.status, 0, result.stderr);
  const graph = JSON.parse(readFileSync(path.join(fixtureRoot, "generated", "graph", "model-graph.json"), "utf8"));
  assert.equal(
    graph.edges.some((edge) => edge.kind === "relationship"),
    false,
    "an unlisted Relationship node must not be rendered as an edge",
  );
});

test("generated graph freshness check fails when JSON file is missing", () => {
  const fixtureRoot = copyGraphFixture();
  const generateResult = runNode(generateGraph, fixtureRoot);
  assert.equal(generateResult.status, 0, generateResult.stderr);
  rmSync(path.join(fixtureRoot, "generated", "graph", "model-graph.json"), { force: true });

  const result = runNode(checkGeneratedGraph, fixtureRoot);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /generated\/graph\/model-graph\.json is missing or stale/);
  assert.match(result.stderr, /run ddduck generate --root /);
  assert.doesNotMatch(result.stderr, /npm run/);
});

test("generated graph freshness check fails when NDJSON file is stale", () => {
  const fixtureRoot = copyGraphFixture();
  const generateResult = runNode(generateGraph, fixtureRoot);
  assert.equal(generateResult.status, 0, generateResult.stderr);
  writeFileSync(path.join(fixtureRoot, "generated", "graph", "model-graph.ndjson"), "stale\n");

  const result = runNode(checkGeneratedGraph, fixtureRoot);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /generated\/graph\/model-graph\.ndjson is missing or stale/);
});

test("generated graph freshness check is callable with an explicit root", () => {
  const fixtureRoot = copyGraphFixture();
  writeFileSync(path.join(fixtureRoot, "generated", "graph", "model-graph.ndjson"), "stale\n");

  assert.throws(
    () => checkGeneratedGraphInProcess(fixtureRoot),
    /generated\/graph\/model-graph\.ndjson is missing or stale/,
  );
});

test("generated graph freshness check passes after generation", () => {
  const fixtureRoot = copyGraphFixture();
  const generateResult = runNode(generateGraph, fixtureRoot);
  assert.equal(generateResult.status, 0, generateResult.stderr);

  const result = runNode(checkGeneratedGraph, fixtureRoot);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("generated graph freshness check reports details with verbose output", () => {
  const fixtureRoot = copyGraphFixture();
  const generateResult = runNode(generateGraph, fixtureRoot);
  assert.equal(generateResult.status, 0, generateResult.stderr);

  const result = runNode(checkGeneratedGraph, fixtureRoot, ["--verbose"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /generated graph ok/);
});

test("generated graph generation reports details with verbose output", () => {
  const fixtureRoot = copyGraphFixture();

  const result = runNode(generateGraph, fixtureRoot, ["--verbose"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /wrote generated\/graph\/model-graph\.json/);
  assert.match(result.stdout, /wrote generated\/graph\/model-graph\.ndjson/);
});

test("generated graph refuses a generated directory symlink without writing outside the product", () => {
  const fixtureRoot = copyGraphFixture();
  const externalDirectory = mkdtempSync(path.join(tmpdir(), "ddduck-generated-graph-external-"));
  rmSync(path.join(fixtureRoot, "generated"), { recursive: true, force: true });
  symlinkSync(externalDirectory, path.join(fixtureRoot, "generated"));

  const result = runNode(generateGraph, fixtureRoot);

  assert.notEqual(result.status, 0, result.stdout);
  assert.equal(existsSync(path.join(externalDirectory, "graph", "model-graph.json")), false);
  assert.equal(existsSync(path.join(externalDirectory, "graph", "model-graph.ndjson")), false);
});

function runNode(scriptPath, fixtureRoot, extraArgs = []) {
  return spawnSync(process.execPath, [scriptPath, "--root", fixtureRoot, ...extraArgs], {
    cwd: root,
    encoding: "utf8",
  });
}

function copyGraphFixture() {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "ddduck-generated-graph-"));
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
