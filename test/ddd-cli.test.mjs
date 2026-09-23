import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "scripts", "ddduck.mjs");

test("renders top-level help without diagnostics", () => {
  const result = runDdd(["--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: ddduck/);
  assert.match(result.stdout, /--version/, "the command overview must list the version flag");
  assert.equal(result.stderr, "");
});

test("reports the package version through both version flags", () => {
  const { name, version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

  for (const flag of ["--version", "-v"]) {
    const result = runDdd([flag]);

    assert.equal(result.status, 0, `${flag}: ${result.stderr}`);
    assert.equal(result.stdout, `${name} ${version}\n`);
    assert.equal(result.stderr, "");
  }
});

test("version reports one JSON object with --json", () => {
  const { name, version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

  for (const flag of ["--version", "-v"]) {
    const result = runDdd([flag, "--json"]);

    assert.equal(result.status, 0, `${flag}: ${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout), { name, version });
    assert.equal(result.stderr, "");
  }
});

test("version rejects unknown options and points at its own help", () => {
  const result = runDdd(["--version", "--bogus"]);

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown option --bogus/);
  assert.match(result.stderr, /Next: Run ddduck --version --help/);
});

test("check help documents the source-only freshness escape hatch", () => {
  const result = runDdd(["check", "--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--source-only/);
  assert.equal(result.stderr, "");
});

test("every built-in command help documents its complete operational contract", () => {
  for (const command of [
    "init",
    "check",
    "generate",
    "query",
    "diff",
    "install",
    "create",
    "move",
    "split",
    "retire",
    "--version",
    "-v",
  ]) {
    const result = runDdd([command, "--help"]);

    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.equal(result.stderr, "");
    for (const label of ["Syntax:", "Defaults:", "Writes:", "Success output:", "Exit status:", "JSON:"]) {
      assert.match(result.stdout, new RegExp(`^${label}`, "m"), `${command} help is missing ${label}`);
    }
    assert.match(result.stdout, /--json|JSON: unavailable/, `${command} help must state its --json contract`);
    assert.doesNotMatch(
      result.stdout,
      /--root is the current directory/,
      `${command} help must not misstate root resolution`,
    );
  }
});

test("subcommand help requests print command help instead of failing", () => {
  const result = runDdd(["query", "node", "--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Syntax: ddduck query/);
  assert.equal(result.stderr, "");
});

test("rejects unknown, duplicate, and valueless command options without a stack trace", () => {
  const destination = mkdtempSync(path.join(tmpdir(), "ddduck-cli-contract-"));
  const cases = [
    [["generate", "--rot", destination], /Unknown option --rot/],
    [["generate", "--root", destination, "--root", destination], /Duplicate option --root/],
    [["generate", "--root"], /Missing value for --root/],
  ];

  for (const [args, expected] of cases) {
    const result = runDdd(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
    assert.doesNotMatch(result.stderr, /file:\/\/|\bat .*\.mjs:/);
    assert.equal(result.stdout, "");
  }
});

test("serializes a failed checker invocation as one safe CLI error", () => {
  const missingRoot = path.join(tmpdir(), `ddduck-missing-root-${process.pid}`);
  const result = runDdd(["check", "--root", missingRoot]);

  assert.notEqual(result.status, 0);
  assert.equal(result.stderr.trim().split("\n").length, 1, result.stderr);
  assert.match(result.stderr, /Explicit product root is invalid/);
  assert.match(result.stderr, /Next: Run ddduck check --help/);
  assert.doesNotMatch(result.stderr, /file:\/\/|\bat .*\.mjs:/);
});

test("check rejects stale generated views unless source-only is requested", () => {
  const destination = makeProductFixture();
  writeFileSync(path.join(destination, "generated", "docs", "model-overview.md"), "stale\n");

  const staleDocs = runDdd(["check", "--root", destination]);
  assert.notEqual(staleDocs.status, 0, staleDocs.stdout);
  assert.match(staleDocs.stderr, /generated\/docs\/model-overview\.md is missing or stale/);
  assert.match(staleDocs.stderr, /run ddduck generate --root /i);
  assert.doesNotMatch(staleDocs.stderr, /npm run/);
  assert.match(staleDocs.stderr, /Next: Run ddduck generate --root /);
  assert.doesNotMatch(staleDocs.stderr, /correct the input/);
  assert.equal(
    staleDocs.stderr.match(/run ddduck generate --root /gi).length,
    1,
    `the remedy must appear exactly once (in Next:): ${staleDocs.stderr}`,
  );

  const sourceOnlyDocs = runDdd(["check", "--root", destination, "--source-only"]);
  assert.equal(sourceOnlyDocs.status, 0, sourceOnlyDocs.stderr);

  runDdd(["generate", "--root", destination]);
  writeFileSync(path.join(destination, "generated", "graph", "model-graph.json"), "{}\n");

  const staleGraph = runDdd(["check", "--root", destination]);
  assert.notEqual(staleGraph.status, 0, staleGraph.stdout);
  assert.match(staleGraph.stderr, /generated\/graph\/model-graph\.json is missing or stale/);

  const sourceOnlyGraph = runDdd(["check", "--root", destination, "--source-only"]);
  assert.equal(sourceOnlyGraph.status, 0, sourceOnlyGraph.stderr);
});

test("check accepts repeatable --docs-root paths to widen documentation-reference scope", () => {
  const destination = makeProductFixture();
  assert.equal(runDdd(["generate", "--root", destination]).status, 0);
  const externalDocs = mkdtempSync(path.join(tmpdir(), "ddduck-docs-root-"));
  writeFileSync(path.join(externalDocs, "guide.md"), "See concept:ghost for details.\n");

  const defaultScope = runDdd(["check", "--root", destination]);
  assert.equal(defaultScope.status, 0, defaultScope.stderr);

  const widened = runDdd(["check", "--root", destination, "--docs-root", externalDocs, "--docs-root", destination]);
  assert.notEqual(widened.status, 0, widened.stdout);
  assert.match(widened.stderr, /missing documentation reference concept:ghost/);
});

test("check reports a checker spawn failure instead of a TypeError", () => {
  const destination = makeProductFixture();
  const preloadDirectory = mkdtempSync(path.join(tmpdir(), "ddduck-spawn-fault-"));
  const preloadPath = path.join(preloadDirectory, "fail-spawn.cjs");
  writeFileSync(
    preloadPath,
    [
      'const childProcess = require("node:child_process");',
      "childProcess.spawnSync = () => ({",
      "  pid: 0,",
      "  output: [null, null, null],",
      "  stdout: null,",
      "  stderr: null,",
      "  status: null,",
      "  signal: null,",
      '  error: Object.assign(new Error("spawnSync node ENOENT"), { code: "ENOENT" }),',
      "});",
      "",
    ].join("\n"),
  );

  const result = spawnSync(process.execPath, ["--require", preloadPath, cli, "check", "--root", destination], {
    cwd: root,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /Cannot read properties of null/);
  assert.match(result.stderr, /spawnSync node ENOENT/);
});

test("check --source-only ignores stale generated-view references after a destructive source edit", () => {
  const destination = makeProductFixture();
  assert.equal(runDdd(["generate", "--root", destination]).status, 0);

  rmSync(path.join(destination, "model", "domains", "reminders.yaml"));
  const productPath = path.join(destination, "product.yaml");
  writeFileSync(productPath, readFileSync(productPath, "utf8").replace("\n  - domain:reminders", ""));

  const sourceOnly = runDdd(["check", "--root", destination, "--source-only"]);
  assert.equal(sourceOnly.status, 0, sourceOnly.stderr);

  const full = runDdd(["check", "--root", destination]);
  assert.notEqual(full.status, 0, full.stdout);
  assert.match(full.stderr, /missing documentation reference domain:reminders/);

  assert.equal(runDdd(["generate", "--root", destination]).status, 0);
  assert.equal(runDdd(["check", "--root", destination]).status, 0);

  writeFileSync(path.join(destination, "notes.md"), "See concept:ghost for details.\n");
  const canonicalDocs = runDdd(["check", "--root", destination, "--source-only"]);
  assert.notEqual(canonicalDocs.status, 0, canonicalDocs.stdout);
  assert.match(canonicalDocs.stderr, /missing documentation reference concept:ghost/);
});

test("generate rejects a product with a second schema-valid Model node", () => {
  const destination = makeProductFixture();
  writeFileSync(
    path.join(destination, "model", "domains", "second-model.yaml"),
    readFileSync(path.join(destination, "product.yaml"), "utf8").replace("id: model:sample", "id: model:other"),
  );

  const generated = runDdd(["generate", "--root", destination]);

  assert.notEqual(generated.status, 0, generated.stdout);
  assert.match(generated.stderr, /expected exactly one Model node, found 2/);
});

test("generate refuses a generated directory symlink without writing outside the product", () => {
  const destination = makeProductFixture();
  const externalDirectory = mkdtempSync(path.join(tmpdir(), "ddduck-cli-generate-external-"));
  rmSync(path.join(destination, "generated"), { recursive: true, force: true });
  symlinkSync(externalDirectory, path.join(destination, "generated"));

  const generated = runDdd(["generate", "--root", destination]);

  assert.notEqual(generated.status, 0, generated.stdout);
  assert.equal(existsSync(path.join(externalDirectory, "docs", "model-overview.md")), false);
  assert.equal(existsSync(path.join(externalDirectory, "graph", "model-graph.json")), false);
});

test("init creates a valid product directory with fresh derived output", () => {
  const destination = mkdtempSync(path.join(tmpdir(), "ddduck-init-"));
  const result = runDdd(["init", destination, "--id", "model:sample"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(path.join(destination, "product.yaml"), "utf8"), /schemaVersion: "1"/);
  assert.ok(existsSync(path.join(destination, "generated", "graph", "model-graph.json")));
});

test("an interrupted init leaves no partial destination and the retry succeeds", async () => {
  const parent = mkdtempSync(path.join(tmpdir(), "ddduck-init-interrupt-"));

  for (const killDelay of [30, 40, 50, 55, 60, 70, 80]) {
    const destination = path.join(parent, `ddd-${killDelay}`);
    const child = spawn(process.execPath, [cli, "init", destination, "--id", "model:sample"]);
    const closed = new Promise((resolve) => child.on("close", resolve));
    await delay(killDelay);
    child.kill("SIGKILL");
    await closed;

    if (existsSync(path.join(destination, "generated", "graph", "model-graph.ndjson"))) continue;
    assert.equal(
      existsSync(destination),
      false,
      `init killed after ${killDelay}ms left a partial destination: ${existsSync(destination) ? readdirSync(destination).join(", ") : ""}`,
    );
    const retry = runDdd(["init", destination, "--id", "model:sample"]);
    assert.equal(retry.status, 0, retry.stderr);
    assert.ok(existsSync(path.join(destination, "generated", "graph", "model-graph.ndjson")));
  }
});

test("interrupted-init staging debris never poisons no-root commands and the next init sweeps it", () => {
  const repository = makeRepositoryShell("ddduck-init-debris-");
  const debris = path.join(repository, ".ddduck-init-stage-ddd-leftover");
  mkdirSync(path.join(debris, "model", "domains"), { recursive: true });
  mkdirSync(path.join(debris, "decisions"), { recursive: true });
  writeFileSync(
    path.join(debris, "product.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Model",
      "id: model:demo",
      "name: demo",
      "purpose: Define this product.",
      "domains: []",
      "useCases: []",
      "decisions: []",
      "",
    ].join("\n"),
  );

  const foreignStage = path.join(repository, ".ddduck-init-stage-other-live");
  mkdirSync(path.join(foreignStage, "model"), { recursive: true });

  const initialized = runDdd(["init", "ddd", "--id", "model:demo"], repository);
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(existsSync(debris), false, "init must sweep its own destination's staging debris");
  assert.equal(
    existsSync(foreignStage),
    true,
    "init must not sweep staging directories belonging to other destinations",
  );
  rmSync(foreignStage, { recursive: true, force: true });

  mkdirSync(debris);
  writeFileSync(path.join(debris, "product.yaml"), readFileSync(path.join(repository, "ddd", "product.yaml")));
  mkdirSync(path.join(debris, "model"));
  const generated = runDdd(["generate"], repository);
  assert.equal(generated.status, 0, generated.stderr);
  const checked = runDdd(["check"], repository);
  assert.equal(checked.status, 0, checked.stderr);
});

test("init sweeps same-destination staging only when its creating process is dead", () => {
  const repository = makeRepositoryShell("ddduck-init-live-stage-");
  const liveHolder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"]);
  try {
    const deadProbe = spawnSync(process.execPath, ["-e", ""]);
    const liveStage = path.join(repository, `.ddduck-init-stage-ddd-${liveHolder.pid}-live00`);
    const deadStage = path.join(repository, `.ddduck-init-stage-ddd-${deadProbe.pid}-dead00`);
    mkdirSync(path.join(liveStage, "model"), { recursive: true });
    mkdirSync(path.join(deadStage, "model"), { recursive: true });

    const initialized = runDdd(["init", "ddd", "--id", "model:demo"], repository);
    assert.equal(initialized.status, 0, initialized.stderr);
    assert.equal(
      existsSync(liveStage),
      true,
      "init must not sweep a same-destination staging directory whose creating process is alive",
    );
    assert.equal(existsSync(deadStage), false, "init must still sweep same-destination staging left by a dead process");
  } finally {
    liveHolder.kill("SIGKILL");
  }
});

test("install skill defaults --repo to the current directory", () => {
  const destination = mkdtempSync(path.join(tmpdir(), "ddduck-install-cli-"));
  const result = spawnSync(process.execPath, [cli, "install", "skill", "update-ddduck-specs"], {
    cwd: destination,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    `install skill update-ddduck-specs (created) in ${realpathSync(destination)}; canonical: .agents/skills/update-ddduck-specs/SKILL.md; lock: .ddduck/agent-skills.lock.json\n`,
  );
  assert.ok(existsSync(path.join(destination, ".agents", "skills", "update-ddduck-specs", "SKILL.md")));
});

test("install skill reports created and no-op runs distinguishably", () => {
  const destination = mkdtempSync(path.join(tmpdir(), "ddduck-install-cli-result-"));
  const created = runDdd(["install", "skill", "update-ddduck-specs", "--repo", destination]);

  assert.equal(created.status, 0, created.stderr);
  assert.match(created.stdout, /^install skill update-ddduck-specs \(created\) in /);
  assert.match(
    created.stdout,
    /; canonical: \.agents\/skills\/update-ddduck-specs\/SKILL\.md; lock: \.ddduck\/agent-skills\.lock\.json\n$/,
  );

  const repeated = runDdd(["install", "skill", "update-ddduck-specs", "--repo", destination]);

  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(repeated.stdout, /^install skill update-ddduck-specs \(no-op\) in /);
  assert.equal(repeated.stdout.trim().split("\n").length, 1);
});

test("install skill rejects a nonexistent --repo without creating anything", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "ddduck-install-missing-repo-"));
  const missingRepo = path.join(parent, "no-such-repo-typo");

  const result = runDdd(["install", "skill", "update-ddduck-specs", "--repo", missingRepo]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Error: install requires an existing repository directory/);
  assert.match(result.stderr, /Next: /);
  assert.equal(existsSync(missingRepo), false, "install must not manufacture the missing repository");

  const filePath = path.join(parent, "a-file");
  writeFileSync(filePath, "not a directory\n");
  const fileResult = runDdd(["install", "skill", "update-ddduck-specs", "--repo", filePath]);
  assert.notEqual(fileResult.status, 0);
  assert.match(fileResult.stderr, /install requires an existing repository directory/);
});

test("install skill rejects unsupported mutation and host options", () => {
  const destination = mkdtempSync(path.join(tmpdir(), "ddduck-install-cli-options-"));
  const result = runDdd(["install", "skill", "update-ddduck-specs", "--force", "yes", "--repo", destination]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown option --force/);
  assert.equal(existsSync(path.join(destination, ".agents", "skills", "update-ddduck-specs", "SKILL.md")), false);
});

test("init reports canonical and generated paths in text and JSON", () => {
  const textDestination = mkdtempSync(path.join(tmpdir(), "ddduck-init-result-text-"));
  const textResult = runDdd(["init", textDestination, "--id", "model:text-result"]);

  assert.equal(textResult.status, 0, textResult.stderr);
  assert.equal(
    textResult.stdout,
    `init model:text-result in ${realpathSync(textDestination)}; canonical: product.yaml; generated: generated/docs/model-overview.md, generated/graph/model-graph.json, generated/graph/model-graph.ndjson, generated/graph/model-graph.svg; config: ${path.join(textDestination, ".ddduck", "config.json")} (created)\n`,
  );

  const jsonDestination = mkdtempSync(path.join(tmpdir(), "ddduck-init-result-json-"));
  const jsonResult = runDdd(["init", jsonDestination, "--id", "model:json-result", "--json"]);

  assert.equal(jsonResult.status, 0, jsonResult.stderr);
  assert.equal(jsonResult.stderr, "");
  assert.deepEqual(JSON.parse(jsonResult.stdout), {
    operation: "init",
    root: realpathSync(jsonDestination),
    affectedIds: ["model:json-result"],
    canonicalPaths: ["product.yaml"],
    generatedPaths: [
      "generated/docs/model-overview.md",
      "generated/graph/model-graph.json",
      "generated/graph/model-graph.ndjson",
      "generated/graph/model-graph.svg",
    ],
    configPath: path.join(jsonDestination, ".ddduck", "config.json"),
  });
});

test("an invalid product ID error teaches the expected format with an example", () => {
  const destination = mkdtempSync(path.join(tmpdir(), "ddduck-invalid-id-"));

  const result = runDdd(["init", destination, "--id", "library"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid product ID "library"/);
  assert.match(result.stderr, /expected model:<lowercase-slug> \(for example model:library\)/);
});

test("expected command errors include a command-specific safe next action", () => {
  const invalidInitRoot = mkdtempSync(path.join(tmpdir(), "ddduck-invalid-init-"));
  const productRoot = makeProductFixture();
  const cases = [
    [runDdd(["init", invalidInitRoot, "--id", "invalid"]), /Next: Run ddduck init --help/],
    [
      runDdd([
        "create",
        "guarantee",
        "--origin",
        "members",
        "--classification",
        "invariant",
        "--owner",
        "domain:missing",
        "--statement",
        "A member remains identifiable.",
        "--root",
        productRoot,
      ]),
      /Next: Run ddduck create --help/,
    ],
    [runDdd(["query", "bogus", "--root", productRoot]), /Next: Run ddduck query --help/],
  ];

  for (const [result, nextAction] of cases) {
    assert.notEqual(result.status, 0);
    assert.equal(result.stderr.trim().split("\n").length, 1, result.stderr);
    assert.match(result.stderr, nextAction);
    assert.doesNotMatch(result.stderr, /file:\/\/|\bat .*\.mjs:/);
  }
});

test("mutations exclude the .ddduck directory from staging like discovery does", () => {
  const destination = makeProductFixture();
  mkdirSync(path.join(destination, ".ddduck"), { recursive: true });
  symlinkSync(destination, path.join(destination, ".ddduck", "self-link"));

  const generated = runDdd(["generate", "--root", destination]);

  assert.equal(generated.status, 0, generated.stderr);
  assert.doesNotMatch(generated.stderr, /Refusing to stage symbolic link/);
});

test("staged publication preflights every destination type before changing the product", () => {
  const destination = makeProductFixture();
  const graphJsonPath = path.join(destination, "generated", "graph", "model-graph.json");
  rmSync(graphJsonPath);
  mkdirSync(graphJsonPath);
  const before = snapshotProductFiles(destination);

  const created = runDdd([
    "create",
    "guarantee",
    "--origin",
    "members",
    "--classification",
    "invariant",
    "--owner",
    "domain:members",
    "--statement",
    "A member remains identifiable.",
    "--root",
    destination,
  ]);

  assert.notEqual(created.status, 0);
  assert.match(created.stderr, /destination.*regular file/i);
  assert.deepEqual(snapshotProductFiles(destination), before);
  assertOperationalArtifactsAbsent(destination);
});

test("staged publication rejects a dangling destination symlink before changing the product", () => {
  const destination = makeProductFixture();
  const graphJsonPath = path.join(destination, "generated", "graph", "model-graph.json");
  const externalDirectory = mkdtempSync(path.join(tmpdir(), "ddduck-publication-external-"));
  const externalFile = path.join(externalDirectory, "escaped-model-graph.json");
  rmSync(graphJsonPath);
  symlinkSync(externalFile, graphJsonPath);
  const before = snapshotProductFiles(destination);

  const created = runDdd([
    "create",
    "guarantee",
    "--origin",
    "members",
    "--classification",
    "invariant",
    "--owner",
    "domain:members",
    "--statement",
    "A member remains identifiable.",
    "--root",
    destination,
  ]);

  assert.notEqual(created.status, 0);
  assert.match(created.stderr, /symbolic link/i);
  assert.equal(existsSync(externalFile), false);
  assert.deepEqual(snapshotProductFiles(destination), before);
  assertOperationalArtifactsAbsent(destination);
});

test("executes every getting-started shell snippet verbatim", () => {
  const guide = readFileSync(path.join(root, "docs", "getting-started.md"), "utf8");
  const snippets = [...guide.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]);
  assert.ok(snippets.length > 0, "getting-started must contain an executable bash snippet");

  const workspace = mkdtempSync(path.join(tmpdir(), "ddduck-getting-started-"));
  const binDirectory = path.join(workspace, "bin");
  mkdirSync(binDirectory);
  const installedCli = path.join(binDirectory, "ddduck");
  writeFileSync(installedCli, `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`);
  chmodSync(installedCli, 0o755);
  const result = spawnSync("/bin/bash", ["-euo", "pipefail", "-c", snippets.join("\n")], {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, PATH: `${binDirectory}:${process.env.PATH}` },
  });

  assert.equal(result.status, 0, result.stderr);
  const outputLines = result.stdout.trim().split("\n");
  assert.equal(JSON.parse(outputLines.at(-1)).rootModelId, "model:library");
  assert.equal(runDdd(["check", "--root", path.join(workspace, "ddd")]).status, 0);
});

test("create and move preserve a guarantee ID and its ownership history", () => {
  const destination = makeProductFixture();
  const created = runDdd([
    "create",
    "guarantee",
    "--origin",
    "members",
    "--classification",
    "invariant",
    "--owner",
    "domain:members",
    "--statement",
    "A member remains identifiable.",
    "--root",
    destination,
  ]);

  assert.equal(created.status, 0, created.stderr);
  const guaranteePath = path.join(destination, "model", "guarantees", "members-inv-01.yaml");
  assert.match(readFileSync(guaranteePath, "utf8"), /id: MEMBERS-INV-01/);

  const moved = runDdd(["move", "guarantee", "MEMBERS-INV-01", "--to", "domain:reminders", "--root", destination]);
  assert.equal(moved.status, 0, moved.stderr);
  assert.match(readFileSync(guaranteePath, "utf8"), /ownerDomain: domain:reminders/);
  assert.match(readFileSync(guaranteePath, "utf8"), /ownershipHistory:/);
  assert.match(readFileSync(guaranteePath, "utf8"), /- domain:members/);

  const checked = runDdd(["check", "--root", destination]);
  assert.equal(checked.status, 0, checked.stderr);
});

test("a round-trip move leaves only true former owners in ownershipHistory", () => {
  const destination = makeProductFixture();
  const created = runDdd([
    "create",
    "guarantee",
    "--origin",
    "members",
    "--classification",
    "invariant",
    "--owner",
    "domain:members",
    "--statement",
    "A member remains identifiable.",
    "--root",
    destination,
  ]);
  assert.equal(created.status, 0, created.stderr);

  const there = runDdd(["move", "guarantee", "MEMBERS-INV-01", "--to", "domain:reminders", "--root", destination]);
  assert.equal(there.status, 0, there.stderr);
  const back = runDdd(["move", "guarantee", "MEMBERS-INV-01", "--to", "domain:members", "--root", destination]);
  assert.equal(back.status, 0, back.stderr);

  const source = readFileSync(path.join(destination, "model", "guarantees", "members-inv-01.yaml"), "utf8");
  assert.match(source, /ownerDomain: domain:members/);
  assert.match(source, /ownershipHistory:\n  - domain:reminders\n/);
  assert.doesNotMatch(source, /^ {2}- domain:members$/m, "the current owner must not appear as a former owner");
});

test("mutations preserve authored comments in canonical YAML files they rewrite", () => {
  const destination = makeProductFixture();
  const domainPath = path.join(destination, "model", "domains", "members.yaml");
  writeFileSync(
    domainPath,
    readFileSync(domainPath, "utf8").replace("name: Members", "# Members owns identity.\nname: Members"),
  );

  const created = runDdd([
    "create",
    "guarantee",
    "--origin",
    "members",
    "--classification",
    "invariant",
    "--owner",
    "domain:members",
    "--statement",
    "A member remains identifiable.",
    "--root",
    destination,
  ]);
  assert.equal(created.status, 0, created.stderr);
  assert.match(
    readFileSync(domainPath, "utf8"),
    /# Members owns identity\./,
    "create guarantee must preserve the owner domain file's authored comment",
  );

  const guaranteePath = path.join(destination, "model", "guarantees", "members-inv-01.yaml");
  writeFileSync(
    guaranteePath,
    readFileSync(guaranteePath, "utf8").replace(
      "statement: A member remains identifiable.",
      "statement: A member remains identifiable. # do not weaken",
    ),
  );
  const moved = runDdd(["move", "guarantee", "MEMBERS-INV-01", "--to", "domain:reminders", "--root", destination]);
  assert.equal(moved.status, 0, moved.stderr);
  assert.match(
    readFileSync(guaranteePath, "utf8"),
    /# do not weaken/,
    "move guarantee must preserve the guarantee file's inline comment",
  );
  assert.match(
    readFileSync(domainPath, "utf8"),
    /# Members owns identity\./,
    "move guarantee must preserve the former owner domain file's authored comment",
  );

  const successor = runDdd([
    "create",
    "guarantee",
    "--origin",
    "members",
    "--classification",
    "invariant",
    "--owner",
    "domain:members",
    "--statement",
    "A member keeps a stable ID.",
    "--root",
    destination,
  ]);
  assert.equal(successor.status, 0, successor.stderr);
  const split = runDdd([
    "split",
    "guarantee",
    "MEMBERS-INV-01",
    "--into",
    "MEMBERS-INV-02",
    "--decision",
    "ADR-001",
    "--root",
    destination,
  ]);
  assert.equal(split.status, 0, split.stderr);
  assert.match(
    readFileSync(guaranteePath, "utf8"),
    /# do not weaken/,
    "split guarantee must preserve the guarantee file's inline comment",
  );

  const successorPath = path.join(destination, "model", "guarantees", "members-inv-02.yaml");
  writeFileSync(
    successorPath,
    readFileSync(successorPath, "utf8").replace("status: active", "# supersedes MEMBERS-INV-01\nstatus: active"),
  );
  const retired = runDdd(["retire", "guarantee", "MEMBERS-INV-02", "--decision", "ADR-001", "--root", destination]);
  assert.equal(retired.status, 0, retired.stderr);
  assert.match(
    readFileSync(successorPath, "utf8"),
    /# supersedes MEMBERS-INV-01/,
    "retire guarantee must preserve the guarantee file's authored comment",
  );

  const checked = runDdd(["check", "--root", destination]);
  assert.equal(checked.status, 0, checked.stderr);
});

test("create guarantee reports its allocated ID and canonical source path", () => {
  const destination = makeProductFixture();
  const normalizedDestination = realpathSync(destination);

  const created = runDdd([
    "create",
    "guarantee",
    "--origin",
    "members",
    "--classification",
    "invariant",
    "--owner",
    "domain:members",
    "--statement",
    "A member remains identifiable.",
    "--root",
    destination,
  ]);

  assert.equal(created.status, 0, created.stderr);
  assert.equal(created.stderr, "");
  assert.equal(
    created.stdout,
    `create guarantee MEMBERS-INV-01 in ${normalizedDestination}; canonical: model/domains/members.yaml, model/guarantees/members-inv-01.yaml; generated: generated/docs/model-overview.md, generated/graph/model-graph.json, generated/graph/model-graph.ndjson, generated/graph/model-graph.svg\n`,
  );
});

test("generate --json returns exactly one mutation result object", () => {
  const destination = makeProductFixture();
  const normalizedDestination = realpathSync(destination);

  const generated = runDdd(["generate", "--root", destination, "--json"]);

  assert.equal(generated.status, 0, generated.stderr);
  assert.equal(generated.stderr, "");
  assert.deepEqual(JSON.parse(generated.stdout), {
    operation: "generate",
    root: normalizedDestination,
    affectedIds: [],
    canonicalPaths: [],
    generatedPaths: [
      "generated/docs/model-overview.md",
      "generated/graph/model-graph.json",
      "generated/graph/model-graph.ndjson",
      "generated/graph/model-graph.svg",
    ],
  });
  assert.equal(generated.stdout.trim().split("\n").length, 1);
});

test("check success remains silent", () => {
  const destination = makeProductFixture();
  const generated = runDdd(["generate", "--root", destination]);
  assert.equal(generated.status, 0, generated.stderr);

  const checked = runDdd(["check", "--root", destination]);

  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(checked.stdout, "");
  assert.equal(checked.stderr, "");
});

test("check names the validated root on stderr when --root is resolved implicitly", () => {
  const repository = makeConfiguredRepository();
  const configuredRoot = realpathSync(path.join(repository, "docs", "ddd"));

  const checked = runDdd(["check"], repository);

  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(checked.stdout, "");
  assert.equal(
    checked.stderr,
    `check: validating ${configuredRoot} (root resolved automatically; pass --root to override)\n`,
  );
});

test("check beside a broken second product names the config-pinned root it validated", () => {
  const repository = makeRepositoryShell("ddduck-wrong-root-");
  assert.equal(runDdd(["init", "apps/a/ddd", "--id", "model:alpha"], repository).status, 0);
  assert.equal(runDdd(["init", "apps/b/ddd", "--id", "model:beta"], repository).status, 0);
  const brokenProductPath = path.join(repository, "apps", "b", "ddd", "product.yaml");
  writeFileSync(
    brokenProductPath,
    readFileSync(brokenProductPath, "utf8").replace("domains: []", "domains:\n  - domain:ghost"),
  );

  const checked = runDdd(["check"], path.join(repository, "apps", "b"));

  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(checked.stdout, "");
  const validatedRoot = realpathSync(path.join(repository, "apps", "a", "ddd"));
  assert.ok(
    checked.stderr.includes(`check: validating ${validatedRoot}`),
    `check must name the root it validated so the wrong-root pass is visible: ${checked.stderr}`,
  );
});

test("init reports the repository config write and points at a pinned default on a second init", () => {
  const repository = makeRepositoryShell("ddduck-init-config-report-");
  const configPath = path.join(realpathSync(repository), ".ddduck", "config.json");

  const first = runDdd(["init", "apps/a/ddd", "--id", "model:alpha"], repository);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, new RegExp(`; config: ${escapeRegExp(configPath)} \\(created\\)\\n$`));

  const second = runDdd(["init", "apps/b/ddd", "--id", "model:beta"], repository);
  assert.equal(second.status, 0, second.stderr);
  assert.doesNotMatch(second.stdout, /config:/);
  assert.ok(
    second.stderr.includes(configPath) && second.stderr.includes("apps/a/ddd"),
    `a second init must point at the still-pinned repository default root: ${second.stderr}`,
  );

  const jsonRepository = makeRepositoryShell("ddduck-init-config-json-");
  const jsonResult = runDdd(["init", "ddd", "--id", "model:alpha", "--json"], jsonRepository);
  assert.equal(jsonResult.status, 0, jsonResult.stderr);
  assert.equal(
    JSON.parse(jsonResult.stdout).configPath,
    path.join(realpathSync(jsonRepository), ".ddduck", "config.json"),
  );

  const preExisting = runDdd(["init", "other", "--id", "model:beta", "--json"], jsonRepository);
  assert.equal(preExisting.status, 0, preExisting.stderr);
  assert.equal(Object.hasOwn(JSON.parse(preExisting.stdout), "configPath"), false);
});

test("product commands resolve a configured root when --root is omitted", () => {
  const repository = makeConfiguredRepository();
  const configuredRoot = path.join(repository, "docs", "ddd");

  const checked = runDdd(["check"], repository);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(checked.stdout, "");

  const generated = runDdd(["generate", "--json"], repository);
  assert.equal(generated.status, 0, generated.stderr);
  assert.equal(JSON.parse(generated.stdout).root, realpathSync(configuredRoot));
});

test("generate publishes the canonical graph SVG and check gates on its freshness", () => {
  const repository = makeConfiguredRepository();
  const svgPath = path.join(repository, "docs", "ddd", "generated", "graph", "model-graph.svg");

  // init (via makeConfiguredRepository) already published the SVG.
  assert.ok(existsSync(svgPath), "init should publish model-graph.svg");
  assert.ok(readFileSync(svgPath, "utf8").includes("<svg"), "the published file is an SVG");
  assert.equal(runDdd(["check"], repository).status, 0);

  // A stale SVG fails check with a targeted, actionable message.
  writeFileSync(svgPath, "<svg>stale</svg>\n");
  const stale = runDdd(["check"], repository);
  assert.notEqual(stale.status, 0, "check must fail on a stale SVG");
  assert.match(stale.stderr, /model-graph\.svg is missing or stale/);
  assert.equal(
    stale.stderr.match(/run ddduck generate --root /gi).length,
    1,
    `the remedy must appear exactly once (in Next:): ${stale.stderr}`,
  );

  // generate re-renders it and check passes again.
  assert.equal(runDdd(["generate"], repository).status, 0);
  assert.equal(runDdd(["check"], repository).status, 0);
});

test("init uses explicit destination before config and configured destination before default", () => {
  const configuredRepository = makeRepositoryShell("ddduck-init-configured-");
  writeRepositoryConfig(configuredRepository, "docs/ddd");

  const configured = runDdd(["init", "--id", "model:configured"], configuredRepository);
  assert.equal(configured.status, 0, configured.stderr);
  assert.ok(existsSync(path.join(configuredRepository, "docs", "ddd", "product.yaml")));
  assert.equal(existsSync(path.join(configuredRepository, "ddd", "product.yaml")), false);

  const explicitRepository = makeRepositoryShell("ddduck-init-explicit-");
  writeRepositoryConfig(explicitRepository, "docs/ddd");
  const explicit = runDdd(["init", "custom-ddd", "--id", "model:explicit"], explicitRepository);
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.ok(existsSync(path.join(explicitRepository, "custom-ddd", "product.yaml")));
  assert.equal(existsSync(path.join(explicitRepository, "docs", "ddd", "product.yaml")), false);
});

test("retire with an unregistered decision leaves canonical and generated files byte-identical", () => {
  const destination = makeProductFixture();
  createGuarantee(destination, "MEMBERS-INV-01", "domain:members");
  const generated = runDdd(["generate", "--root", destination]);
  assert.equal(generated.status, 0, generated.stderr);
  const before = snapshotProductFiles(destination);

  const retired = runDdd(["retire", "guarantee", "MEMBERS-INV-01", "--decision", "ADR-999", "--root", destination]);

  assert.notEqual(retired.status, 0);
  assert.match(retired.stderr, /retire requires a registered decision ADR-999/);
  assert.match(retired.stderr, /no decisions\/ADR-999-\*\.md found/);
  assert.match(retired.stderr, /Next: Create .*decisions\/ADR-999-<slug>\.md/);
  assert.doesNotMatch(retired.stderr, /model\/guarantees\//);
  assert.deepEqual(snapshotProductFiles(destination), before);
  assertOperationalArtifactsAbsent(destination);
});

test("retire with an Interface-only reference leaves canonical and generated files byte-identical", () => {
  const destination = makeProductFixture();
  createGuarantee(destination, "MEMBERS-INV-01", "domain:members");
  writeFileSync(
    path.join(destination, "model", "interfaces", "identify-member.yaml"),
    [
      'schemaVersion: "1"',
      "kind: DomainInterface",
      "id: interface:identify-member",
      "model: model:sample",
      "ownerDomain: domain:members",
      "name: Identify member",
      "operationKind: query",
      "guarantees:",
      "  - MEMBERS-INV-01",
      "",
    ].join("\n"),
  );
  const domainPath = path.join(destination, "model", "domains", "members.yaml");
  writeFileSync(
    domainPath,
    readFileSync(domainPath, "utf8").replace("interfaces: []", "interfaces:\n  - interface:identify-member"),
  );
  const generated = runDdd(["generate", "--root", destination]);
  assert.equal(generated.status, 0, generated.stderr);
  const before = snapshotProductFiles(destination);

  const retired = runDdd(["retire", "guarantee", "MEMBERS-INV-01", "--decision", "ADR-001", "--root", destination]);

  assert.notEqual(retired.status, 0);
  assert.match(retired.stderr, /non-effective guarantee MEMBERS-INV-01/);
  assert.deepEqual(snapshotProductFiles(destination), before);
  assertOperationalArtifactsAbsent(destination);
});

test("concurrent creates publish every success or return a retryable busy error", async () => {
  const destination = makeProductFixture();
  const statements = Array.from({ length: 8 }, (_, index) => `Concurrent guarantee ${index + 1}.`);

  const results = await Promise.all(
    statements.map((statement) =>
      runDddAsync([
        "create",
        "guarantee",
        "--origin",
        "members",
        "--classification",
        "invariant",
        "--owner",
        "domain:members",
        "--statement",
        statement,
        "--root",
        destination,
      ]),
    ),
  );

  const successfulStatements = [];
  for (const [index, result] of results.entries()) {
    if (result.status === 0) successfulStatements.push(statements[index]);
    else assert.match(result.stderr, /busy.*retry/i);
  }
  const guaranteeSources = readdirSync(path.join(destination, "model", "guarantees"))
    .filter((file) => file.endsWith(".yaml"))
    .map((file) => readFileSync(path.join(destination, "model", "guarantees", file), "utf8"));
  assert.equal(guaranteeSources.length, successfulStatements.length);
  for (const statement of successfulStatements) {
    assert.equal(guaranteeSources.filter((source) => source.includes(`statement: ${statement}`)).length, 1);
  }
  const checked = runDdd(["check", "--root", destination]);
  assert.equal(checked.status, 0, checked.stderr);
});

test("split and retire reject active use-case references before changing lifecycle state", () => {
  const destination = makeProductFixture();
  createGuarantee(destination, "MEMBERS-INV-01", "domain:members");
  createGuarantee(destination, "REMINDERS-INV-01", "domain:reminders");
  createGuarantee(destination, "REMINDERS-AC-01", "domain:reminders");
  writeFileSync(
    path.join(destination, "model", "use-cases", "create-reminder.yaml"),
    [
      'schemaVersion: "1"',
      "kind: UseCase",
      "id: use-case:create-reminder",
      "model: model:sample",
      "name: Create reminder",
      "goal: Create a reminder.",
      "preconditions:",
      "  requires:",
      "    - MEMBERS-INV-01",
      "success:",
      "  preserves: []",
      "  establishes: []",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(destination, "product.yaml"),
    readFileSync(path.join(destination, "product.yaml"), "utf8").replace(
      "useCases: []",
      "useCases:\n  - use-case:create-reminder",
    ),
  );

  const missingDecision = runDdd(["retire", "guarantee", "MEMBERS-INV-01", "--root", destination]);
  assert.notEqual(missingDecision.status, 0);
  assert.match(missingDecision.stderr, /retire requires --decision ADR-NNN/);

  const blockedRetire = runDdd([
    "retire",
    "guarantee",
    "MEMBERS-INV-01",
    "--decision",
    "ADR-001",
    "--root",
    destination,
  ]);
  assert.notEqual(blockedRetire.status, 0);
  assert.match(blockedRetire.stderr, /non-effective guarantee MEMBERS-INV-01/);

  const blockedSplit = runDdd([
    "split",
    "guarantee",
    "MEMBERS-INV-01",
    "--into",
    "REMINDERS-INV-01",
    "--decision",
    "ADR-001",
    "--root",
    destination,
  ]);
  assert.notEqual(blockedSplit.status, 0);
  assert.match(blockedSplit.stderr, /non-effective guarantee MEMBERS-INV-01/);

  writeFileSync(
    path.join(destination, "model", "use-cases", "create-reminder.yaml"),
    readFileSync(path.join(destination, "model", "use-cases", "create-reminder.yaml"), "utf8").replace(
      "MEMBERS-INV-01",
      "REMINDERS-INV-01",
    ),
  );
  const split = runDdd([
    "split",
    "guarantee",
    "MEMBERS-INV-01",
    "--into",
    "REMINDERS-INV-01",
    "--decision",
    "ADR-001",
    "--root",
    destination,
  ]);
  assert.equal(split.status, 0, split.stderr);
  assert.match(
    readFileSync(path.join(destination, "model", "guarantees", "members-inv-01.yaml"), "utf8"),
    /status: split/,
  );
  assert.match(
    readFileSync(path.join(destination, "model", "guarantees", "members-inv-01.yaml"), "utf8"),
    /lifecycleDecision: ADR-001/,
  );

  writeFileSync(
    path.join(destination, "model", "use-cases", "create-reminder.yaml"),
    readFileSync(path.join(destination, "model", "use-cases", "create-reminder.yaml"), "utf8").replace(
      "preconditions:\n  requires:\n    - REMINDERS-INV-01",
      "preconditions:\n  requires: []",
    ),
  );
  const retired = runDdd(["retire", "guarantee", "REMINDERS-AC-01", "--decision", "ADR-001", "--root", destination]);
  assert.equal(retired.status, 0, retired.stderr);
  assert.match(
    readFileSync(path.join(destination, "model", "guarantees", "reminders-ac-01.yaml"), "utf8"),
    /status: retired/,
  );
  assert.match(
    readFileSync(path.join(destination, "model", "guarantees", "reminders-ac-01.yaml"), "utf8"),
    /lifecycleDecision: ADR-001/,
  );
  assert.doesNotMatch(
    readFileSync(path.join(destination, "generated", "docs", "model-overview.md"), "utf8"),
    /MEMBERS-INV-01|REMINDERS-AC-01/,
  );
  assert.doesNotMatch(
    readFileSync(path.join(destination, "generated", "graph", "model-graph.json"), "utf8"),
    /MEMBERS-INV-01|REMINDERS-AC-01/,
  );
});

test("split successors can later split and retire under their own registered decisions", () => {
  const destination = makeProductFixture();
  createGuarantee(destination, "MEMBERS-INV-01", "domain:members");
  createGuarantee(destination, "MEMBERS-INV-02", "domain:members");
  createGuarantee(destination, "MEMBERS-INV-03", "domain:members");

  const split = runDdd([
    "split",
    "guarantee",
    "MEMBERS-INV-01",
    "--into",
    "MEMBERS-INV-02",
    "--decision",
    "ADR-001",
    "--root",
    destination,
  ]);
  assert.equal(split.status, 0, split.stderr);

  const successorSplit = runDdd([
    "split",
    "guarantee",
    "MEMBERS-INV-02",
    "--into",
    "MEMBERS-INV-03",
    "--decision",
    "ADR-001",
    "--root",
    destination,
  ]);
  assert.equal(successorSplit.status, 0, successorSplit.stderr);
  assert.match(
    readFileSync(path.join(destination, "model", "guarantees", "members-inv-02.yaml"), "utf8"),
    /status: split/,
  );

  const successorRetire = runDdd([
    "retire",
    "guarantee",
    "MEMBERS-INV-03",
    "--decision",
    "ADR-001",
    "--root",
    destination,
  ]);
  assert.equal(successorRetire.status, 0, successorRetire.stderr);
  assert.match(
    readFileSync(path.join(destination, "model", "guarantees", "members-inv-03.yaml"), "utf8"),
    /status: retired/,
  );

  const checked = runDdd(["check", "--root", destination]);
  assert.equal(checked.status, 0, checked.stderr);
});

test("a mutation reclaims a stale operation lock left by a dead process", () => {
  const destination = makeProductFixture();
  const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
  writeFileSync(path.join(destination, ".ddduck-operation.lock"), `${deadPid}\n`);
  mkdirSync(path.join(destination, ".ddduck-operation-stage-orphan"));
  writeFileSync(path.join(destination, ".ddduck-operation-stage-orphan", "leftover.yaml"), "leftover\n");

  const generated = runDdd(["generate", "--root", destination]);

  assert.equal(generated.status, 0, generated.stderr);
  assertOperationalArtifactsAbsent(destination);
});

test("concurrent mutations against a stale dead-process lock keep mutual exclusion", async () => {
  const destination = makeProductFixture();
  for (let round = 1; round <= 3; round += 1) {
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    writeFileSync(path.join(destination, ".ddduck-operation.lock"), `${deadPid}\n`);
    const statements = Array.from({ length: 6 }, (_, index) => `Reclaim race r${round} w${index + 1}.`);

    const results = await Promise.all(
      statements.map((statement) =>
        runDddAsync([
          "create",
          "guarantee",
          "--origin",
          "members",
          "--classification",
          "invariant",
          "--owner",
          "domain:members",
          "--statement",
          statement,
          "--root",
          destination,
        ]),
      ),
    );

    const successfulStatements = [];
    for (const [index, result] of results.entries()) {
      if (result.status === 0) successfulStatements.push(statements[index]);
      else assert.match(result.stderr, /Product root is busy/, result.stderr);
    }
    assert.ok(successfulStatements.length >= 1, "the stale lock must be reclaimed by exactly one winner at a time");
    assertOperationalArtifactsAbsent(destination);
    const guaranteeSources = readdirSync(path.join(destination, "model", "guarantees"))
      .filter((file) => file.endsWith(".yaml"))
      .map((file) => readFileSync(path.join(destination, "model", "guarantees", file), "utf8"));
    for (const statement of successfulStatements) {
      assert.equal(guaranteeSources.filter((source) => source.includes(`statement: ${statement}`)).length, 1);
    }
  }
  const checked = runDdd(["check", "--root", destination]);
  assert.equal(checked.status, 0, checked.stderr);
});

test("check reports a leftover reclaim claim from a crashed takeover", () => {
  const destination = makeProductFixture();
  assert.equal(runDdd(["generate", "--root", destination]).status, 0);
  const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
  writeFileSync(path.join(destination, ".ddduck-operation.reclaim"), `${deadPid}\n`);

  const checked = runDdd(["check", "--root", destination]);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /\.ddduck-operation\.reclaim/);

  const reclaimed = runDdd(["generate", "--root", destination]);
  assert.equal(reclaimed.status, 0, reclaimed.stderr);
  assertOperationalArtifactsAbsent(destination);
  const rechecked = runDdd(["check", "--root", destination]);
  assert.equal(rechecked.status, 0, rechecked.stderr);
});

test("a mutation recovers when a crashed takeover leaves both a stale lock and a dead reclaim claim", () => {
  const destination = makeProductFixture();
  assert.equal(runDdd(["generate", "--root", destination]).status, 0);
  const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
  writeFileSync(path.join(destination, ".ddduck-operation.lock"), `${deadPid}\n`);
  writeFileSync(path.join(destination, ".ddduck-operation.reclaim"), `${deadPid}\n`);
  writeFileSync(path.join(destination, `.ddduck-operation.reclaim.${deadPid}`), `${deadPid}\n`);

  const reclaimed = runDdd(["generate", "--root", destination]);
  assert.equal(reclaimed.status, 0, reclaimed.stderr);
  assertOperationalArtifactsAbsent(destination);
  const rechecked = runDdd(["check", "--root", destination]);
  assert.equal(rechecked.status, 0, rechecked.stderr);
});

test("a live reclaim claim blocks takeover of a stale lock, naming the claim file", () => {
  const destination = makeProductFixture();
  const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
  writeFileSync(path.join(destination, ".ddduck-operation.lock"), `${deadPid}\n`);
  writeFileSync(path.join(destination, ".ddduck-operation.reclaim"), `${process.pid}\n`);

  const generated = runDdd(["generate", "--root", destination]);

  assert.equal(generated.status, 2, generated.stderr);
  assert.match(generated.stderr, /Product root is busy/);
  assert.match(generated.stderr, /\.ddduck-operation\.reclaim/);
});

test("a lock held by a live process fails once naming the lock file and holder", () => {
  const destination = makeProductFixture();
  const lockPath = path.join(destination, ".ddduck-operation.lock");
  writeFileSync(lockPath, `${process.pid}\n`);

  const generated = runDdd(["generate", "--root", destination]);

  assert.equal(generated.status, 2, generated.stderr);
  assert.match(generated.stderr, /Product root is busy/);
  assert.match(generated.stderr, /\.ddduck-operation\.lock/);
  assert.match(generated.stderr, new RegExp(`\\b${process.pid}\\b`));
  assert.doesNotMatch(generated.stderr, /correct the input/);
  assert.ok(existsSync(lockPath));
});

test("a retryable busy failure exits 2 while other failures keep exit 1", () => {
  const destination = makeProductFixture();
  const lockPath = path.join(destination, ".ddduck-operation.lock");
  writeFileSync(lockPath, `${process.pid}\n`);

  const busy = runDdd(["check", "--root", destination]);
  assert.equal(busy.status, 2, busy.stderr);
  assert.match(busy.stderr, /held by running process/);

  rmSync(lockPath);
  writeFileSync(
    path.join(destination, "model", "concepts", "broken.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Concept",
      "id: concept:broken",
      "model: model:sample",
      "name: broken",
      "ownerDomain: domain:missing",
      "",
    ].join("\n"),
  );
  const invalid = runDdd(["check", "--root", destination, "--source-only"]);
  assert.equal(invalid.status, 1, invalid.stderr);
});

test("a lock without a readable owner fails naming the lock file and the deletion recovery", () => {
  const destination = makeProductFixture();
  const lockPath = path.join(destination, ".ddduck-operation.lock");
  writeFileSync(lockPath, "");

  const generated = runDdd(["generate", "--root", destination]);

  assert.notEqual(generated.status, 0);
  assert.match(generated.stderr, /\.ddduck-operation\.lock/);
  assert.match(generated.stderr, /delete .*\.ddduck-operation\.lock/i);
  assert.doesNotMatch(generated.stderr, /correct the input/);
});

test("check reports leftover interrupted-operation state instead of staying green", () => {
  const destination = makeProductFixture();
  const generated = runDdd(["generate", "--root", destination]);
  assert.equal(generated.status, 0, generated.stderr);
  const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
  writeFileSync(path.join(destination, ".ddduck-operation.lock"), `${deadPid}\n`);
  mkdirSync(path.join(destination, ".ddduck-operation-stage-orphan"));

  const checked = runDdd(["check", "--root", destination]);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /\.ddduck-operation\.lock/);
  assert.match(checked.stderr, /\.ddduck-operation-stage-/);

  const reclaimed = runDdd(["generate", "--root", destination]);
  assert.equal(reclaimed.status, 0, reclaimed.stderr);
  assertOperationalArtifactsAbsent(destination);
  const rechecked = runDdd(["check", "--root", destination]);
  assert.equal(rechecked.status, 0, rechecked.stderr);
});

test("readers fail cleanly instead of reading while a live mutation holds the operation lock", () => {
  const destination = makeProductFixture();
  assert.equal(runDdd(["generate", "--root", destination]).status, 0);
  writeFileSync(path.join(destination, ".ddduck-operation.lock"), `${process.pid}\n`);

  const query = runDdd(["query", "node", "--id", "domain:members", "--root", destination, "--json"]);
  assert.equal(query.status, 2, query.stdout || query.stderr);
  assert.match(query.stderr, /busy/);
  assert.match(query.stderr, /\.ddduck-operation\.lock/);

  const checked = runDdd(["check", "--root", destination]);
  assert.equal(checked.status, 2, checked.stdout || checked.stderr);
  assert.match(checked.stderr, /busy/);
  assert.match(checked.stderr, /\.ddduck-operation\.lock/);

  // A lock with a dead owner is leftover interrupted-operation state, not a
  // live mutation: queries refuse it like check instead of exit 2 busy.
  const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
  writeFileSync(path.join(destination, ".ddduck-operation.lock"), `${deadPid}\n`);
  const deadOwnerQuery = runDdd(["query", "node", "--id", "domain:members", "--root", destination, "--json"]);
  assert.equal(deadOwnerQuery.status, 1, deadOwnerQuery.stdout || deadOwnerQuery.stderr);
  assert.match(deadOwnerQuery.stderr, /interrupted ddduck operation left \.ddduck-operation\.lock/);
});

test("queries refuse leftover interrupted-operation state with the reclaim next action", () => {
  const destination = makeProductFixture();
  assert.equal(runDdd(["generate", "--root", destination]).status, 0);
  const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
  writeFileSync(path.join(destination, ".ddduck-operation.lock"), `${deadPid}\n`);

  const spec = runDdd(["query", "spec", "--root", destination, "--json"]);
  assert.equal(spec.status, 1, spec.stdout || spec.stderr);
  assert.equal(spec.stdout, "");
  assert.match(spec.stderr, /interrupted ddduck operation left \.ddduck-operation\.lock/);
  assert.match(spec.stderr, /Next: Run ddduck generate --root .* to reclaim the interrupted operation state/);

  rmSync(path.join(destination, ".ddduck-operation.lock"));
  mkdirSync(path.join(destination, ".ddduck-operation-stage-zz"));
  const context = runDdd(["query", "context", "--id", "domain:members", "--root", destination, "--json"]);
  assert.equal(context.status, 1, context.stdout || context.stderr);
  assert.match(context.stderr, /interrupted ddduck operation left \.ddduck-operation-stage-zz/);

  // check's own leftover refusal is unchanged.
  const checked = runDdd(["check", "--root", destination]);
  assert.equal(checked.status, 1, checked.stdout || checked.stderr);
  assert.match(checked.stderr, /\.ddduck-operation-stage-zz/);

  rmSync(path.join(destination, ".ddduck-operation-stage-zz"), { recursive: true, force: true });
  const clean = runDdd(["query", "spec", "--root", destination, "--json"]);
  assert.equal(clean.status, 0, clean.stderr);
});

test("check reports each source validation error on its own line beneath a summary", () => {
  const destination = makeProductFixture();
  for (const name of ["broken", "broken2"]) {
    writeFileSync(
      path.join(destination, "model", "concepts", `${name}.yaml`),
      [
        'schemaVersion: "1"',
        "kind: Concept",
        `id: concept:${name}`,
        "model: model:sample",
        `name: ${name}`,
        "ownerDomain: domain:missing",
        "",
      ].join("\n"),
    );
  }

  const result = runDdd(["check", "--root", destination, "--source-only"]);

  assert.notEqual(result.status, 0);
  const lines = result.stderr.trim().split("\n");
  assert.ok(lines.length > 2, result.stderr);
  assert.match(lines[0], /^Error: Validation failed for /);
  assert.match(lines.at(-1), /^Next: /);
  assert.ok(
    lines.slice(1, -1).some((line) => line.startsWith("model/concepts/broken.yaml:")),
    result.stderr,
  );
  assert.ok(
    lines.slice(1, -1).some((line) => line.startsWith("model/concepts/broken2.yaml:")),
    result.stderr,
  );
});

test("validation failures point at the listed source files, not the CLI input", () => {
  const destination = makeProductFixture();
  writeFileSync(
    path.join(destination, "model", "concepts", "broken.yaml"),
    [
      'schemaVersion: "1"',
      "kind: Concept",
      "id: concept:broken",
      "model: model:sample",
      "name: broken",
      "ownerDomain: domain:missing",
      "",
    ].join("\n"),
  );

  const generated = runDdd(["generate", "--root", destination]);
  assert.notEqual(generated.status, 0);
  assert.match(generated.stderr, /Error: Validation failed for /, "generate must use the same preamble as check");
  assert.match(generated.stderr, /Next: Fix the listed source files, then re-run ddduck check\./);
  assert.doesNotMatch(generated.stderr, /correct the input/);

  const checked = runDdd(["check", "--root", destination, "--source-only"]);
  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /Next: Fix the listed source files, then re-run ddduck check\./);
  assert.doesNotMatch(checked.stderr, /correct the input/);
});

test("a blocked lifecycle transition names the referencing file and the edit-generate-retry path", () => {
  const destination = makeProductFixture();
  createGuarantee(destination, "MEMBERS-INV-01", "domain:members");
  writeFileSync(
    path.join(destination, "model", "interfaces", "identify-member.yaml"),
    [
      'schemaVersion: "1"',
      "kind: DomainInterface",
      "id: interface:identify-member",
      "model: model:sample",
      "ownerDomain: domain:members",
      "name: Identify member",
      "operationKind: query",
      "guarantees:",
      "  - MEMBERS-INV-01",
      "",
    ].join("\n"),
  );
  const domainPath = path.join(destination, "model", "domains", "members.yaml");
  writeFileSync(
    domainPath,
    readFileSync(domainPath, "utf8").replace("interfaces: []", "interfaces:\n  - interface:identify-member"),
  );
  assert.equal(runDdd(["generate", "--root", destination]).status, 0);

  const retired = runDdd(["retire", "guarantee", "MEMBERS-INV-01", "--decision", "ADR-001", "--root", destination]);
  assert.notEqual(retired.status, 0);
  assert.match(retired.stderr, /non-effective guarantee MEMBERS-INV-01/);
  assert.match(retired.stderr, /Next: Edit model\/interfaces\/identify-member\.yaml/);
  assert.match(retired.stderr, /run ddduck generate --root .*, and retry\./);
  assert.doesNotMatch(retired.stderr, /--help, correct the input/);
});

test("generate text result reports an empty canonical list as none", () => {
  const destination = makeProductFixture();
  const generated = runDdd(["generate", "--root", destination]);

  assert.equal(generated.status, 0, generated.stderr);
  assert.equal(
    generated.stdout,
    `generate in ${realpathSync(destination)}; canonical: none; generated: generated/docs/model-overview.md, generated/graph/model-graph.json, generated/graph/model-graph.ndjson, generated/graph/model-graph.svg\n`,
  );
});

test("option values beginning with -- are representable through --option=value", () => {
  const destination = makeProductFixture();
  const rejected = runDdd([
    "create",
    "guarantee",
    "--origin",
    "members",
    "--classification",
    "invariant",
    "--owner",
    "domain:members",
    "--statement",
    "--strict mode is the default",
    "--root",
    destination,
  ]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Missing value for --statement; pass values starting with -- as --statement=<value>/);

  const created = runDdd([
    "create",
    "guarantee",
    "--origin",
    "members",
    "--classification",
    "invariant",
    "--owner",
    "domain:members",
    "--statement=--strict mode is the default",
    "--root",
    destination,
  ]);
  assert.equal(created.status, 0, created.stderr);
  assert.match(
    readFileSync(path.join(destination, "model", "guarantees", "members-inv-01.yaml"), "utf8"),
    /statement: .*--strict mode is the default/,
  );
});

test("create guarantee rejects origins the Guarantee ID grammar rejects before staging", () => {
  const destination = makeProductFixture();
  const before = snapshotProductFiles(destination);

  const created = runDdd([
    "create",
    "guarantee",
    "--origin",
    "m",
    "--classification",
    "invariant",
    "--owner",
    "domain:members",
    "--statement",
    "One letter origin.",
    "--root",
    destination,
  ]);

  assert.notEqual(created.status, 0);
  assert.match(created.stderr, /Invalid guarantee origin "M"; --origin requires two or more characters/);
  assert.doesNotMatch(created.stderr, /schema validation failed/);
  assert.deepEqual(snapshotProductFiles(destination), before);
});

test("reference and arity errors state the expected shape", () => {
  const destination = makeProductFixture();

  const unknownDomain = runDdd([
    "create",
    "guarantee",
    "--origin",
    "members",
    "--classification",
    "invariant",
    "--owner",
    "catalog",
    "--statement",
    "x",
    "--root",
    destination,
  ]);
  assert.notEqual(unknownDomain.status, 0);
  assert.match(unknownDomain.stderr, /Unknown domain catalog; domain IDs use the domain: prefix/);
  assert.match(unknownDomain.stderr, /known domains: domain:members, domain:reminders/);

  const missingKeyword = runDdd(["move", "MEMBERS-INV-01", "--to", "domain:members", "--root", destination]);
  assert.notEqual(missingKeyword.status, 0);
  assert.match(
    missingKeyword.stderr,
    /Expected 2 positional arguments; usage: ddduck move guarantee <guarantee-id> --to <domain-id>/,
  );
});

function makeProductFixture() {
  const destination = mkdtempSync(path.join(tmpdir(), "ddduck-lifecycle-"));
  const initialized = runDdd(["init", destination, "--id", "model:sample"]);
  assert.equal(initialized.status, 0, initialized.stderr);
  for (const [id, name] of [
    ["domain:members", "Members"],
    ["domain:reminders", "Reminders"],
  ]) {
    writeFileSync(
      path.join(destination, "model", "domains", `${id.slice("domain:".length)}.yaml`),
      [
        'schemaVersion: "1"',
        "kind: Domain",
        `id: ${id}`,
        "model: model:sample",
        `name: ${name}`,
        `purpose: Manage ${name.toLowerCase()}.`,
        "concepts: []",
        "interfaces: []",
        "guarantees: []",
        "",
      ].join("\n"),
    );
  }
  writeFileSync(
    path.join(destination, "product.yaml"),
    readFileSync(path.join(destination, "product.yaml"), "utf8").replace(
      "domains: []",
      "domains:\n  - domain:members\n  - domain:reminders",
    ),
  );
  writeFileSync(path.join(destination, "decisions", "ADR-001-guarantee-lifecycle.md"), "# ADR-001 - Lifecycle\n");
  return destination;
}

function createGuarantee(destination, id, ownerDomain) {
  const [origin, classification, serial] = id.match(/^(.+)-(INV|AC)-(\d+)$/).slice(1);
  const fileName = `${origin.toLowerCase()}-${classification.toLowerCase()}-${serial}.yaml`;
  const shortOrigin = origin.toLowerCase();
  const domainPath = path.join(destination, "model", "domains", `${ownerDomain.slice("domain:".length)}.yaml`);
  writeFileSync(
    path.join(destination, "model", "guarantees", fileName),
    [
      'schemaVersion: "1"',
      "kind: Guarantee",
      `id: ${id}`,
      "model: model:sample",
      `ownerDomain: ${ownerDomain}`,
      `classification: ${classification === "INV" ? "invariant" : "acceptance-criterion"}`,
      `statement: ${shortOrigin} guarantee.`,
      "status: active",
      "",
    ].join("\n"),
  );
  const domainSource = readFileSync(domainPath, "utf8");
  writeFileSync(
    domainPath,
    domainSource.includes("guarantees: []")
      ? domainSource.replace("guarantees: []", `guarantees:\n  - ${id}`)
      : `${domainSource.trimEnd()}\n  - ${id}\n`,
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runDdd(args, cwd = root) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

function runDddAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function snapshotProductFiles(productRoot) {
  const snapshot = {};
  for (const relativePath of ["product.yaml", "model", "decisions", "generated"]) {
    const absolutePath = path.join(productRoot, relativePath);
    if (!existsSync(absolutePath)) continue;
    snapshotPath(absolutePath, productRoot, snapshot);
  }
  return snapshot;
}

function snapshotPath(absolutePath, productRoot, snapshot) {
  const metadata = lstatSync(absolutePath);
  if (metadata.isSymbolicLink()) {
    snapshot[path.relative(productRoot, absolutePath)] = `symlink:${readlinkSync(absolutePath)}`;
    return;
  }
  if (metadata.isDirectory()) {
    for (const entry of readdirSync(absolutePath).sort()) {
      snapshotPath(path.join(absolutePath, entry), productRoot, snapshot);
    }
    return;
  }
  snapshot[path.relative(productRoot, absolutePath)] = readFileSync(absolutePath).toString("base64");
}

function assertOperationalArtifactsAbsent(productRoot) {
  assert.equal(readdirSync(productRoot).filter((entry) => entry.startsWith(".ddduck-operation")).length, 0);
}

function makeConfiguredRepository() {
  const repository = makeRepositoryShell("ddduck-configured-root-");
  const productRoot = path.join(repository, "docs", "ddd");
  const initialized = runDdd(["init", productRoot, "--id", "model:configured-root"], repository);
  assert.equal(initialized.status, 0, initialized.stderr);
  writeRepositoryConfig(repository, "docs/ddd");
  return repository;
}

function makeRepositoryShell(prefix) {
  const repository = mkdtempSync(path.join(tmpdir(), prefix));
  mkdirSync(path.join(repository, ".git"));
  return repository;
}

function writeRepositoryConfig(repository, productRoot) {
  mkdirSync(path.join(repository, ".ddduck"), { recursive: true });
  writeFileSync(
    path.join(repository, ".ddduck", "config.json"),
    `${JSON.stringify({ schemaVersion: "1", productRoot }, null, 2)}\n`,
  );
}
