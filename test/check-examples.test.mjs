import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { checkExamples, listExampleProducts } from "../tools/check-examples.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = path.join(root, "examples");
const script = path.join(root, "tools", "check-examples.mjs");

function copyExample(name) {
  const temporaryExamples = mkdtempSync(path.join(tmpdir(), "ddduck-examples-"));
  cpSync(path.join(examplesRoot, name), path.join(temporaryExamples, name), { recursive: true });
  return temporaryExamples;
}

test("every committed example product validates with fresh generated views", async () => {
  const results = await checkExamples(examplesRoot);

  assert.ok(results.length >= 3, "expected the committed example products");
  for (const { name, errors } of results) assert.deepEqual(errors, [], `examples/${name}`);
});

test("only example directories with ddd/product.yaml are product roots", () => {
  const names = listExampleProducts(examplesRoot).map(({ name }) => name);

  assert.ok(names.includes("reminders"));
  assert.ok(!names.includes("audit-reports"));
});

test("example Markdown resolves references against its own product, not the framework model", async () => {
  const temporaryExamples = copyExample("polymorphic-references");
  writeFileSync(
    path.join(temporaryExamples, "polymorphic-references", "notes.md"),
    "The party rule is `DEALS-INV-01`, carried by `rel:party-is-person`.\n",
  );

  const results = await checkExamples(temporaryExamples);

  assert.deepEqual(results, [{ name: "polymorphic-references", errors: [] }]);
});

test("an example README citing a nonexistent ID fails the examples gate", () => {
  const temporaryExamples = copyExample("reminders");
  writeFileSync(
    path.join(temporaryExamples, "reminders", "README.md"),
    "# Reminders\n\nThe refusal follows `REMINDERS-INV-99`.\n",
  );

  const result = spawnSync(process.execPath, [script, "--examples-root", temporaryExamples], { encoding: "utf8" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /examples\/reminders:/);
  assert.match(result.stderr, /README\.md: missing documentation reference REMINDERS-INV-99 on line 3/);
});

test("an example whose generated views are stale fails the examples gate", async () => {
  const temporaryExamples = copyExample("reminders");
  writeFileSync(path.join(temporaryExamples, "reminders", "ddd", "generated", "docs", "model-overview.md"), "stale\n");

  const results = await checkExamples(temporaryExamples);

  assert.equal(results.length, 1);
  assert.match(results[0].errors.join("\n"), /generated\/docs\/model-overview\.md is missing or stale/);
});

test("a directory without ddd/product.yaml is skipped", async () => {
  const temporaryExamples = mkdtempSync(path.join(tmpdir(), "ddduck-examples-"));
  mkdirSync(path.join(temporaryExamples, "loose-notes"), { recursive: true });
  writeFileSync(path.join(temporaryExamples, "loose-notes", "README.md"), "Mentions `domain:not-real`.\n");

  assert.deepEqual(await checkExamples(temporaryExamples), []);
});
