import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as productQuery from "../scripts/lib/product-query.mjs";

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(frameworkRoot, "scripts", "ddduck.mjs");
const provingFixture = path.join(frameworkRoot, "examples", "reminders", "ddd");

test("query help is available through the published CLI without diagnostics", () => {
  const result = runDdd(["query", "--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Syntax: ddduck query/);
  assert.equal(result.stdout.match(/ddduck query <node\|neighbors\|impact\|anchors\|spec\|context>/g).length, 1);
  assert.equal(result.stderr, "");
});

test("query node emits a bounded JSON envelope with a product-relative source path", () => {
  const result = runDdd(["query", "node", "--id", "use-case:create-reminder", "--root", provingFixture, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: "1",
    query: { operation: "node", id: "use-case:create-reminder", history: false },
    rootModelId: "model:members-reminders",
    result: {
      node: {
        schemaVersion: "1",
        kind: "UseCase",
        id: "use-case:create-reminder",
        model: "model:members-reminders",
        name: "Create reminder",
        goal: "Create a reminder for a member who is available in ordinary flows.",
        preconditions: { requires: ["MEMBERS-INV-01"] },
        success: {
          preserves: ["MEMBERS-INV-01", "REMINDERS-INV-01"],
          establishes: ["REMINDERS-AC-01"],
        },
        interfaces: ["interface:create-reminder"],
        sourcePath: "model/use-cases/create-reminder.yaml",
      },
    },
    diagnostics: [],
  });
});

test("query resolves a configured product root when --root is omitted", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "ddduck-query-configured-root-"));
  cpSync(provingFixture, path.join(repo, "docs", "ddd"), { recursive: true });
  mkdirSync(path.join(repo, ".ddduck"));
  writeFileSync(
    path.join(repo, ".ddduck", "config.json"),
    `${JSON.stringify({ schemaVersion: "1", productRoot: "docs/ddd" }, null, 2)}\n`,
    { flag: "wx" },
  );

  const result = spawnSync(process.execPath, [cli, "query", "node", "--id", "use-case:create-reminder", "--json"], {
    cwd: repo,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).rootModelId, "model:members-reminders");
});

test("query neighbors returns sorted edge records with endpoint summaries", () => {
  const result = runDdd(["query", "neighbors", "--id", "domain:reminders", "--root", provingFixture, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.deepEqual(document.query, { operation: "neighbors", id: "domain:reminders", history: false });
  assert.equal(document.rootModelId, "model:members-reminders");
  assert.deepEqual(document.result.node, {
    id: "domain:reminders",
    kind: "Domain",
    name: "Reminders",
    sourcePath: "model/domains/reminders.yaml",
  });
  assert.deepEqual(document.result.incoming, [
    {
      edge: {
        id: "edge:owns|model:members-reminders|domain:reminders",
        from: "model:members-reminders",
        to: "domain:reminders",
        kind: "owns",
        label: "owns",
        source: "model:members-reminders",
        relationshipType: null,
        mode: null,
      },
      node: {
        id: "model:members-reminders",
        kind: "Model",
        name: "Members and Reminders",
        sourcePath: "product.yaml",
      },
    },
  ]);
  assert.deepEqual(
    document.result.outgoing.map((entry) => entry.edge.id),
    [
      "edge:owns|domain:reminders|concept:reminder",
      "edge:owns|domain:reminders|interface:create-reminder",
      "edge:owns|domain:reminders|REMINDERS-AC-01",
      "edge:owns|domain:reminders|REMINDERS-INV-01",
    ],
  );
  assert.deepEqual(
    document.result.outgoing.map((entry) => entry.node.sourcePath),
    [
      "model/concepts/reminder.yaml",
      "model/interfaces/create-reminder.yaml",
      "model/guarantees/reminders-ac-01.yaml",
      "model/guarantees/reminders-inv-01.yaml",
    ],
  );
  assert.deepEqual(document.diagnostics, []);
});

test("query rejects unknown IDs and treats --json as an accepted no-op", () => {
  const unknown = runDdd(["query", "node", "--id", "concept:missing", "--root", provingFixture, "--json"]);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown model node concept:missing/);

  const withoutJson = runDdd(["query", "node", "--id", "domain:members", "--root", provingFixture]);
  assert.equal(withoutJson.status, 0, withoutJson.stderr);
  const withJson = runDdd(["query", "node", "--id", "domain:members", "--root", provingFixture, "--json"]);
  assert.equal(withJson.status, 0, withJson.stderr);
  assert.equal(withoutJson.stdout, withJson.stdout);
});

test("query rejects an invalid product before returning a graph-derived result", () => {
  const fixture = invalidProductFixture();
  const result = runDdd(["query", "node", "--id", "domain:members", "--root", fixture, "--json"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /node ownership mismatch: REMINDERS-INV-01 listed by domain:members/);
  assert.equal(result.stdout, "");
});

test("query redirects a retired guarantee unless history is explicit", () => {
  const fixture = retiredGuaranteeFixture();
  const defaultResult = runDdd(["query", "node", "--id", "REMINDERS-AC-01", "--root", fixture, "--json"]);

  assert.equal(defaultResult.status, 0, defaultResult.stderr);
  assert.deepEqual(JSON.parse(defaultResult.stdout).result, {
    lifecycleRedirect: {
      id: "REMINDERS-AC-01",
      status: "retired",
      lifecycleDecision: "ADR-001",
      successors: [],
    },
  });
  assert.doesNotMatch(defaultResult.stdout, /Creating a valid reminder/);

  const historyResult = runDdd(["query", "node", "--id", "REMINDERS-AC-01", "--root", fixture, "--history", "--json"]);

  assert.equal(historyResult.status, 0, historyResult.stderr);
  const history = JSON.parse(historyResult.stdout);
  assert.deepEqual(history.query, { operation: "node", id: "REMINDERS-AC-01", history: true });
  assert.equal(history.result.node.status, "retired");
  assert.equal(history.result.node.statement, "Creating a valid reminder makes it available to its assigned member.");
  assert.equal(history.result.node.sourcePath, "model/guarantees/reminders-ac-01.yaml");
});

test("query impact reports a stable reverse closure over reference and ownership edges", () => {
  const result = runDdd(["query", "impact", "--id", "REMINDERS-INV-01", "--root", provingFixture, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.deepEqual(document.query, { operation: "impact", id: "REMINDERS-INV-01", history: false });
  assert.deepEqual(document.result.source, {
    id: "REMINDERS-INV-01",
    kind: "Guarantee",
    name: null,
    sourcePath: "model/guarantees/reminders-inv-01.yaml",
  });
  assert.deepEqual(
    document.result.impacts.map(({ depth, edge, node }) => [depth, edge.id, node.id]),
    [
      [1, "edge:guarantees|interface:create-reminder|REMINDERS-INV-01", "interface:create-reminder"],
      [1, "edge:owns|domain:reminders|REMINDERS-INV-01", "domain:reminders"],
      [1, "edge:preserves|use-case:create-reminder|REMINDERS-INV-01", "use-case:create-reminder"],
      [2, "edge:owns|model:members-reminders|domain:reminders", "model:members-reminders"],
    ],
  );
  assert.deepEqual(document.diagnostics, []);
});

test("query impact protects a stable traversal from cycles", () => {
  assert.equal(typeof productQuery.queryImpact, "function");
  const product = {
    rootModelId: "model:cycle",
    nodes: new Map([
      ["model:cycle", { id: "model:cycle", kind: "Model", name: "Cycle" }],
      ["domain:a", { id: "domain:a", kind: "Domain", name: "A" }],
      ["concept:b", { id: "concept:b", kind: "Concept", name: "B" }],
    ]),
    sourcePaths: new Map([
      ["model:cycle", "product.yaml"],
      ["domain:a", "model/domains/a.yaml"],
      ["concept:b", "model/concepts/b.yaml"],
    ]),
    edges: [
      { id: "edge:owns|model:cycle|domain:a", from: "model:cycle", to: "domain:a", kind: "owns" },
      { id: "edge:owns|domain:a|concept:b", from: "domain:a", to: "concept:b", kind: "owns" },
      { id: "edge:requires|concept:b|domain:a", from: "concept:b", to: "domain:a", kind: "requires" },
    ],
    lifecycleRedirects: new Map(),
  };

  const document = productQuery.queryImpact(product, "concept:b");

  assert.deepEqual(
    document.result.impacts.map(({ depth, edge, node }) => [depth, edge.id, node.id]),
    [
      [1, "edge:owns|domain:a|concept:b", "domain:a"],
      [2, "edge:owns|model:cycle|domain:a", "model:cycle"],
    ],
  );
});

test("query anchors preserves declared anchor text and makes absent evidence explicit", () => {
  const result = runDdd(["query", "anchors", "--id", "interface:create-reminder", "--root", provingFixture, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.deepEqual(document.query, { operation: "anchors", id: "interface:create-reminder", history: false });
  assert.deepEqual(document.result.node, {
    id: "interface:create-reminder",
    kind: "DomainInterface",
    name: "Create reminder",
    sourcePath: "model/interfaces/create-reminder.yaml",
  });
  assert.deepEqual(document.result.declaredAnchors, [
    { path: "decisions/ADR-001-reminder-contract.md", anchor: "ADR-001", role: "decision" },
    { path: "reference-evidence.md", anchor: "Source", role: "source" },
    { path: "reference-evidence.md", anchor: "Verification", role: "verification" },
  ]);
  assert.deepEqual(document.result.decisions, [
    { id: "ADR-001", path: "decisions/ADR-001-reminder-contract.md" },
    { id: "ADR-002", path: "decisions/ADR-002-member-availability-transition.md" },
  ]);
  assert.deepEqual(document.result.policies, [
    "concept-owner-domain",
    "documentation-model-reference-resolution",
    "no-dangling-model-reference",
  ]);
  assert.deepEqual(document.result.generatedViews, [
    { path: "generated/docs/model-overview.md", freshness: "fresh" },
    { path: "generated/graph/model-graph.json", freshness: "fresh" },
    { path: "generated/graph/model-graph.ndjson", freshness: "fresh" },
  ]);
  assert.deepEqual(document.result.verificationCommands, [
    `ddduck check --root ${realpathSync(provingFixture)}`,
    `ddduck generate --root ${realpathSync(provingFixture)}`,
  ]);
  assert.deepEqual(document.result.missingEvidence, []);
});

test("query anchors demands source and verification anchors only on kinds whose schema accepts evidence", () => {
  const concept = runDdd(["query", "anchors", "--id", "concept:member", "--root", provingFixture, "--json"]);
  assert.equal(concept.status, 0, concept.stderr);
  const conceptDocument = JSON.parse(concept.stdout);
  assert.deepEqual(conceptDocument.result.declaredAnchors, []);
  assert.deepEqual(conceptDocument.result.missingEvidence, []);

  const relationship = runDdd([
    "query",
    "anchors",
    "--id",
    "rel:reminder-assigned-to-member",
    "--root",
    provingFixture,
    "--json",
  ]);
  assert.equal(relationship.status, 0, relationship.stderr);
  assert.deepEqual(JSON.parse(relationship.stdout).result.missingEvidence, ["decision"]);

  const guarantee = runDdd(["query", "anchors", "--id", "MEMBERS-INV-01", "--root", provingFixture, "--json"]);
  assert.equal(guarantee.status, 0, guarantee.stderr);
  assert.deepEqual(JSON.parse(guarantee.stdout).result.missingEvidence, ["source", "verification"]);
});

test("query spec returns the canonical root, owned domains, generated freshness, and required checks", () => {
  const result = runDdd(["query", "spec", "--root", provingFixture, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.deepEqual(document.query, { operation: "spec", id: "model:members-reminders", history: false });
  assert.deepEqual(document.result.root, {
    schemaVersion: "1",
    kind: "Model",
    id: "model:members-reminders",
    name: "Members and Reminders",
    purpose: "Define member lifecycle and reminder creation contracts.",
    domains: ["domain:members", "domain:reminders"],
    useCases: ["use-case:create-reminder"],
    relationships: ["rel:reminder-assigned-to-member"],
    decisions: ["ADR-001", "ADR-002"],
    sourcePath: "product.yaml",
  });
  assert.deepEqual(document.result.ownedDomains, [
    { id: "domain:members", kind: "Domain", name: "Members", sourcePath: "model/domains/members.yaml" },
    { id: "domain:reminders", kind: "Domain", name: "Reminders", sourcePath: "model/domains/reminders.yaml" },
  ]);
  assert.deepEqual(document.result.generatedViews, [
    { path: "generated/docs/model-overview.md", freshness: "fresh" },
    { path: "generated/graph/model-graph.json", freshness: "fresh" },
    { path: "generated/graph/model-graph.ndjson", freshness: "fresh" },
  ]);
  assert.deepEqual(document.result.verificationCommands, [
    `ddduck check --root ${realpathSync(provingFixture)}`,
    `ddduck generate --root ${realpathSync(provingFixture)}`,
  ]);
});

test("verification commands shell-quote resolved roots that contain spaces", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "ddduck quoted root-"));
  const root = path.join(repo, "ddd");
  cpSync(provingFixture, root, { recursive: true });

  const result = runDdd(["query", "spec", "--root", root, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  const quotedRoot = `'${realpathSync(root)}'`;
  assert.deepEqual(document.result.verificationCommands, [
    `ddduck check --root ${quotedRoot}`,
    `ddduck generate --root ${quotedRoot}`,
  ]);
});

test("validation resolves evidence anchor paths from the selected product root", () => {
  const fixture = evidenceAnchorFixture("README.md");
  const result = runDdd(["check", "--root", fixture]);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /evidence anchor path must resolve to an existing regular file below product root: README\.md/,
  );
});

test("validation rejects absolute and lexical evidence anchor path escapes", () => {
  const absoluteFixture = evidenceAnchorFixture("placeholder.md");
  const absolutePath = path.join(absoluteFixture, "decisions", "ADR-001-reminder-contract.md");
  setEvidenceAnchorPath(absoluteFixture, absolutePath);
  const lexicalFixture = evidenceAnchorFixture("../outside.md");

  for (const [fixture, anchorPath] of [
    [absoluteFixture, absolutePath],
    [lexicalFixture, "../outside.md"],
  ]) {
    const result = runDdd(["check", "--root", fixture]);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      new RegExp(
        `evidence anchor path must resolve to an existing regular file below product root: ${escapeRegExp(anchorPath)}`,
      ),
    );
  }
});

test("validation rejects evidence anchors that resolve through an in-root symlink outside the product", () => {
  const externalDirectory = mkdtempSync(path.join(tmpdir(), "ddduck-query-external-"));
  const externalFile = path.join(externalDirectory, "source.md");
  writeFileSync(externalFile, "external source\n");
  const fixture = evidenceAnchorFixture("source-link.md");
  symlinkSync(externalFile, path.join(fixture, "source-link.md"));

  const result = runDdd(["check", "--root", fixture]);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /evidence anchor path must resolve to an existing regular file below product root: source-link\.md/,
  );
});

test("validation rejects evidence anchors that target a directory", () => {
  const fixture = evidenceAnchorFixture("decisions");
  const result = runDdd(["check", "--root", fixture]);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /evidence anchor path must resolve to an existing regular file below product root: decisions/,
  );
});

test("query spec reports stale generated views", () => {
  const fixture = staleGeneratedViewFixture();
  const result = runDdd(["query", "spec", "--root", fixture, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.deepEqual(document.result.generatedViews, [
    { path: "generated/docs/model-overview.md", freshness: "fresh" },
    { path: "generated/graph/model-graph.json", freshness: "stale" },
    { path: "generated/graph/model-graph.ndjson", freshness: "fresh" },
  ]);
});

function retiredGuaranteeFixture() {
  const destination = mkdtempSync(path.join(tmpdir(), "ddduck-query-"));
  cpSync(provingFixture, destination, { recursive: true });
  const guaranteePath = path.join(destination, "model", "guarantees", "reminders-ac-01.yaml");
  writeFileSync(
    guaranteePath,
    readFileSync(guaranteePath, "utf8").replace("status: active", "status: retired\nlifecycleDecision: ADR-001"),
  );
  writeFileSync(
    path.join(destination, "model", "use-cases", "create-reminder.yaml"),
    readFileSync(path.join(destination, "model", "use-cases", "create-reminder.yaml"), "utf8").replace(
      "  establishes:\n    - REMINDERS-AC-01",
      "  establishes: []",
    ),
  );
  return destination;
}

function invalidProductFixture() {
  const destination = mkdtempSync(path.join(tmpdir(), "ddduck-query-invalid-"));
  cpSync(provingFixture, destination, { recursive: true });
  const domainPath = path.join(destination, "model", "domains", "members.yaml");
  writeFileSync(domainPath, readFileSync(domainPath, "utf8").replace("  - MEMBERS-INV-01", "  - REMINDERS-INV-01"));
  return destination;
}

function evidenceAnchorFixture(anchorPath) {
  const destination = mkdtempSync(path.join(tmpdir(), "ddduck-query-anchor-"));
  cpSync(provingFixture, destination, { recursive: true });
  setEvidenceAnchorPath(destination, anchorPath);
  return destination;
}

function setEvidenceAnchorPath(destination, anchorPath) {
  const interfacePath = path.join(destination, "model", "interfaces", "create-reminder.yaml");
  writeFileSync(
    interfacePath,
    readFileSync(interfacePath, "utf8").replace(/^  - path: .*$/m, `  - path: ${anchorPath}`),
  );
}

function staleGeneratedViewFixture() {
  const destination = mkdtempSync(path.join(tmpdir(), "ddduck-query-stale-view-"));
  cpSync(provingFixture, destination, { recursive: true });
  writeFileSync(path.join(destination, "generated", "graph", "model-graph.json"), "stale\n");
  return destination;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runDdd(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: frameworkRoot, encoding: "utf8" });
}
