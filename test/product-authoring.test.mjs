import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parse, stringify } from "yaml";
import { buildAuthoringPlan } from "../scripts/lib/product-authoring.mjs";
import { detectProductLayout, loadProductSnapshot } from "../scripts/lib/product-layout.mjs";
import { runProductOperation } from "../scripts/lib/product-operation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "scripts/ddduck.mjs");

function fixture(context) {
  const directory = mkdtempSync(path.join(tmpdir(), "ddduck-authoring-"));
  cpSync(path.join(root, "examples/reminders/ddd"), directory, { recursive: true });
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function snapshot(directory) {
  return loadProductSnapshot(detectProductLayout(directory));
}

function invoke(directory, args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args, "--root", directory], {
    encoding: "utf8",
    ...options,
  });
}

function fileBytes(directory) {
  return Object.fromEntries(
    readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [path.relative(directory, file), readFileSync(file).toString("base64")];
      }),
  );
}

test("authoring plans update the owning collections without mutating snapshots", (context) => {
  const source = snapshot(fixture(context));
  const original = JSON.stringify(source);
  const domain = buildAuthoringPlan(source, {
    kind: "Domain",
    id: "domain:delivery",
    name: "Delivery",
    purpose: "Own delivery outcomes.",
  });
  assert.deepEqual(domain.affectedIds, ["domain:delivery", "model:members-reminders"]);
  assert.ok(domain.replacements.find(({ value }) => value.kind === "Model").value.domains.includes("domain:delivery"));

  const concept = buildAuthoringPlan(source, {
    kind: "Concept",
    id: "concept:participant",
    ownerDomain: "domain:members",
    name: "Participant",
    purpose: "Identify a person participating in the product.",
  });
  assert.deepEqual(concept.affectedIds, ["concept:participant", "domain:members"]);
  assert.ok(
    concept.replacements
      .find(({ value }) => value.id === "domain:members")
      .value.concepts.includes("concept:participant"),
  );
  assert.equal(JSON.stringify(source), original);
});

test("authoring refuses duplicate IDs, occupied canonical paths, invalid slugs and missing owners", (context) => {
  const source = snapshot(fixture(context));
  const request = {
    kind: "Concept",
    id: "concept:participant",
    ownerDomain: "domain:members",
    name: "Participant",
    purpose: "Identify a participant.",
  };
  assert.throws(() => buildAuthoringPlan(source, { ...request, id: "concept:member" }), /already exists/);
  assert.throws(() => buildAuthoringPlan(source, { ...request, id: "concept:../../outside" }), /Invalid.*ID/);
  assert.throws(() => buildAuthoringPlan(source, { ...request, ownerDomain: "domain:missing" }), /Unknown domain/);
  const occupied = {
    ...source,
    canonicalPaths: { ...source.canonicalPaths, "concept:member": "model/concepts/participant.yaml" },
  };
  assert.throws(() => buildAuthoringPlan(occupied, request), /already occupied/);
});

test("creation CLI maintains comments and complete freshness for domain, concept and use case", (context) => {
  const directory = fixture(context);
  const productPath = path.join(directory, "product.yaml");
  writeFileSync(productPath, `# Preserve product context\n${readFileSync(productPath, "utf8")}`);
  for (const args of [
    [
      "create",
      "domain",
      "--id",
      "domain:delivery",
      "--name",
      "Delivery",
      "--purpose",
      "Own delivery outcomes.",
      "--json",
    ],
    [
      "create",
      "concept",
      "--id",
      "concept:receipt",
      "--owner",
      "domain:delivery",
      "--name",
      "Receipt",
      "--purpose",
      "Describe delivery evidence.",
      "--json",
    ],
  ]) {
    const result = invoke(directory, args);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(
      JSON.parse(result.stdout).canonicalPaths.includes(
        args[1] === "domain" ? "product.yaml" : "model/domains/delivery.yaml",
      ),
    );
  }
  const input = path.join(directory, "new-use-case.txt");
  const node = {
    schemaVersion: "1",
    kind: "UseCase",
    id: "use-case:read-reminder",
    model: "model:members-reminders",
    name: "Read reminder",
    goal: "Read a reminder without changing assignment.",
    preconditions: { requires: [] },
    success: { preserves: ["REMINDERS-INV-01"], establishes: [] },
  };
  writeFileSync(input, stringify(node));
  const sourceBytes = readFileSync(input, "utf8");
  const created = invoke(directory, ["create", "use-case", "--file", input, "--json"]);
  assert.equal(created.status, 0, created.stderr);
  assert.deepEqual(parse(readFileSync(path.join(directory, "model/use-cases/read-reminder.yaml"), "utf8")), node);
  assert.equal(readFileSync(input, "utf8"), sourceBytes);
  assert.match(readFileSync(productPath, "utf8"), /^# Preserve product context/);
  assert.ok(parse(readFileSync(productPath, "utf8")).useCases.includes(node.id));
  const checked = invoke(directory, ["check"]);
  assert.equal(checked.status, 0, checked.stderr);
});

for (const scenario of [
  {
    kind: "Domain",
    parentPath: "product.yaml",
    collection: "domains",
    existingId: "domain:members",
    newId: "domain:delivery",
    request: { kind: "Domain", id: "domain:delivery", name: "Delivery", purpose: "Own delivery outcomes." },
  },
  {
    kind: "Concept",
    parentPath: "model/domains/members.yaml",
    collection: "concepts",
    existingId: "concept:member",
    newId: "concept:participant",
    request: {
      kind: "Concept",
      id: "concept:participant",
      ownerDomain: "domain:members",
      name: "Participant",
      purpose: "Identify a participant.",
    },
  },
  {
    kind: "UseCase",
    parentPath: "product.yaml",
    collection: "useCases",
    existingId: "use-case:create-reminder",
    newId: "use-case:read-reminder",
    request: {
      kind: "UseCase",
      node: {
        schemaVersion: "1",
        kind: "UseCase",
        id: "use-case:read-reminder",
        model: "model:members-reminders",
        name: "Read reminder",
        goal: "Read the assigned reminder.",
        preconditions: { requires: [] },
        success: { preserves: [], establishes: [] },
      },
    },
  },
]) {
  test(`creation preserves existing parent-list entry comments for ${scenario.kind}`, (context) => {
    const directory = fixture(context);
    const parentPath = path.join(directory, scenario.parentPath);
    const source = readFileSync(parentPath, "utf8");
    const commentedEntry = `  # Existing decision rationale\n  - ${scenario.existingId} # Preserve ownership explanation`;
    const annotated = source.replace(`  - ${scenario.existingId}`, commentedEntry);
    assert.notEqual(annotated, source);
    writeFileSync(parentPath, annotated);
    const previousIds = parse(annotated)[scenario.collection];

    runProductOperation({
      root: directory,
      transform: (sourceSnapshot) => buildAuthoringPlan(sourceSnapshot, scenario.request),
    });

    const published = readFileSync(parentPath, "utf8");
    assert.deepEqual(parse(published)[scenario.collection], [...previousIds, scenario.newId]);
    assert.ok(published.includes(commentedEntry), published);
    assert.ok(snapshot(directory).nodes.some(({ id }) => id === scenario.newId));
  });
}

test("invalid use-case inputs publish nothing and leave input files unchanged", (context) => {
  const directory = fixture(context);
  const input = path.join(directory, "new-use-case.txt");
  const valid = {
    schemaVersion: "1",
    kind: "UseCase",
    id: "use-case:read-reminder",
    model: "model:members-reminders",
    name: "Read reminder",
    goal: "Read the assigned reminder.",
    preconditions: { requires: [] },
    success: { preserves: [], establishes: [] },
  };
  for (const node of [
    { ...valid, model: "model:wrong" },
    { ...valid, kind: "Concept" },
    { ...valid, guessed: true },
    { ...valid, preconditions: { requires: ["MISSING-INV-01"] } },
  ]) {
    writeFileSync(input, stringify(node));
    const before = fileBytes(directory);
    const result = invoke(directory, ["create", "use-case", "--file", input]);
    assert.equal(result.status, 1, result.stdout);
    assert.deepEqual(fileBytes(directory), before);
  }
});

test("creation rejects invalid options and preserves occupied files", (context) => {
  const directory = fixture(context);
  const before = fileBytes(directory);
  for (const args of [
    [
      "create",
      "concept",
      "--id",
      "concept:member",
      "--owner",
      "domain:members",
      "--name",
      "Other",
      "--purpose",
      "Other",
    ],
    ["create", "domain", "--id", "domain:new", "--name", "New"],
    ["create", "concept", "--id", "concept:new", "--owner", "domain:absent", "--name", "New", "--purpose", "New"],
    ["create", "use-case", "--file"],
    ["create", "domain", "--unexpected", "value"],
  ]) {
    const result = invoke(directory, args);
    assert.equal(result.status, 1, result.stdout);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Next:/);
    assert.deepEqual(fileBytes(directory), before);
  }
});

test("creation respects a live product lock without changing source", (context) => {
  const directory = fixture(context);
  writeFileSync(path.join(directory, ".ddduck-operation.lock"), String(process.pid));
  const before = fileBytes(directory);
  const result = invoke(directory, [
    "create",
    "domain",
    "--id",
    "domain:delivery",
    "--name",
    "Delivery",
    "--purpose",
    "Own delivery.",
  ]);
  assert.equal(result.status, 2, result.stderr);
  assert.deepEqual(fileBytes(directory), before);
});
