import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const testDirectory = fileURLToPath(new URL(".", import.meta.url));
const root = path.resolve(testDirectory, "..");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const decisionsIndex = readFileSync(new URL("../docs/ddd/decisions/README.md", import.meta.url), "utf8");

test("package and README expose the ddduck identity", () => {
  assert.equal(testDirectory.endsWith("/test/"), true);
  assert.equal(packageJson.name, "ddduck");
  assert.deepEqual(packageJson.bin, { ddduck: "scripts/ddduck.mjs" });
  assert.doesNotMatch(readme, /\bddd check\b/);
  assert.match(readme, /\bddduck check\b/);
  assert.doesNotMatch(readme, /7f62e98/);
});

test("reader guides and accepted ADRs are findable", () => {
  for (const guide of [
    "getting-started",
    "model-reference",
    "architecture",
    "definition-workflow",
    "templates/change-brief",
  ]) {
    assert.ok(packageJson.files.includes(`docs/${guide}.md`));
    assert.ok(readFileSync(new URL(`../docs/${guide}.md`, import.meta.url), "utf8").length > 0);
  }
  assert.match(decisionsIndex, /ADR-007 - Guarantee Lifecycle Decision Anchoring/);
  assert.match(decisionsIndex, /ADR-008 - Delivery Adapter Boundary And Context Pack/);
});

test("reader guides preserve the safe authoring and model contracts", () => {
  const gettingStarted = readFileSync(new URL("../docs/getting-started.md", import.meta.url), "utf8");
  const cli = readFileSync(new URL("../docs/cli.md", import.meta.url), "utf8");
  const modelReference = readFileSync(new URL("../docs/model-reference.md", import.meta.url), "utf8");

  assert.match(gettingStarted, /ddduck check --root ddd --source-only/);
  assert.match(gettingStarted, /ddduck generate --root ddd/);
  assert.match(gettingStarted, /ddduck check --root ddd/);
  assert.match(cli, /one or more distinct\s+active successor IDs/i);
  assert.match(modelReference, /Optional\s+top-level fields include `nameStatus`/);
  assert.match(modelReference, /`preconditions\.requires` is required/);
});

test("reader examples do not introduce unresolved structural references", () => {
  const structuralReference =
    /\b(?:(?:model|domain|concept|rel|rule|use-case|interface):[a-z0-9][a-z0-9-]*|[A-Z][A-Z0-9-]+-(?:INV|AC)-[0-9]+)\b/g;
  for (const guide of ["model-reference"]) {
    const source = readFileSync(new URL(`../docs/${guide}.md`, import.meta.url), "utf8");
    assert.deepEqual(source.match(structuralReference) ?? [], [], guide);
  }
});

test("npm pack ships only the public runtime surface", () => {
  const cache = mkdtempSync(path.join(tmpdir(), "ddduck-npm-pack-test-"));
  try {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: cache },
    });
    assert.equal(result.status, 0, result.stderr);

    // npm <= 11 prints an array of packages; npm 12 prints an object keyed by package name.
    const parsed = JSON.parse(result.stdout);
    const entries = Array.isArray(parsed) ? parsed : Object.values(parsed);
    assert.equal(entries.length, 1, result.stdout);
    const paths = entries[0].files.map(({ path: filePath }) => filePath).sort();
    const allowedPath =
      /^(README\.md|LICENSE|package\.json|docs\/(architecture|cli|getting-started|model|model-reference|definition-workflow|templates\/change-brief)\.md|scripts\/.+|schemas\/.+|policies\/.+|skills\/update-ddduck-specs\/.+)$/;
    const prohibitedPath =
      /^(draft\/|\.superpowers\/|\.worktrees\/|node_modules\/|examples\/|docs\/ddd\/|decisions\/|evals\/|generated\/|model\/|rules\/|test\/)/;

    assert.deepEqual(
      paths.filter((filePath) => prohibitedPath.test(filePath)),
      [],
    );
    assert.deepEqual(
      paths.filter((filePath) => !allowedPath.test(filePath)),
      [],
    );
    assert.ok(paths.includes("scripts/ddduck.mjs"));
    assert.ok(!paths.includes("scripts/ddd.mjs"));
    assert.ok(paths.includes("scripts/check-model.mjs"));
    assert.ok(paths.includes("scripts/lib/product-layout.mjs"));
    assert.ok(paths.includes("docs/cli.md"));
    assert.ok(paths.includes("docs/model.md"));
    assert.ok(paths.includes("docs/getting-started.md"));
    assert.ok(paths.includes("docs/model-reference.md"));
    assert.ok(paths.includes("docs/architecture.md"));
    assert.ok(paths.includes("docs/definition-workflow.md"));
    assert.ok(paths.includes("docs/templates/change-brief.md"));
    assert.ok(paths.includes("skills/update-ddduck-specs/SKILL.md"));
    assert.ok(paths.includes("skills/update-ddduck-specs/references/modeling-and-evidence.md"));
    assert.ok(paths.includes("skills/update-ddduck-specs/references/reviewing-changes.md"));
    assert.ok(!paths.some((filePath) => filePath.startsWith("tools/")));
    // Every published script must be part of the runtime: reachable from the bin
    // entry point. Maintainer-only tools live in tools/, which is not published.
    const runtime = runtimeScriptClosure(path.join(root, packageJson.bin.ddduck));
    assert.deepEqual(
      paths.filter((filePath) => filePath.startsWith("scripts/") && !runtime.has(filePath)),
      [],
    );
    assert.ok(paths.includes("skills/update-ddduck-specs/references/authoring-and-verification.md"));
    assert.ok(paths.includes("schemas/product/model.schema.json"));
    assert.ok(paths.includes("policies/policy-spec.schema.json"));
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

test("shipped scripts import only runtime dependencies or node builtins", () => {
  const runtimeDependencies = new Set(Object.keys(packageJson.dependencies ?? {}));
  const importPattern = /^\s*import\s[^;]*?\sfrom\s+["']([^"']+)["']/gm;
  const offenders = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (entry.name.endsWith(".mjs")) {
        const source = readFileSync(entryPath, "utf8");
        for (const match of source.matchAll(importPattern)) {
          const specifier = match[1];
          if (specifier.startsWith("node:") || specifier.startsWith(".")) continue;
          const packageName = specifier.startsWith("@")
            ? specifier.split("/").slice(0, 2).join("/")
            : specifier.split("/")[0];
          if (!runtimeDependencies.has(packageName)) {
            offenders.push(`${path.relative(root, entryPath)} imports ${specifier}`);
          }
        }
      }
    }
  };
  walk(path.join(root, "scripts"));
  assert.deepEqual(offenders, []);
});

// Relative module imports (static and dynamic) plus string literals naming an
// existing file below scripts/ (spawned scripts, JSON data), followed
// transitively from the entry point. Returns repo-relative POSIX paths.
function runtimeScriptClosure(entryPoint) {
  const scriptsRoot = path.join(root, "scripts");
  const reached = new Set();
  const pending = [entryPoint];
  while (pending.length > 0) {
    const filePath = pending.pop();
    const relativePath = path.relative(root, filePath).split(path.sep).join("/");
    if (reached.has(relativePath)) continue;
    reached.add(relativePath);
    if (!filePath.endsWith(".mjs")) continue;
    const source = readFileSync(filePath, "utf8");
    for (const [, specifier] of source.matchAll(/["'](\.{1,2}\/[^"'\s]+|[\w-]+(?:\/[\w-]+)*\.(?:mjs|json))["']/g)) {
      const candidates = [path.resolve(path.dirname(filePath), specifier), path.resolve(scriptsRoot, specifier)];
      const target = candidates.find(
        (candidate) =>
          candidate.startsWith(scriptsRoot + path.sep) && existsSync(candidate) && statSync(candidate).isFile(),
      );
      if (target) pending.push(target);
    }
  }
  return reached;
}
