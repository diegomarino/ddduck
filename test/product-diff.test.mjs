import assert from "node:assert/strict";
import { readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { URL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { validateProduct } from "../scripts/check-model.mjs";
import { shellQuote, sourceDigestFromSources } from "../scripts/lib/context-pack.mjs";
import { detectProductLayout, loadProductNodes, loadProductSnapshot } from "../scripts/lib/product-layout.mjs";
import { createChangeReviewFixture, editFixtureNode } from "./helpers/change-review-fixture.mjs";

const api = await import("../scripts/lib/product-diff.mjs").catch((error) => {
  if (error.code !== "ERR_MODULE_NOT_FOUND" || !error.message.includes("product-diff.mjs")) throw error;
  return {};
});
const { compareProductSnapshots, compareProductRoots, renderProductDiff } = api;
const snapshot = (root) => loadProductSnapshot(detectProductLayout(root));

function files(root) {
  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const target = path.join(entry.parentPath, entry.name);
        return [path.relative(root, target), readFileSync(target).toString("base64")];
      }),
  );
}

test("exports the pure comparison, root report and text renderer", () => {
  for (const name of ["compareProductSnapshots", "compareProductRoots", "renderProductDiff"]) {
    assert.equal(typeof api[name], "function", name);
  }
});

test("matches a valid ownership move by stable ID without writing either root", (context) => {
  const { beforeRoot, afterRoot } = createChangeReviewFixture(context);
  assert.deepEqual(validateProduct(beforeRoot).errors, []);
  assert.deepEqual(validateProduct(afterRoot).errors, []);
  const original = [files(beforeRoot), files(afterRoot)];
  const report = compareProductRoots(beforeRoot, afterRoot);
  assert.deepEqual(report.added, []);
  assert.deepEqual(report.removed, []);
  assert.deepEqual(report.relocated, []);
  const moved = report.changed.find(({ id }) => id === "MEMBERS-AC-05");
  assert.ok(
    moved.changes.some(
      (change) =>
        change.path === "/ownerDomain" && change.before === "domain:members" && change.after === "domain:reminders",
    ),
  );
  assert.deepEqual(
    report.changed.map(({ id }) => id),
    ["MEMBERS-AC-05", "domain:members", "domain:reminders"],
  );
  assert.equal(report.schemaVersion, "1");
  assert.equal(report.kind, "ModelDiff");
  assert.equal(report.before.modelId, "model:members-reminders");
  assert.equal(report.scope, "canonical-yaml-only");
  assert.deepEqual(report.excludedScopes, ["decision-content", "evidence-content", "delivery-artifacts", "runtime"]);
  const loaded = loadProductNodes(detectProductLayout(beforeRoot));
  const sources = new Map(
    [...loaded.nodeSources].map(([id, bytes]) => [path.relative(beforeRoot, loaded.nodeFiles.get(id)), bytes]),
  );
  assert.equal(report.before.sourceDigest, sourceDigestFromSources(sources));
  assert.match(renderProductDiff(report), /MEMBERS-AC-05[\s\S]*\/ownerDomain/);
  assert.deepEqual([files(beforeRoot), files(afterRoot)], original);
  const schema = JSON.parse(readFileSync(new URL("../schemas/model-diff.schema.json", import.meta.url)));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
  const malformed = globalThis.structuredClone(report);
  delete malformed.changed[0].changes[0].beforePresent;
  assert.equal(validate(malformed), false);
});

test("ignores YAML formatting and key order while retaining byte digest differences", (context) => {
  const { beforeRoot } = createChangeReviewFixture(context);
  const before = snapshot(beforeRoot);
  const initial = compareProductRoots(beforeRoot, beforeRoot);
  const file = path.join(beforeRoot, "product.yaml");
  const source = readFileSync(file, "utf8");
  writeFileSync(file, `# Formatting only\n${source.replace('schemaVersion: "1"\n', "")}schemaVersion: '1'\n`);
  assert.deepEqual(compareProductSnapshots(before, snapshot(beforeRoot)), {
    added: [],
    removed: [],
    changed: [],
    relocated: [],
  });
  assert.notEqual(compareProductRoots(beforeRoot, beforeRoot).before.sourceDigest, initial.before.sourceDigest);
});

test("reports path-only relocation separately and can report a concurrent statement change", (context) => {
  const { beforeRoot } = createChangeReviewFixture(context);
  const before = snapshot(beforeRoot);
  renameSync(
    path.join(beforeRoot, "model/guarantees/members-ac-05.yaml"),
    path.join(beforeRoot, "model/guarantees/moved.yaml"),
  );
  const moved = compareProductSnapshots(before, snapshot(beforeRoot));
  assert.deepEqual(moved.changed, []);
  assert.deepEqual(moved.added, []);
  assert.deepEqual(moved.removed, []);
  assert.deepEqual(moved.relocated, [
    {
      id: "MEMBERS-AC-05",
      kind: "Guarantee",
      beforePath: "model/guarantees/members-ac-05.yaml",
      afterPath: "model/guarantees/moved.yaml",
    },
  ]);
  editFixtureNode(beforeRoot, "model/guarantees/moved.yaml", (node) => {
    node.statement = "A revised obligation.";
  });
  const changed = compareProductSnapshots(before, snapshot(beforeRoot));
  assert.equal(changed.relocated.length, 1);
  assert.deepEqual(changed.changed[0].changes, [
    {
      path: "/statement",
      beforePresent: true,
      afterPresent: true,
      before: "A member can receive a reminder.",
      after: "A revised obligation.",
    },
  ]);
});

test("includes removed lifecycle records without applying historical retention", (context) => {
  const { beforeRoot, afterRoot } = createChangeReviewFixture(context);
  rmSync(path.join(afterRoot, "model/guarantees/members-inv-00.yaml"));
  editFixtureNode(afterRoot, "model/domains/members.yaml", (node) => {
    node.guarantees = node.guarantees.filter((id) => id !== "MEMBERS-INV-00");
  });
  assert.deepEqual(validateProduct(afterRoot, { includeDocumentation: false }).errors, []);
  assert.ok(
    validateProduct(afterRoot, { baseRoot: beforeRoot, includeDocumentation: false }).errors.some((error) =>
      error.includes("disappeared"),
    ),
  );
  const report = compareProductRoots(beforeRoot, afterRoot);
  assert.equal(report.removed[0].id, "MEMBERS-INV-00");
  assert.equal(report.removed[0].node.status, "retired");
  assert.equal(compareProductRoots(afterRoot, beforeRoot).added[0].id, "MEMBERS-INV-00");
});

test("distinguishes missing from null, escapes pointers, ignores object order and preserves array order", () => {
  const model = { id: "model:test", kind: "Model" };
  const before = {
    nodes: [
      model,
      { id: "ITEM", kind: "Guarantee", nested: { "a/b~c": null }, order: [1, 2], object: { first: 1, second: 2 } },
    ],
    canonicalPaths: { ITEM: "item.yaml" },
  };
  const after = {
    nodes: [
      model,
      { id: "ITEM", kind: "Guarantee", nested: { added: null }, order: [2, 1], object: { second: 2, first: 1 } },
    ],
    canonicalPaths: { ITEM: "item.yaml" },
  };
  assert.deepEqual(compareProductSnapshots(before, after).changed[0].changes, [
    { path: "/nested/added", beforePresent: false, afterPresent: true, after: null },
    { path: "/nested/a~1b~0c", beforePresent: true, afterPresent: false, before: null },
    { path: "/order", beforePresent: true, afterPresent: true, before: [1, 2], after: [2, 1] },
  ]);
});

test("refuses different Model IDs", (context) => {
  const { beforeRoot } = createChangeReviewFixture(context);
  assert.throws(
    () => compareProductRoots(beforeRoot, new URL("../docs/ddd/", import.meta.url).pathname),
    /different Model IDs/i,
  );
});

test("refuses invalid roots with actionable quoted commands", (context) => {
  const { beforeRoot, afterRoot } = createChangeReviewFixture(context);
  writeFileSync(path.join(afterRoot, "product.yaml"), "kind: [broken\n");
  assert.throws(
    () => compareProductRoots(beforeRoot, afterRoot),
    (error) => {
      assert.match(error.message, /YAML/);
      assert.ok(error.nextAction.includes(`ddduck check --root ${shellQuote(afterRoot)}`));
      return true;
    },
  );
  assert.throws(
    () => compareProductRoots(path.join(beforeRoot, "missing"), afterRoot),
    (error) => Boolean(error.nextAction),
  );
});

test("refuses busy and interrupted roots without reclaiming state", (context) => {
  const { beforeRoot, afterRoot } = createChangeReviewFixture(context);
  const lock = path.join(beforeRoot, ".ddduck-operation.lock");
  writeFileSync(lock, `${process.pid}\n`);
  assert.throws(
    () => compareProductRoots(beforeRoot, afterRoot),
    (error) => error.exitCode === 2 && Boolean(error.nextAction),
  );
  writeFileSync(lock, "unknown\n");
  assert.throws(
    () => compareProductRoots(afterRoot, beforeRoot),
    (error) => {
      assert.match(error.message, /interrupted/);
      assert.ok(error.nextAction.includes(`ddduck generate --root ${shellQuote(beforeRoot)}`));
      return true;
    },
  );
  assert.equal(readFileSync(lock, "utf8"), "unknown\n");
});
