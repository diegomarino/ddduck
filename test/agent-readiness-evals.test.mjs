import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runAgentReadinessEvals } from "../scripts/lib/agent-readiness-evals.mjs";
import { generateAgentReadinessReport } from "../scripts/lib/agent-readiness-report.mjs";

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(frameworkRoot, "scripts", "run-agent-readiness-evals.mjs");
const reportCli = path.join(frameworkRoot, "scripts", "generate-agent-readiness-report.mjs");
const committedEvalPack = path.join(frameworkRoot, "test", "evals", "agent-readable-product-specs.jsonl");
const committedEvalSnapshot = path.join(frameworkRoot, "test", "evals", "agent-readable-product-specs.result.json");
const referenceProduct = path.join(frameworkRoot, "examples", "reminders", "ddd");

test("readiness report derives healthy ownership and freshness from the effective reference product", () => {
  const report = generateAgentReadinessReport(referenceProduct);

  assert.deepEqual(report.unresolvedReferences, []);
  assert.deepEqual(report.staleGeneratedViews, []);
  assert.deepEqual(report.orphanedNodes, []);
  assert.deepEqual(report.ambiguousOwnership, []);
  assert.equal(
    report.orphanedNodes.some(({ id }) => id === "rel:reminder-assigned-to-member"),
    false,
    "a Relationship owned through ownedBy is outside the orphan definition",
  );
});

test("readiness report demands evidence anchors only on kinds whose schema accepts an evidence field", () => {
  const evidenceKinds = new Set(["DomainInterface", "UseCase", "Guarantee"]);
  const report = generateAgentReadinessReport(referenceProduct);

  for (const entry of report.missingEvidence) {
    if (evidenceKinds.has(entry.kind)) continue;
    assert.deepEqual(
      entry.missingRoles.filter((role) => role === "source" || role === "verification"),
      [],
      `${entry.id} (${entry.kind}) cannot declare evidence anchors, so none may be demanded`,
    );
  }
});

test("readiness report includes stale generated views returned by the spec query", () => {
  const productRoot = copiedReferenceProduct("stale-report");
  try {
    writeFileSync(path.join(productRoot, "generated", "graph", "model-graph.json"), "stale\n");

    const report = generateAgentReadinessReport(productRoot);

    assert.deepEqual(report.staleGeneratedViews, [{ path: "generated/graph/model-graph.json", freshness: "stale" }]);
  } finally {
    rmSync(path.dirname(productRoot), { recursive: true, force: true });
  }
});

test("readiness report includes the missing source role returned by an effective node anchors query", () => {
  const productRoot = copiedReferenceProduct("missing-source-report");
  const interfacePath = path.join(productRoot, "model", "interfaces", "create-reminder.yaml");
  try {
    const source = readFileSync(interfacePath, "utf8");
    const sourceAnchor = "  - path: reference-evidence.md\n    anchor: Source\n    role: source\n";
    assert.match(source, /anchor: Source/);
    writeFileSync(interfacePath, source.replace(sourceAnchor, ""));

    const report = generateAgentReadinessReport(productRoot);

    assert.deepEqual(
      report.missingEvidence.find(({ id }) => id === "interface:create-reminder"),
      {
        id: "interface:create-reminder",
        kind: "DomainInterface",
        sourcePath: "model/interfaces/create-reminder.yaml",
        missingRoles: ["source"],
      },
    );
  } finally {
    rmSync(path.dirname(productRoot), { recursive: true, force: true });
  }
});

test("invalid products return only sorted validation diagnostics", () => {
  const productRoot = copiedReferenceProduct("invalid-report");
  const memberPath = path.join(productRoot, "model", "concepts", "member.yaml");
  try {
    writeFileSync(memberPath, readFileSync(memberPath, "utf8").replace("domain:members", "domain:missing"));

    const report = generateAgentReadinessReport(productRoot);

    assert.deepEqual(Object.keys(report), ["unresolvedReferences"]);
    assert.deepEqual(report.unresolvedReferences, [...report.unresolvedReferences].sort());
    assert.match(report.unresolvedReferences.join("\n"), /missing reference domain:missing/);
  } finally {
    rmSync(path.dirname(productRoot), { recursive: true, force: true });
  }
});

test("readiness report CLI accepts exactly --root and emits one JSON document", () => {
  const success = runReportCli(["--root", referenceProduct]);

  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /\n$/);
  assert.deepEqual(JSON.parse(success.stdout), generateAgentReadinessReport(referenceProduct));

  for (const args of [
    [],
    ["--root", referenceProduct, "--json"],
    ["--root", referenceProduct, "--root", referenceProduct],
  ]) {
    const failure = runReportCli(args);
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, "");
    assert.match(failure.stderr, /usage:/);
  }
});

test("readiness report CLI emits invalid-product diagnostics as JSON and exits one", () => {
  const productRoot = copiedReferenceProduct("invalid-report-cli");
  const memberPath = path.join(productRoot, "model", "concepts", "member.yaml");
  try {
    writeFileSync(memberPath, readFileSync(memberPath, "utf8").replace("domain:members", "domain:missing"));

    const result = runReportCli(["--root", productRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /\n$/);
    assert.deepEqual(Object.keys(JSON.parse(result.stdout)), ["unresolvedReferences"]);
  } finally {
    rmSync(path.dirname(productRoot), { recursive: true, force: true });
  }
});

test("committed agent readiness eval pack has a byte-stable generated snapshot", () => {
  assert.equal(existsSync(committedEvalPack), true, "committed eval JSONL pack is required");
  assert.equal(existsSync(committedEvalSnapshot), true, "committed eval result snapshot is required");

  const outputDirectory = mkdtempSync(path.join(frameworkRoot, "test", "evals", ".agent-readiness-evals-"));
  const firstOutput = path.relative(frameworkRoot, path.join(outputDirectory, "first.json"));
  const secondOutput = path.relative(frameworkRoot, path.join(outputDirectory, "second.json"));
  try {
    const first = runCli(["--input", committedEvalPack, "--repo-root", frameworkRoot, "--output", firstOutput]);
    const second = runCli(["--input", committedEvalPack, "--repo-root", frameworkRoot, "--output", secondOutput]);

    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(
      readFileSync(path.join(outputDirectory, "first.json")),
      readFileSync(path.join(outputDirectory, "second.json")),
    );
    assert.deepEqual(readFileSync(path.join(outputDirectory, "first.json")), readFileSync(committedEvalSnapshot));
    assert.deepEqual(
      JSON.parse(first.stdout).cases.map(({ id }) => id),
      [
        "change-brief",
        "generated-freshness",
        "guarantee-impact",
        "ownership-member",
        "product-explanation",
        "required-anchors",
      ],
    );
    const format = runPrettier([
      path.join(outputDirectory, "first.json"),
      path.join(outputDirectory, "second.json"),
      committedEvalSnapshot,
    ]);
    assert.equal(format.status, 0, format.output);
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("generated freshness eval fails through query evidence when a generated graph is stale", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "ddduck-agent-evals-stale-"));
  const productRoot = path.join(repoRoot, "examples", "reminders", "ddd");
  const inputPath = path.join(repoRoot, "generated-freshness.jsonl");
  const generatedFreshness = readFileSync(committedEvalPack, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find(({ id }) => id === "generated-freshness");

  assert.ok(generatedFreshness, "generated-freshness record is required");
  try {
    cpSync(path.join(frameworkRoot, "examples", "reminders", "ddd"), productRoot, { recursive: true });
    writeFileSync(path.join(productRoot, "generated", "graph", "model-graph.json"), "stale\n");
    writeFileSync(inputPath, `${JSON.stringify(generatedFreshness)}\n`);

    const result = runAgentReadinessEvals({ inputPath, repoRoot });

    assert.equal(result.passed, false);
    assert.deepEqual(
      result.cases.map(({ id }) => id),
      ["generated-freshness"],
    );
    assert.equal(result.cases[0].evidence.origin, "query");
    assert.match(
      result.cases[0].diagnostics.join("\n"),
      /fact does not strictly equal query value at \/result\/generatedViews\/1\/freshness/,
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("query-grounded evals sort cases and accept exact citations and facts", () => {
  const fixture = evalFixture([validRecord({ id: "z-last" }), validRecord({ id: "ownership-member" })]);

  const result = runAgentReadinessEvals({ inputPath: fixture.inputPath, repoRoot: fixture.repoRoot });

  assert.deepEqual(
    result.cases.map(({ id, passed, diagnostics, query, root }) => ({ id, passed, diagnostics, query, root })),
    [
      {
        id: "ownership-member",
        root: "examples/reminders/ddd",
        query: { operation: "node", args: ["--id", "concept:member"] },
        passed: true,
        diagnostics: [],
      },
      {
        id: "z-last",
        root: "examples/reminders/ddd",
        query: { operation: "node", args: ["--id", "concept:member"] },
        passed: true,
        diagnostics: [],
      },
    ],
  );
  assert.match(result.cases[0].sourceDigest, /^[a-f0-9]{64}$/);
});

test("query-grounded evals accept an equivalent JSON array fact", () => {
  const fixture = evalFixture([
    validRecord({
      id: "required-anchors",
      operation: "anchors",
      args: ["--id", "interface:create-reminder"],
      citations: [{ id: "interface:create-reminder", sourcePath: "model/interfaces/create-reminder.yaml" }],
      facts: [{ pointer: "/result/missingEvidence", equals: [] }],
    }),
  ]);

  const result = runAgentReadinessEvals({ inputPath: fixture.inputPath, repoRoot: fixture.repoRoot });

  assert.equal(result.passed, true);
  assert.deepEqual(result.cases[0].diagnostics, []);
});

test("query-grounded evals return every evidence failure without throwing", () => {
  const fixture = evalFixture([
    validRecord({
      id: "invented-citation",
      citations: [{ id: "concept:invented", sourcePath: "model/concepts/invented.yaml" }],
    }),
    validRecord({
      id: "wrong-citation-path",
      citations: [{ id: "concept:member", sourcePath: "model/concepts/not-member.yaml" }],
    }),
    validRecord({ id: "filesystem-origin", origin: "filesystem" }),
    validRecord({
      id: "malformed-pointer",
      facts: [{ pointer: "/result/node/~2ownerDomain", equals: "domain:members" }],
    }),
    validRecord({ id: "duplicate-id" }),
    validRecord({ id: "duplicate-id" }),
    validRecord({ id: "unsupported-flag", args: ["--id", "concept:member", "--history"] }),
  ]);

  const result = runAgentReadinessEvals({ inputPath: fixture.inputPath, repoRoot: fixture.repoRoot });

  assert.equal(result.passed, false);
  assert.deepEqual(
    result.cases.map(({ id, passed }) => ({ id, passed })),
    [
      { id: "duplicate-id", passed: false },
      { id: "duplicate-id", passed: false },
      { id: "filesystem-origin", passed: false },
      { id: "invented-citation", passed: false },
      { id: "malformed-pointer", passed: false },
      { id: "unsupported-flag", passed: false },
      { id: "wrong-citation-path", passed: false },
    ],
  );
  assert.match(caseDiagnostic(result, "invented-citation"), /citation.*concept:invented/);
  assert.match(caseDiagnostic(result, "wrong-citation-path"), /citation.*not-member\.yaml/);
  assert.match(caseDiagnostic(result, "filesystem-origin"), /origin.*query/);
  assert.match(caseDiagnostic(result, "malformed-pointer"), /JSON Pointer/);
  assert.match(caseDiagnostic(result, "duplicate-id"), /duplicate/i);
  assert.match(caseDiagnostic(result, "unsupported-flag"), /--history/);
});

test("query-grounded evals reject unknown keys at every contract level", () => {
  const fixture = evalFixture([
    { ...validRecord({ id: "unknown-record-command" }), command: "cat product.yaml" },
    { ...validRecord({ id: "unknown-record-callback" }), callback: "agent" },
    { ...validRecord({ id: "unknown-record-filesystem" }), filesystemPath: "model/concepts/member.yaml" },
    { ...validRecord({ id: "unknown-record-prose" }), expectedProse: "Member ownership explanation" },
    {
      ...validRecord({ id: "unknown-query" }),
      query: { operation: "node", args: ["--id", "concept:member"], callback: "agent" },
    },
    {
      ...validRecord({ id: "unknown-evidence" }),
      candidateEvidence: {
        ...validRecord({ id: "unused" }).candidateEvidence,
        filesystemPath: "model/concepts/member.yaml",
      },
    },
    {
      ...validRecord({ id: "unknown-citation" }),
      candidateEvidence: {
        ...validRecord({ id: "unused" }).candidateEvidence,
        citations: [{ id: "concept:member", sourcePath: "model/concepts/member.yaml", callback: "agent" }],
      },
    },
    {
      ...validRecord({ id: "unknown-fact" }),
      candidateEvidence: {
        ...validRecord({ id: "unused" }).candidateEvidence,
        facts: [{ pointer: "/result/node/ownerDomain", equals: "domain:members", expectedProse: "Members" }],
      },
    },
  ]);

  const result = runAgentReadinessEvals({ inputPath: fixture.inputPath, repoRoot: fixture.repoRoot });

  assert.equal(result.passed, false);
  for (const [id, key] of [
    ["unknown-record-command", "command"],
    ["unknown-record-callback", "callback"],
    ["unknown-record-filesystem", "filesystemPath"],
    ["unknown-record-prose", "expectedProse"],
    ["unknown-query", "callback"],
    ["unknown-evidence", "filesystemPath"],
    ["unknown-citation", "callback"],
    ["unknown-fact", "expectedProse"],
  ]) {
    assert.equal(result.cases.find((entry) => entry.id === id).passed, false);
    assert.match(caseDiagnostic(result, id), new RegExp(`unknown key: ${key}`));
  }
  assert.deepEqual(result.cases.find((entry) => entry.id === "unknown-citation").evidence.citations, [
    { id: "concept:member", sourcePath: "model/concepts/member.yaml" },
  ]);
  assert.deepEqual(result.cases.find((entry) => entry.id === "unknown-fact").evidence.facts, [
    { pointer: "/result/node/ownerDomain", equals: "domain:members" },
  ]);
});

test("query-grounded evals reject empty input, product-root symlinks, and malformed evidence after query failures", () => {
  const emptyFixture = evalFixture([]);
  writeFileSync(emptyFixture.inputPath, " \n\n");
  const empty = runAgentReadinessEvals({ inputPath: emptyFixture.inputPath, repoRoot: emptyFixture.repoRoot });
  assert.equal(empty.passed, false);
  assert.match(empty.cases[0].diagnostics.join("\n"), /at least one non-empty/i);

  const symlinkFixture = evalFixture([validRecord({ id: "symlink-root", root: "linked-product" })]);
  const externalProduct = mkdtempSync(path.join(tmpdir(), "ddduck-agent-evals-external-"));
  cpSync(path.join(symlinkFixture.repoRoot, "examples", "reminders", "ddd"), externalProduct, { recursive: true });
  symlinkSync(externalProduct, path.join(symlinkFixture.repoRoot, "linked-product"));
  const symlinked = runAgentReadinessEvals({ inputPath: symlinkFixture.inputPath, repoRoot: symlinkFixture.repoRoot });
  assert.equal(symlinked.passed, false);
  assert.match(symlinked.cases[0].diagnostics.join("\n"), /below repoRoot/);

  const malformedFixture = evalFixture([
    {
      ...validRecord({ id: "query-and-evidence-fail" }),
      root: "missing-product",
      candidateEvidence: { origin: "query", citations: "bad", facts: [] },
    },
  ]);
  const malformed = runAgentReadinessEvals({
    inputPath: malformedFixture.inputPath,
    repoRoot: malformedFixture.repoRoot,
  });
  assert.equal(malformed.passed, false);
  assert.match(malformed.cases[0].diagnostics.join("\n"), /citations must be an array/);
  assert.match(malformed.cases[0].diagnostics.join("\n"), /query failed/);
});

test("eval CLI writes identical JSON and returns one when any case fails", () => {
  const fixture = evalFixture([validRecord({ id: "ownership-member" })]);
  const outputPath = "results/evals.json";
  const success = runCli(["--input", fixture.inputPath, "--repo-root", fixture.repoRoot, "--output", outputPath]);

  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /\n$/);
  assert.equal(readFileSync(path.join(fixture.repoRoot, outputPath), "utf8"), success.stdout);
  assert.equal(JSON.parse(success.stdout).passed, true);

  writeFileSync(
    fixture.inputPath,
    `${JSON.stringify(validRecord({ id: "filesystem-origin", origin: "filesystem" }))}\n`,
  );
  const failure = runCli(["--input", fixture.inputPath, "--repo-root", fixture.repoRoot]);

  assert.equal(failure.status, 1, failure.stderr);
  assert.match(failure.stdout, /\n$/);
  assert.equal(JSON.parse(failure.stdout).passed, false);
});

test("eval CLI rejects absolute and escaping output paths before writing JSON", () => {
  const fixture = evalFixture([validRecord({ id: "ownership-member" })]);

  for (const outputPath of [path.join(fixture.repoRoot, "outside.json"), "../outside.json"]) {
    const result = runCli(["--input", fixture.inputPath, "--repo-root", fixture.repoRoot, "--output", outputPath]);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /output path/);
  }
});

test("eval CLI rejects protected and symlinked output paths before writing JSON", () => {
  const fixture = evalFixture([validRecord({ id: "ownership-member" })]);
  const externalDirectory = mkdtempSync(path.join(tmpdir(), "ddduck-agent-evals-output-"));
  symlinkSync(externalDirectory, path.join(fixture.repoRoot, "linked-output"));

  for (const outputPath of [".git/HEAD", "linked-output/result.json"]) {
    const result = runCli(["--input", fixture.inputPath, "--repo-root", fixture.repoRoot, "--output", outputPath]);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /output path/);
  }
  assert.equal(existsSync(path.join(externalDirectory, "result.json")), false);
});

function validRecord({
  id,
  root = "examples/reminders/ddd",
  operation = "node",
  args = ["--id", "concept:member"],
  citations,
  facts,
  origin = "query",
}) {
  return {
    schemaVersion: "1",
    id,
    root,
    query: { operation, args },
    candidateEvidence: {
      origin,
      citations: citations ?? [{ id: "concept:member", sourcePath: "model/concepts/member.yaml" }],
      facts: facts ?? [{ pointer: "/result/node/ownerDomain", equals: "domain:members" }],
    },
  };
}

function evalFixture(records) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "ddduck-agent-evals-"));
  const productRoot = path.join(repoRoot, "examples", "reminders", "ddd");
  cpSync(path.join(frameworkRoot, "examples", "reminders", "ddd"), productRoot, { recursive: true });
  const inputPath = path.join(repoRoot, "agent-readiness-evals.jsonl");
  writeFileSync(inputPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  return { inputPath, repoRoot };
}

function copiedReferenceProduct(label) {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), `ddduck-agent-evals-${label}-`));
  const productRoot = path.join(fixtureRoot, "ddd");
  cpSync(referenceProduct, productRoot, { recursive: true });
  return productRoot;
}

function caseDiagnostic(result, id) {
  const matchingCase = result.cases.find((entry) => entry.id === id);
  assert.ok(matchingCase, `missing ${id} result`);
  return matchingCase.diagnostics.join("\n");
}

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: frameworkRoot, encoding: "utf8" });
}

function runReportCli(args) {
  return spawnSync(process.execPath, [reportCli, ...args], { cwd: frameworkRoot, encoding: "utf8" });
}

function runPrettier(paths) {
  const result = spawnSync("prettier", ["--check", ...paths], { cwd: frameworkRoot, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}
