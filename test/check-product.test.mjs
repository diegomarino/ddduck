import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checker = path.join(frameworkRoot, "scripts", "check-model.mjs");

test("product rejects an active use case that references a retired guarantee", () => {
  const root = writeProduct({ guaranteeStatus: "retired" });

  const result = runChecker(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /non-effective guarantee MEMBERS-INV-01/);
});

test("product requires a lifecycle decision for a retired guarantee", () => {
  const root = writeProduct({ guaranteeStatus: "retired" });

  const result = runChecker(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /must have required property 'lifecycleDecision'/);
});

test("product rejects a lifecycle decision on an active guarantee", () => {
  const root = writeProduct({ guaranteeStatus: "active", lifecycleDecision: "ADR-001" });

  const result = runChecker(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /must NOT be valid/);
});

test("product resolves a guarantee lifecycle decision through the product registry", () => {
  const root = writeProduct({ guaranteeStatus: "split", lifecycleDecision: "ADR-999" });

  const result = runChecker(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /missing decision ADR-999 in lifecycleDecision/);
});

test("product accepts active guarantee references and reports global policies separately", () => {
  const root = writeProduct({ guaranteeStatus: "active" });

  const result = runChecker(root, ["--verbose"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /policies=3/);
  assert.match(result.stdout, /nodes=4/);
});

test("product rejects zero or multiple Model nodes before traversing references", () => {
  const missing = writeProduct({ guaranteeStatus: "active" });
  writeFileSync(
    path.join(missing, "product.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Domain",
      "id: domain:root",
      "model: model:reminders",
      "name: Root",
      "purpose: A valid non-model root.",
      "concepts: []",
      "interfaces: []",
      "guarantees: []",
    ].join("\n"),
  );

  const missingResult = runChecker(missing);

  assert.notEqual(missingResult.status, 0, missingResult.stdout);
  assert.match(missingResult.stderr, /expected exactly one Model node, found 0/);

  const duplicate = writeProduct({ guaranteeStatus: "active" });
  writeFileSync(
    path.join(duplicate, "model", "domains", "second-model.yaml"),
    readFileSync(path.join(duplicate, "product.yaml"), "utf8").replace("id: model:reminders", "id: model:other"),
  );

  const duplicateResult = runChecker(duplicate);

  assert.notEqual(duplicateResult.status, 0, duplicateResult.stdout);
  assert.match(duplicateResult.stderr, /expected exactly one Model node, found 2/);
});

test("product documentation policy resolves use case, interface, and guarantee identifiers", () => {
  const root = writeProduct({ guaranteeStatus: "active" });
  writeFileSync(
    path.join(root, "notes.md"),
    "Missing references: use-case:missing, interface:missing, and MISSING-INV-99.\n",
  );

  const result = runChecker(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /missing documentation reference use-case:missing/);
  assert.match(result.stderr, /missing documentation reference interface:missing/);
  assert.match(result.stderr, /missing documentation reference MISSING-INV-99/);
});

test("product documentation policy ignores agent scratch but validates product Markdown", () => {
  const root = writeProduct({ guaranteeStatus: "active" });
  mkdirSync(path.join(root, ".superpowers", "sdd"), { recursive: true });
  writeFileSync(
    path.join(root, ".superpowers", "sdd", "discovery.md"),
    "Scratch references: ADR-999 and MISSING-INV-99.\n",
  );

  const scratchOnly = runChecker(root);

  assert.equal(scratchOnly.status, 0, scratchOnly.stderr);

  writeFileSync(path.join(root, "notes.md"), "Product reference: MISSING-INV-99.\n");

  const productDocumentation = runChecker(root);

  assert.notEqual(productDocumentation.status, 0, productDocumentation.stdout);
  assert.match(productDocumentation.stderr, /missing documentation reference MISSING-INV-99/);
});

test("product documentation policy ignores historical and internal Markdown but validates reader-facing Markdown", () => {
  const root = writeProduct({ guaranteeStatus: "active" });
  for (const directory of ["docs/audits/run", "docs/superpowers/specs"]) {
    mkdirSync(path.join(root, directory), { recursive: true });
    writeFileSync(path.join(root, directory, "historical.md"), "Historical MISSING-INV-99.\n");
  }

  const ignored = runChecker(root);
  assert.equal(ignored.status, 0, ignored.stderr);

  writeFileSync(path.join(root, "notes.md"), "Reader-facing MISSING-INV-99.\n");
  const readerFacing = runChecker(root);
  assert.notEqual(readerFacing.status, 0, readerFacing.stdout);
  assert.match(readerFacing.stderr, /missing documentation reference MISSING-INV-99/);
});

test("product documentation policy ignores executable examples but validates surrounding prose", () => {
  const root = writeProduct({ guaranteeStatus: "active" });
  writeFileSync(
    path.join(root, "notes.md"),
    ["Executable tutorial:", "", "```bash", "ddduck query node --id MISSING-INV-99 --json", "```", ""].join("\n"),
  );

  const executableExample = runChecker(root);
  assert.equal(executableExample.status, 0, executableExample.stderr);

  writeFileSync(path.join(root, "notes.md"), "Reader-facing MISSING-INV-99.\n");
  const readerFacing = runChecker(root);
  assert.notEqual(readerFacing.status, 0, readerFacing.stdout);
  assert.match(readerFacing.stderr, /missing documentation reference MISSING-INV-99/);
});

test("product requires canonical slugs for structural identifiers", () => {
  const root = writeProduct({ guaranteeStatus: "active" });
  mkdirSync(path.join(root, "model", "concepts"), { recursive: true });
  mkdirSync(path.join(root, "model", "interfaces"), { recursive: true });
  mkdirSync(path.join(root, "model", "relationships"), { recursive: true });
  writeFileSync(
    path.join(root, "model", "use-cases", "create-reminder.yaml"),
    readFileSync(path.join(root, "model", "use-cases", "create-reminder.yaml"), "utf8").replace(
      "id: use-case:create-reminder",
      "id: use-case:Create_Reminder",
    ),
  );
  writeFileSync(
    path.join(root, "model", "concepts", "member.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Concept",
      "id: concept:Member_Record",
      "model: model:reminders",
      "ownerDomain: domain:members",
      "name: Member",
      "purpose: Identify a member.",
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, "model", "interfaces", "create-reminder.yaml"),
    [
      'schemaVersion: "1"',
      "kind: DomainInterface",
      "id: interface:Create_Reminder",
      "model: model:reminders",
      "ownerDomain: domain:members",
      "name: Create reminder",
      "operationKind: command",
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, "model", "relationships", "members.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Relationship",
      "id: rel:Members_Reminders",
      "model: model:reminders",
      "from: domain:members",
      "to: domain:members",
      "relationshipType: collaboration",
      "mode: synchronous",
      "ownedBy: domain:members",
    ].join("\n"),
  );

  const result = runChecker(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.equal((result.stderr.match(/schema validation failed at \/id: must match pattern/g) ?? []).length, 4);
});

test("product global ownership policy rejects mismatched and duplicate domain-owned facts", () => {
  const root = writeProduct({ guaranteeStatus: "active" });
  mkdirSync(path.join(root, "model", "concepts"), { recursive: true });
  mkdirSync(path.join(root, "model", "interfaces"), { recursive: true });
  writeFileSync(
    path.join(root, "model", "domains", "reminders.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Domain",
      "id: domain:reminders",
      "model: model:reminders",
      "name: Reminders",
      "purpose: Create reminders.",
      "concepts:",
      "  - concept:member",
      "interfaces:",
      "  - interface:create-reminder",
      "guarantees:",
      "  - MEMBERS-INV-01",
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, "product.yaml"),
    readFileSync(path.join(root, "product.yaml"), "utf8").replace(
      "  - domain:members",
      "  - domain:members\n  - domain:reminders",
    ),
  );
  writeFileSync(
    path.join(root, "model", "concepts", "member.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Concept",
      "id: concept:member",
      "model: model:reminders",
      "ownerDomain: domain:members",
      "name: Member",
      "purpose: Identify a member.",
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, "model", "interfaces", "create-reminder.yaml"),
    [
      'schemaVersion: "1"',
      "kind: DomainInterface",
      "id: interface:create-reminder",
      "model: model:reminders",
      "ownerDomain: domain:members",
      "name: Create reminder",
      "operationKind: command",
      "guarantees: []",
    ].join("\n"),
  );

  const result = runChecker(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /ownership mismatch: concept:member listed by domain:reminders/);
  assert.match(result.stderr, /ownership mismatch: interface:create-reminder listed by domain:reminders/);
  assert.match(result.stderr, /ownership mismatch: MEMBERS-INV-01 listed by domain:reminders/);
  assert.match(result.stderr, /owned by multiple domains: MEMBERS-INV-01/);
});

test("product rejects a use case that references a missing interface", () => {
  const root = writeProduct({ guaranteeStatus: "active" });
  writeFileSync(
    path.join(root, "model", "use-cases", "create-reminder.yaml"),
    readFileSync(path.join(root, "model", "use-cases", "create-reminder.yaml"), "utf8").replace(
      "success:",
      "interfaces:\n  - interface:missing\nsuccess:",
    ),
  );

  const result = runChecker(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /missing reference interface:missing in interfaces/);
});

test("product rejects an interface that references a retired guarantee", () => {
  const root = writeProduct({ guaranteeStatus: "retired" });
  mkdirSync(path.join(root, "model", "interfaces"), { recursive: true });
  writeFileSync(
    path.join(root, "model", "interfaces", "create-reminder.yaml"),
    [
      'schemaVersion: "1"',
      "kind: DomainInterface",
      "id: interface:create-reminder",
      "model: model:reminders",
      "ownerDomain: domain:members",
      "name: Create reminder",
      "operationKind: command",
      "guarantees:",
      "  - MEMBERS-INV-01",
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, "model", "domains", "members.yaml"),
    readFileSync(path.join(root, "model", "domains", "members.yaml"), "utf8").replace(
      "interfaces: []",
      "interfaces:\n  - interface:create-reminder",
    ),
  );
  writeFileSync(
    path.join(root, "model", "use-cases", "create-reminder.yaml"),
    [
      'schemaVersion: "1"',
      "kind: UseCase",
      "id: use-case:create-reminder",
      "model: model:reminders",
      "name: Create reminder",
      "goal: Create a reminder.",
      "preconditions:",
      "  requires: []",
      "success:",
      "  preserves: []",
      "  establishes: []",
    ].join("\n"),
  );

  const result = runChecker(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /non-effective guarantee MEMBERS-INV-01/);
});

test("product rejects Relationship and UseCase node files missing from the model listings", () => {
  const root = writeProduct({ guaranteeStatus: "active" });
  mkdirSync(path.join(root, "model", "relationships"), { recursive: true });
  writeFileSync(
    path.join(root, "model", "relationships", "members-members.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Relationship",
      "id: rel:members-members",
      "model: model:reminders",
      "from: domain:members",
      "to: domain:members",
      "relationshipType: collaboration",
      "mode: synchronous",
      "ownedBy: domain:members",
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, "product.yaml"),
    readFileSync(path.join(root, "product.yaml"), "utf8").replace(
      "useCases:\n  - use-case:create-reminder",
      "useCases: []",
    ),
  );

  const result = runChecker(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /model does not list node: rel:members-members in relationships/);
  assert.match(result.stderr, /model does not list node: use-case:create-reminder in useCases/);
});

test("product base comparison rejects a deleted historical guarantee", () => {
  const base = writeProduct({ guaranteeStatus: "active" });
  const current = writeProduct({ guaranteeStatus: "active" });
  unlinkSync(path.join(current, "model", "guarantees", "members-inv-01.yaml"));
  writeFileSync(
    path.join(current, "model", "domains", "members.yaml"),
    readFileSync(path.join(current, "model", "domains", "members.yaml"), "utf8").replace(
      "guarantees:\n  - MEMBERS-INV-01",
      "guarantees: []",
    ),
  );
  writeFileSync(
    path.join(current, "model", "use-cases", "create-reminder.yaml"),
    readFileSync(path.join(current, "model", "use-cases", "create-reminder.yaml"), "utf8")
      .replace("preconditions:\n  requires:\n    - MEMBERS-INV-01", "preconditions:\n  requires: []")
      .replace("  preserves:\n    - MEMBERS-INV-01", "  preserves: []"),
  );

  const result = runChecker(current, ["--base", base]);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /guarantee disappeared from the product/);
  assert.match(result.stderr, /MEMBERS-INV-01/);
});

test("Members and Reminders proving fixture validates with fresh generated output", () => {
  const fixtureRoot = path.join(frameworkRoot, "examples", "reminders", "ddd");
  const checked = runChecker(fixtureRoot);
  assert.equal(checked.status, 0, checked.stderr);

  const docs = spawnSync(
    process.execPath,
    [path.join(frameworkRoot, "scripts", "check-generated-docs.mjs"), "--root", fixtureRoot],
    {
      cwd: frameworkRoot,
      encoding: "utf8",
    },
  );
  assert.equal(docs.status, 0, docs.stderr);
  const overview = readFileSync(path.join(fixtureRoot, "generated", "docs", "model-overview.md"), "utf8");
  assert.match(overview, /## Use Cases/);
  assert.match(overview, /use-case:create-reminder/);
  assert.match(overview, /MEMBERS-INV-01/);
  assert.match(overview, /## Interfaces/);
  assert.match(overview, /Operation kind: `command`/);
  assert.match(overview, /- Interfaces: `interface:create-reminder`/);

  const graph = spawnSync(
    process.execPath,
    [path.join(frameworkRoot, "scripts", "check-generated-graph.mjs"), "--root", fixtureRoot],
    {
      cwd: frameworkRoot,
      encoding: "utf8",
    },
  );
  assert.equal(graph.status, 0, graph.stderr);
  const graphOutput = JSON.parse(
    readFileSync(path.join(fixtureRoot, "generated", "graph", "model-graph.json"), "utf8"),
  );
  assert.deepEqual(
    graphOutput.edges
      .filter((edge) => ["requires", "preserves", "establishes", "uses", "guarantees"].includes(edge.kind))
      .map((edge) => edge.id),
    [
      "edge:establishes|use-case:create-reminder|REMINDERS-AC-01",
      "edge:guarantees|interface:create-reminder|REMINDERS-INV-01",
      "edge:preserves|use-case:create-reminder|MEMBERS-INV-01",
      "edge:preserves|use-case:create-reminder|REMINDERS-INV-01",
      "edge:requires|use-case:create-reminder|MEMBERS-INV-01",
      "edge:uses|use-case:create-reminder|interface:create-reminder",
    ],
  );
});

function writeProduct({ guaranteeStatus, lifecycleDecision }) {
  const root = mkdtempSync(path.join(tmpdir(), "ddduck-product-check-"));
  mkdirSync(path.join(root, "model", "domains"), { recursive: true });
  mkdirSync(path.join(root, "model", "guarantees"), { recursive: true });
  mkdirSync(path.join(root, "model", "use-cases"), { recursive: true });
  mkdirSync(path.join(root, "decisions"), { recursive: true });
  writeFileSync(path.join(root, "decisions", "ADR-001-product.md"), "# ADR-001 - Product\n");
  writeFileSync(
    path.join(root, "product.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Model",
      "id: model:reminders",
      "name: Reminders",
      "purpose: Test product validation.",
      "domains:",
      "  - domain:members",
      "useCases:",
      "  - use-case:create-reminder",
      "decisions:",
      "  - ADR-001",
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, "model", "domains", "members.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Domain",
      "id: domain:members",
      "model: model:reminders",
      "name: Members",
      "purpose: Own members.",
      "guarantees:",
      "  - MEMBERS-INV-01",
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, "model", "guarantees", "members-inv-01.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Guarantee",
      "id: MEMBERS-INV-01",
      "model: model:reminders",
      "ownerDomain: domain:members",
      "classification: invariant",
      "statement: A member is active.",
      `status: ${guaranteeStatus}`,
      ...(lifecycleDecision ? [`lifecycleDecision: ${lifecycleDecision}`] : []),
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, "model", "use-cases", "create-reminder.yaml"),
    [
      'schemaVersion: "1"',
      "kind: UseCase",
      "id: use-case:create-reminder",
      "model: model:reminders",
      "name: Create reminder",
      "goal: Create a reminder for an active member.",
      "preconditions:",
      "  requires:",
      "    - MEMBERS-INV-01",
      "success:",
      "  preserves:",
      "    - MEMBERS-INV-01",
      "  establishes: []",
    ].join("\n"),
  );
  return root;
}

function runChecker(root, extraArgs = []) {
  return spawnSync(process.execPath, [checker, "--root", root, ...extraArgs], {
    cwd: frameworkRoot,
    encoding: "utf8",
  });
}
