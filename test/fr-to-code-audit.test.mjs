import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { parse, stringify } from "yaml";
import { verifyFrToCodeAudit } from "../scripts/lib/fr-to-code-audit.mjs";

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const auditCli = path.join(frameworkRoot, "scripts", "audit-fr-to-code.mjs");
const auditSchema = JSON.parse(
  readFileSync(path.join(frameworkRoot, "schemas", "fr-to-code-audit.schema.json"), "utf8"),
);
const validateAuditStructure = new Ajv2020({ allErrors: true, strict: true }).compile(auditSchema);

test("audit CLI help is a successful one-stream response", () => {
  const result = runAudit(["--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: audit-fr-to-code/);
  assert.equal(result.stderr, "");
});

const fixtureReader = {
  readFile(source, relativePath) {
    const key = `${source.id}:${relativePath}`;
    const text = fixtureFiles.get(key);
    if (text === undefined) throw new Error(`Missing fixture file ${key}`);
    return text;
  },
};

const fixtureFiles = new Map([
  [
    "source:spec:specs/members.md",
    "# Members\n\nFR-005 excludes archived members from the ordinary list.\nMEMBERS-INV-05 applies.\n",
  ],
  ["source:code:src/members.js", "export function listMembers() {\n  return activeMembers();\n}\n"],
  [
    "source:code:test/members.test.js",
    "test('lists active members', () => {\n  assert.deepEqual(listMembers(), []);\n});\n",
  ],
  ["source:z:src/z.js", "export const z = true;\n"],
  ["source:ä:src/ä.js", "export const a = true;\n"],
]);

test("renders a qualified realized-and-tested audit with deterministic SHA-256 excerpts", () => {
  const report = verifyFrToCodeAudit(validRecord(), fixtureReader);

  assert.equal(report.kind, "FrToCodeAuditReport");
  assert.deepEqual(
    report.sources.map((source) => source.id),
    ["source:code", "source:spec"],
  );
  assert.equal(report.requirement.qualifier, "ordinary-member-list");
  assert.deepEqual(report.coverage, {
    includes: ["Default GET /api/members listing"],
    excludes: ["Pickers and admin management"],
  });
  assert.deepEqual(report.productionAnchors[0], {
    sourceId: "source:code",
    path: "src/members.js",
    startLine: 1,
    endLine: 2,
    excerptDigest: {
      algorithm: "sha256",
      value: sha256("export function listMembers() {\n  return activeMembers();"),
    },
  });
  assert.equal(report.testAnchors[0].excerptDigest.algorithm, "sha256");
  assert.deepEqual(report.diagnostics, []);
});

test("rejects evidence whose source ID is not declared", () => {
  const record = validRecord();
  record.productionAnchors[0].sourceId = "source:missing";

  assert.throws(() => verifyFrToCodeAudit(record, fixtureReader), /undeclared source ID source:missing/);
});

test("rejects missing opaque requirement and traced-guarantee text without parsing their grammar", () => {
  const missingRequirement = validRecord();
  missingRequirement.requirement.id = "FR-404";
  assert.throws(() => verifyFrToCodeAudit(missingRequirement, fixtureReader), /requirement ID FR-404 is missing/);

  const missingTrace = validRecord();
  missingTrace.requirement.tracedGuarantee = "MEMBERS-INV-404";
  assert.throws(() => verifyFrToCodeAudit(missingTrace, fixtureReader), /traced guarantee MEMBERS-INV-404 is missing/);
});

test("rejects absolute and lexical-escape anchor paths before reading evidence", () => {
  const absolute = validRecord();
  absolute.productionAnchors[0].path = "/src/members.js";
  assert.throws(() => verifyFrToCodeAudit(absolute, fixtureReader), /source-relative/);

  const escaped = validRecord();
  escaped.productionAnchors[0].path = "../src/members.js";
  assert.throws(() => verifyFrToCodeAudit(escaped, fixtureReader), /source-relative/);
});

test("rejects anchor line ranges outside the pinned blob", () => {
  const record = validRecord();
  record.productionAnchors[0].endLine = 9;

  assert.throws(() => verifyFrToCodeAudit(record, fixtureReader), /outside source:code:src\/members\.js/);
});

test("rejects records missing a qualifier or either explicit coverage boundary", () => {
  const missingQualifier = validRecord();
  delete missingQualifier.requirement.qualifier;
  assert.throws(() => verifyFrToCodeAudit(missingQualifier, fixtureReader), /must match the audit schema/);

  const missingIncludes = validRecord();
  delete missingIncludes.coverage.includes;
  assert.throws(() => verifyFrToCodeAudit(missingIncludes, fixtureReader), /must match the audit schema/);

  const missingExcludes = validRecord();
  delete missingExcludes.coverage.excludes;
  assert.throws(() => verifyFrToCodeAudit(missingExcludes, fixtureReader), /must match the audit schema/);
});

test("requires both kinds of evidence for realized-and-tested", () => {
  const record = validRecord();
  record.testAnchors = [];

  assert.throws(
    () => verifyFrToCodeAudit(record, fixtureReader),
    /realized-and-tested requires production and test anchors/,
  );
});

test("rejects test evidence from a realized-untested audit", () => {
  const record = validRecord();
  record.verdict = "realized-untested";

  assert.throws(
    () => verifyFrToCodeAudit(record, fixtureReader),
    /realized-untested requires production anchors and no test anchors/,
  );
});

test("rejects evidence from an unrealized audit", () => {
  const record = validRecord();
  record.verdict = "unrealized";

  assert.throws(() => verifyFrToCodeAudit(record, fixtureReader), /unrealized permits no production or test anchors/);
});

test("supports a slice-local requirement with no traced guarantee", () => {
  const record = validRecord();
  delete record.requirement.tracedGuarantee;

  const report = verifyFrToCodeAudit(record, fixtureReader);

  assert.equal("tracedGuarantee" in report.requirement, false);
});

test("sorts non-ASCII source IDs and anchors by locale-independent lexical order", () => {
  const record = validRecord();
  record.sources.push(
    {
      id: "source:ä",
      repository: "git@example.test:a.git",
      revision: "0123456789abcdef0123456789abcdef01234567",
    },
    {
      id: "source:z",
      repository: "git@example.test:z.git",
      revision: "0123456789abcdef0123456789abcdef01234567",
    },
  );
  record.productionAnchors.push(
    { sourceId: "source:ä", path: "src/ä.js", startLine: 1, endLine: 1 },
    { sourceId: "source:z", path: "src/z.js", startLine: 1, endLine: 1 },
  );

  const report = verifyFrToCodeAudit(record, fixtureReader);

  assert.deepEqual(
    report.sources.map((source) => source.id),
    ["source:code", "source:spec", "source:z", "source:ä"],
  );
  assert.deepEqual(
    report.productionAnchors.map((anchor) => anchor.sourceId),
    ["source:code", "source:z", "source:ä"],
  );
});

test("keeps source-ID uniqueness within a record as a semantic verifier rule beyond structural schema validation", () => {
  const record = validRecord();
  record.sources.push({
    id: "source:code",
    repository: "git@example.test:duplicate.git",
    revision: "0123456789abcdef0123456789abcdef01234567",
  });

  assert.equal(validateAuditStructure(record), true, JSON.stringify(validateAuditStructure.errors));
  assert.throws(() => verifyFrToCodeAudit(record, fixtureReader), /sources must have unique IDs/);
});

test("audits only blobs from declared pinned revisions and emits one JSON document", () => {
  const fixture = gitAuditFixture();
  writeFileSync(path.join(fixture.spec.root, "specs", "members.md"), "working tree must not be read\n");
  writeFileSync(path.join(fixture.code.root, "src", "members.js"), "working tree must not be read\n");
  const recordPath = writeAuditRecord(fixture.record);

  const result = runAudit([
    "--input",
    recordPath,
    "--source-root",
    `source:spec=${fixture.spec.root}`,
    "--source-root",
    `source:code=${fixture.code.root}`,
    "--json",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).verdict, "realized-and-tested");
  assert.equal(result.stdout, `${JSON.stringify(JSON.parse(result.stdout))}\n`);
});

test("runs the published FR-005 ordinary-member-list proof shape against a temporary Git checkout", () => {
  const record = parse(
    readFileSync(path.join(frameworkRoot, "examples", "audit-reports", "members-ordinary-list.yaml"), "utf8"),
  );
  const expectedCoverage = {
    includes: ["Default GET /api/members list returns active members only"],
    excludes: ["Member pickers", "Assignment and recipient targets", "Admin archived-member management tab"],
  };

  assert.equal(validateAuditStructure(record), true, JSON.stringify(validateAuditStructure.errors));
  assert.deepEqual(record.sources, [
    {
      id: "source:example-app",
      repository: "git@github.com:example/example-app.git",
      revision: "dd4a2aa5a1e11c5b84e1b7798e49bb3e3acd69ef",
    },
  ]);
  assert.deepEqual(record.requirement, {
    sourceId: "source:example-app",
    sourcePath: "specs/members/spec.md",
    id: "FR-005",
    qualifier: "ordinary-member-list",
    tracedGuarantee: "MEMBERS-INV-05",
  });
  assert.deepEqual(record.coverage, expectedCoverage);
  assert.equal(record.verdict, "realized-and-tested");
  assert.deepEqual(record.productionAnchors, [
    {
      sourceId: "source:example-app",
      path: "src/server/modules/members/referential.ts",
      startLine: 21,
      endLine: 26,
    },
    { sourceId: "source:example-app", path: "src/server/modules/members/index.ts", startLine: 337, endLine: 339 },
    { sourceId: "source:example-app", path: "src/server/modules/members/index.ts", startLine: 420, endLine: 423 },
    { sourceId: "source:example-app", path: "src/server/routes/members.ts", startLine: 25, endLine: 29 },
  ]);
  assert.deepEqual(record.testAnchors, [
    {
      sourceId: "source:example-app",
      path: "tests/boundary/member-list-lifecycle.test.ts",
      startLine: 54,
      endLine: 89,
    },
  ]);

  const fixture = gitAuditFixtureForPublishedProof(record);
  const fixtureRecord = JSON.parse(JSON.stringify(record));
  fixtureRecord.sources[0].revision = fixture.revision;
  const recordPath = writeAuditRecord(fixtureRecord);
  const result = runAudit(["--input", recordPath, "--source-root", `source:example-app=${fixture.root}`, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.verdict, "realized-and-tested");
  assert.deepEqual(report.requirement, fixtureRecord.requirement);
  assert.deepEqual(report.coverage, expectedCoverage);
});

test("requires --json and rejects unknown CLI arguments", () => {
  const fixture = gitAuditFixture();
  const recordPath = writeAuditRecord(fixture.record);
  const sourceRoots = [
    "--input",
    recordPath,
    "--source-root",
    `source:spec=${fixture.spec.root}`,
    "--source-root",
    `source:code=${fixture.code.root}`,
  ];

  const missingJson = runAudit(sourceRoots);
  assert.notEqual(missingJson.status, 0);
  assert.match(missingJson.stderr, /requires --json/);
  assert.equal(missingJson.stdout, "");

  const unknown = runAudit([...sourceRoots, "--json", "--root", fixture.code.root]);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown option --root/);
  assert.equal(unknown.stdout, "");
});

test("requires exactly one source-root mapping for every declared source", () => {
  const fixture = gitAuditFixture();
  const recordPath = writeAuditRecord(fixture.record);

  const duplicate = runAudit([
    "--input",
    recordPath,
    "--source-root",
    `source:spec=${fixture.spec.root}`,
    "--source-root",
    `source:code=${fixture.code.root}`,
    "--source-root",
    `source:code=${fixture.code.root}`,
    "--json",
  ]);
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /exactly one --source-root mapping for source:code/);

  const missing = runAudit(["--input", recordPath, "--source-root", `source:spec=${fixture.spec.root}`, "--json"]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /exactly one --source-root mapping for source:code/);
});

test("rejects a checkout whose origin does not exactly match its declared repository", () => {
  const fixture = gitAuditFixture();
  runGit(fixture.code.root, ["remote", "set-url", "origin", "git@example.test:wrong.git"]);
  const recordPath = writeAuditRecord(fixture.record);

  const result = runAudit(auditArguments(recordPath, fixture));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /origin URL does not match declared repository for source:code/);
  assert.equal(result.stdout, "");
});

test("rejects a declared revision that is absent from its mapped checkout", () => {
  const fixture = gitAuditFixture();
  fixture.record.sources.find((source) => source.id === "source:code").revision = "f".repeat(40);
  const recordPath = writeAuditRecord(fixture.record);

  const result = runAudit(auditArguments(recordPath, fixture));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /declared revision is absent from checkout for source:code/);
  assert.equal(result.stdout, "");
});

test("rejects an option-shaped revision at record intake before any git invocation", () => {
  const fixture = gitAuditFixture();
  fixture.record.sources.find((source) => source.id === "source:code").revision = "--upload-pack=/bin/false";
  const recordPath = writeAuditRecord(fixture.record);

  const result = runAudit([
    "--input",
    recordPath,
    "--source-root",
    "source:spec=/nonexistent-checkout",
    "--source-root",
    "source:code=/nonexistent-checkout",
    "--json",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /audit source revision must be a 40-character lowercase hex commit ID for source:code/);
  assert.equal(result.stdout, "");
});

test("rejects source paths that are absent from their pinned commit", () => {
  const fixture = gitAuditFixture();
  fixture.record.productionAnchors[0].path = "src/missing.js";
  const recordPath = writeAuditRecord(fixture.record);

  const result = runAudit(auditArguments(recordPath, fixture));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source:code:src\/missing\.js/);
  assert.equal(result.stdout, "");
});

test("rejects a directory anchor from the pinned Git tree", () => {
  const fixture = gitAuditFixture();
  fixture.record.productionAnchors[0].path = "src";
  const recordPath = writeAuditRecord(fixture.record);

  const result = runAudit(auditArguments(recordPath, fixture));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pinned tree entry is not a regular file for source:code:src/);
  assert.equal(result.stdout, "");
});

test("rejects a symlink anchor from the pinned Git tree", () => {
  const fixture = gitAuditFixture();
  const linkPath = path.join(fixture.code.root, "src", "members-link.js");
  symlinkSync("members.js", linkPath);
  runGit(fixture.code.root, ["add", "src/members-link.js"]);
  runGit(fixture.code.root, ["commit", "-qm", "add symlink anchor"]);
  fixture.record.sources.find((source) => source.id === "source:code").revision = runGit(fixture.code.root, [
    "rev-parse",
    "HEAD",
  ]).stdout.trim();
  fixture.record.productionAnchors[0] = {
    sourceId: "source:code",
    path: "src/members-link.js",
    startLine: 1,
    endLine: 1,
  };
  const recordPath = writeAuditRecord(fixture.record);

  const result = runAudit(auditArguments(recordPath, fixture));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pinned tree entry is not a regular file for source:code:src\/members-link\.js/);
  assert.equal(result.stdout, "");
});

function validRecord() {
  return {
    schemaVersion: "1",
    kind: "FrToCodeAudit",
    id: "audit:members-ordinary-list",
    sources: [
      {
        id: "source:spec",
        repository: "git@example.test:product-specs.git",
        revision: "0123456789abcdef0123456789abcdef01234567",
      },
      {
        id: "source:code",
        repository: "git@example.test:product.git",
        revision: "89abcdef0123456789abcdef0123456789abcdef",
      },
    ],
    requirement: {
      sourceId: "source:spec",
      sourcePath: "specs/members.md",
      id: "FR-005",
      qualifier: "ordinary-member-list",
      tracedGuarantee: "MEMBERS-INV-05",
    },
    coverage: {
      includes: ["Default GET /api/members listing"],
      excludes: ["Pickers and admin management"],
    },
    verdict: "realized-and-tested",
    productionAnchors: [{ sourceId: "source:code", path: "src/members.js", startLine: 1, endLine: 2 }],
    testAnchors: [{ sourceId: "source:code", path: "test/members.test.js", startLine: 1, endLine: 2 }],
    reviewerDisposition: "accepted",
  };
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function gitAuditFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "ddduck-fr-audit-"));
  const spec = createGitRepository(root, "spec", "git@example.test:product-specs.git", {
    "specs/members.md":
      "# Members\n\nFR-005 excludes archived members from the ordinary list.\nMEMBERS-INV-05 applies.\n",
  });
  const code = createGitRepository(root, "code", "git@example.test:product.git", {
    "src/members.js": [
      "export function listMembers() {",
      "  return activeMembers();",
      "}",
      "test('lists active members', () => { assert.deepEqual(listMembers(), []); });",
      "",
    ].join("\n"),
  });
  const record = validRecord();
  record.sources.find((source) => source.id === "source:spec").revision = spec.revision;
  record.sources.find((source) => source.id === "source:code").revision = code.revision;
  record.testAnchors[0] = { sourceId: "source:code", path: "src/members.js", startLine: 4, endLine: 4 };
  return { spec, code, record };
}

function gitAuditFixtureForPublishedProof(record) {
  const root = mkdtempSync(path.join(tmpdir(), "ddduck-fr-audit-proof-"));
  const source = record.sources[0];
  const anchors = [
    { path: record.requirement.sourcePath, startLine: 65, endLine: 66, text: "FR-005 MEMBERS-INV-05" },
    ...record.productionAnchors.map((anchor, index) => ({
      path: anchor.path,
      startLine: anchor.startLine,
      endLine: anchor.endLine,
      text: `production anchor ${index + 1}`,
    })),
    ...record.testAnchors.map((anchor, index) => ({
      path: anchor.path,
      startLine: anchor.startLine,
      endLine: anchor.endLine,
      text: `test anchor ${index + 1}`,
    })),
  ];
  const files = new Map();
  for (const anchor of anchors) {
    const lines = files.get(anchor.path) ?? [];
    while (lines.length < anchor.endLine) lines.push("");
    for (let line = anchor.startLine; line <= anchor.endLine; line += 1) lines[line - 1] = anchor.text;
    files.set(anchor.path, lines);
  }
  return createGitRepository(
    root,
    "example-app",
    source.repository,
    Object.fromEntries([...files].map(([filePath, lines]) => [filePath, `${lines.join("\n")}\n`])),
  );
}

function createGitRepository(parent, name, repository, files) {
  const root = path.join(parent, name);
  mkdirSync(root, { recursive: true });
  runGit(root, ["init", "-q"]);
  runGit(root, ["config", "user.name", "ddduck Tests"]);
  runGit(root, ["config", "user.email", "tests@example.test"]);
  runGit(root, ["remote", "add", "origin", repository]);
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  }
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-qm", "fixture"]);
  return { root, revision: runGit(root, ["rev-parse", "HEAD"]).stdout.trim() };
}

function writeAuditRecord(record) {
  const root = mkdtempSync(path.join(tmpdir(), "ddduck-fr-audit-record-"));
  const recordPath = path.join(root, "audit.yaml");
  writeFileSync(recordPath, stringify(record));
  return recordPath;
}

function auditArguments(recordPath, fixture) {
  return [
    "--input",
    recordPath,
    "--source-root",
    `source:spec=${fixture.spec.root}`,
    "--source-root",
    `source:code=${fixture.code.root}`,
    "--json",
  ];
}

function runAudit(args) {
  return spawnSync(process.execPath, [auditCli, ...args], { cwd: frameworkRoot, encoding: "utf8" });
}

function runGit(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result;
}
