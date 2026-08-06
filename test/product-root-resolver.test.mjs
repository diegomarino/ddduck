import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveProductRoot } from "../scripts/lib/product-root-resolver.mjs";

test("explicit root wins over config and discovery", () => {
  const repo = makeRepo();
  const explicit = makeProduct(repo, "explicit", "model:explicit");
  makeProduct(repo, "docs/ddd", "model:configured");
  writeConfig(repo, "docs/ddd");

  assert.equal(resolveProductRoot({ cwd: repo, explicitRoot: explicit }), realpathSync(explicit));
});

test("config resolves the repository product root", () => {
  const repo = makeRepo();
  const configured = makeProduct(repo, "docs/ddd", "model:configured");
  writeConfig(repo, "docs/ddd");

  assert.equal(resolveProductRoot({ cwd: repo }), realpathSync(configured));
});

test("an enclosing product root outranks the configured product root", () => {
  const repo = makeRepo();
  makeProduct(repo, "docs/ddd", "model:configured");
  const enclosing = makeProduct(repo, "examples/demo", "model:demo");
  writeConfig(repo, "docs/ddd");

  assert.equal(resolveProductRoot({ cwd: path.join(enclosing, "model") }), realpathSync(enclosing));
});

test("nested cwd resolves its enclosing product root", () => {
  const repo = makeRepo();
  const product = makeProduct(repo, "docs/ddd", "model:nested");
  const nested = path.join(product, "model", "domains");

  assert.equal(resolveProductRoot({ cwd: nested }), realpathSync(product));
});

test("a single primary product is discovered even when examples exist", () => {
  const repo = makeRepo();
  const primary = makeProduct(repo, "docs/ddd", "model:primary");
  makeProduct(repo, "examples/reminders/ddd", "model:example");

  assert.equal(resolveProductRoot({ cwd: repo }), realpathSync(primary));
});

test("multiple primary products require an explicit root", () => {
  const repo = makeRepo();
  makeProduct(repo, "ddd", "model:first");
  makeProduct(repo, "docs/ddd", "model:second");

  assert.throws(() => resolveProductRoot({ cwd: repo }), /Multiple ddduck product roots found.*--root/s);
});

test("discovery keeps shaped-but-invalid candidates and flags them in the ambiguity error", () => {
  const repo = makeRepo();
  makeProduct(repo, "products/alpha", "model:alpha");
  const beta = makeProduct(repo, "products/beta", "model:beta");
  breakProduct(beta);

  assert.throws(
    () => resolveProductRoot({ cwd: repo }),
    (error) => {
      assert.match(error.message, /Multiple ddduck product roots found.*--root/s);
      assert.match(error.message, /products\/alpha/);
      assert.match(error.message, /products\/beta \(fails validation\)/);
      return true;
    },
  );
});

test("a single shaped-but-invalid root resolves so the command's own validation reports", () => {
  const repo = makeRepo();
  const solo = makeProduct(repo, "p1", "model:solo");
  breakProduct(solo);

  assert.equal(resolveProductRoot({ cwd: repo }), realpathSync(solo));
});

test("a sole example candidate outside the cwd is named instead of reported as not found", () => {
  const repo = makeRepo();
  const example = makeProduct(repo, "examples/reminders/ddd", "model:example");

  assert.throws(
    () => resolveProductRoot({ cwd: repo }),
    (error) => {
      assert.match(error.message, /No ddduck product root selected/);
      assert.ok(error.message.includes(realpathSync(example)), error.message);
      assert.match(error.message, /example candidate/);
      assert.match(error.message, /--root/);
      return true;
    },
  );
});

test("test fixtures are ignored unless explicitly selected", () => {
  const repo = makeRepo();
  const fixture = makeProduct(repo, "test/fixtures/product/ddd", "model:fixture");

  assert.throws(() => resolveProductRoot({ cwd: repo }), /No ddduck product root found/);
  assert.equal(resolveProductRoot({ cwd: repo, explicitRoot: fixture }), realpathSync(fixture));
});

test("interrupted-init staging debris is excluded from discovery and enclosing-root detection", () => {
  const repo = makeRepo();
  const primary = makeProduct(repo, "ddd", "model:primary");
  const debris = makeProduct(repo, ".ddduck-init-stage-a1B2c3", "model:primary");

  assert.equal(resolveProductRoot({ cwd: repo }), realpathSync(primary));
  assert.equal(resolveProductRoot({ cwd: path.join(debris, "model") }), realpathSync(primary));
});

test("invalid configured roots report that root and do not fall back", () => {
  const repo = makeRepo();
  const invalid = path.join(repo, "docs", "ddd");
  mkdirSync(path.join(invalid, "model"), { recursive: true });
  writeFileSync(path.join(invalid, "product.yaml"), "kind: NotAModel\n");
  makeProduct(repo, "ddd", "model:fallback");
  writeConfig(repo, "docs/ddd");

  assert.throws(() => resolveProductRoot({ cwd: repo }), /Configured product root is invalid.*docs\/ddd/s);
});

test("broken config JSON names the config file in the failure", () => {
  const repo = makeRepo();
  makeProduct(repo, "docs/ddd", "model:broken-config");
  mkdirSync(path.join(repo, ".ddduck"), { recursive: true });
  writeFileSync(path.join(repo, ".ddduck", "config.json"), "{oops\n");

  assert.throws(() => resolveProductRoot({ cwd: repo }), /\.ddduck\/config\.json: invalid JSON/);
});

test("configured roots must not resolve through a symlink outside the repository", () => {
  const repo = makeRepo();
  const external = makeProduct(mkdtempSync(path.join(tmpdir(), "ddduck-external-product-")), "ddd", "model:external");
  mkdirSync(path.join(repo, "docs"), { recursive: true });
  symlinkSync(external, path.join(repo, "docs", "ddd"));
  writeConfig(repo, "docs/ddd");

  assert.throws(() => resolveProductRoot({ cwd: repo }), /productRoot must stay inside the repository/);
});

test("discovery still finds products when the repository root has a dot-prefixed name", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "ddduck-dot-root-"));
  const repo = path.join(parent, ".scratch");
  mkdirSync(path.join(repo, ".git"), { recursive: true });
  const product = makeProduct(repo, "ddd", "model:dotted-root");

  assert.equal(resolveProductRoot({ cwd: repo }), realpathSync(product));
});

function makeRepo() {
  const repo = mkdtempSync(path.join(tmpdir(), "ddduck-root-resolver-"));
  mkdirSync(path.join(repo, ".git"));
  return repo;
}

function makeProduct(repo, relativeRoot, modelId) {
  const product = path.join(repo, relativeRoot);
  mkdirSync(path.join(product, "model", "domains"), { recursive: true });
  mkdirSync(path.join(product, "decisions"), { recursive: true });
  writeFileSync(
    path.join(product, "product.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Model",
      `id: ${modelId}`,
      `name: ${modelId.slice("model:".length)}`,
      "purpose: Test product.",
      "domains: []",
      "useCases: []",
      "decisions: []",
      "",
    ].join("\n"),
  );
  return product;
}

function breakProduct(product) {
  const productPath = path.join(product, "product.yaml");
  writeFileSync(productPath, readFileSync(productPath, "utf8").replace("domains: []", "domains:\n  - domain:ghost"));
}

function writeConfig(repo, productRoot) {
  mkdirSync(path.join(repo, ".ddduck"), { recursive: true });
  writeFileSync(
    path.join(repo, ".ddduck", "config.json"),
    `${JSON.stringify({ schemaVersion: "1", productRoot }, null, 2)}\n`,
  );
}
