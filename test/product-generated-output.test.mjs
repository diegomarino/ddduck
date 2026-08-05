import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { writeModelOverview } from "../scripts/generate-docs.mjs";
import { writeModelGraph } from "../scripts/generate-graph.mjs";

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("product graph omits retired guarantees", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ddduck-product-graph-"));
  mkdirSync(path.join(root, "model", "domains"), { recursive: true });
  mkdirSync(path.join(root, "model", "guarantees"), { recursive: true });
  writeFileSync(
    path.join(root, "product.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Model",
      "id: model:sample",
      "name: Sample",
      "purpose: Test.",
      "domains:",
      "  - domain:sample",
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, "model", "domains", "sample.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Domain",
      "id: domain:sample",
      "model: model:sample",
      "name: Sample",
      "purpose: Test.",
      "concepts: []",
      "interfaces: []",
      "guarantees:",
      "  - SAMPLE-INV-01",
      "  - SAMPLE-AC-01",
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, "model", "guarantees", "active.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Guarantee",
      "id: SAMPLE-INV-01",
      "model: model:sample",
      "ownerDomain: domain:sample",
      "classification: invariant",
      "statement: Active.",
      "status: active",
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, "model", "guarantees", "retired.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Guarantee",
      "id: SAMPLE-AC-01",
      "model: model:sample",
      "ownerDomain: domain:sample",
      "classification: acceptance-criterion",
      "statement: Retired.",
      "status: retired",
    ].join("\n"),
  );

  writeModelOverview(root);
  writeModelGraph(root);
  const graph = JSON.parse(readFileSync(path.join(root, "generated", "graph", "model-graph.json"), "utf8"));
  const overview = readFileSync(path.join(root, "generated", "docs", "model-overview.md"), "utf8");

  assert.equal(graph.formatVersion, "final");
  assert.ok(graph.nodes.some((node) => node.id === "SAMPLE-INV-01"));
  assert.ok(graph.nodes.every((node) => node.id !== "SAMPLE-AC-01"));
  assert.ok(graph.edges.every((edge) => edge.to !== "SAMPLE-AC-01"));
  assert.match(overview, /SAMPLE-INV-01/);
  assert.doesNotMatch(overview, /SAMPLE-AC-01/);
});

test("product graph summarizes a DomainInterface by name and operation kind", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ddduck-product-interface-graph-"));
  mkdirSync(path.join(root, "model", "domains"), { recursive: true });
  mkdirSync(path.join(root, "model", "interfaces"), { recursive: true });
  writeFileSync(
    path.join(root, "product.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Model",
      "id: model:sample",
      "name: Sample",
      "purpose: Test.",
      "domains:",
      "  - domain:sample",
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, "model", "domains", "sample.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Domain",
      "id: domain:sample",
      "model: model:sample",
      "name: Sample",
      "purpose: Test.",
      "concepts: []",
      "interfaces:",
      "  - interface:create-reminder",
      "guarantees: []",
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, "model", "interfaces", "create-reminder.yaml"),
    [
      'schemaVersion: "1"',
      "kind: DomainInterface",
      "id: interface:create-reminder",
      "model: model:sample",
      "ownerDomain: domain:sample",
      "name: Create reminder",
      "operationKind: command",
    ].join("\n"),
  );

  writeModelGraph(root);

  const graph = JSON.parse(readFileSync(path.join(root, "generated", "graph", "model-graph.json"), "utf8"));
  const domainInterface = graph.nodes.find((node) => node.id === "interface:create-reminder");
  assert.equal(domainInterface.purpose, "Create reminder (command)");
});

test("product exports behavioral reference edges and renders interfaces", () => {
  const root = copyRemindersFixture();

  writeModelOverview(root);
  writeModelGraph(root);

  const graph = JSON.parse(readFileSync(path.join(root, "generated", "graph", "model-graph.json"), "utf8"));
  const overview = readFileSync(path.join(root, "generated", "docs", "model-overview.md"), "utf8");

  assert.deepEqual(
    graph.edges.filter((edge) => edge.kind !== "owns"),
    [
      {
        id: "edge:establishes|use-case:create-reminder|REMINDERS-AC-01",
        from: "use-case:create-reminder",
        to: "REMINDERS-AC-01",
        kind: "establishes",
        label: "establishes",
        source: "use-case:create-reminder",
        relationshipType: null,
        mode: null,
      },
      {
        id: "edge:guarantees|interface:create-reminder|REMINDERS-INV-01",
        from: "interface:create-reminder",
        to: "REMINDERS-INV-01",
        kind: "guarantees",
        label: "guarantees",
        source: "interface:create-reminder",
        relationshipType: null,
        mode: null,
      },
      {
        id: "edge:preserves|use-case:create-reminder|MEMBERS-INV-01",
        from: "use-case:create-reminder",
        to: "MEMBERS-INV-01",
        kind: "preserves",
        label: "preserves",
        source: "use-case:create-reminder",
        relationshipType: null,
        mode: null,
      },
      {
        id: "edge:preserves|use-case:create-reminder|REMINDERS-INV-01",
        from: "use-case:create-reminder",
        to: "REMINDERS-INV-01",
        kind: "preserves",
        label: "preserves",
        source: "use-case:create-reminder",
        relationshipType: null,
        mode: null,
      },
      {
        id: "edge:requires|use-case:create-reminder|MEMBERS-INV-01",
        from: "use-case:create-reminder",
        to: "MEMBERS-INV-01",
        kind: "requires",
        label: "requires",
        source: "use-case:create-reminder",
        relationshipType: null,
        mode: null,
      },
      {
        id: "edge:uses|use-case:create-reminder|interface:create-reminder",
        from: "use-case:create-reminder",
        to: "interface:create-reminder",
        kind: "uses",
        label: "uses",
        source: "use-case:create-reminder",
        relationshipType: null,
        mode: null,
      },
      {
        id: "rel:reminder-assigned-to-member",
        from: "concept:reminder",
        to: "concept:member",
        kind: "relationship",
        label: "assigns",
        source: "rel:reminder-assigned-to-member",
        relationshipType: "assigns",
        mode: "ordinary-flow",
      },
    ],
  );
  assert.match(overview, /## Interfaces/);
  assert.match(overview, /### Create reminder \(`interface:create-reminder`\)/);
  assert.match(overview, /Operation kind: `command`/);
  assert.match(overview, /- Guarantees: `REMINDERS-INV-01`/);
  assert.match(overview, /- Interfaces: `interface:create-reminder`/);
});

function copyRemindersFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "ddduck-reminders-output-"));
  cpSync(path.join(frameworkRoot, "examples", "reminders", "ddd"), root, { recursive: true });
  return root;
}
