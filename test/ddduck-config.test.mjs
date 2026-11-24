import assert from "node:assert/strict";
import fs, { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  configCandidates,
  defaultConfigIgnore,
  findDdduckConfigFile,
  findRepositoryRoot,
  initConfigRelativePath,
  loadDdduckConfig,
  resolveConfiguredIgnores,
  writeInitConfigIfAbsent,
} from "../scripts/lib/ddduck-config.mjs";

function makeRepo() {
  const repo = mkdtempSync(path.join(tmpdir(), "ddduck-config-"));
  mkdirSync(path.join(repo, ".git"), { recursive: true });
  return repo;
}

function writeConfig(repo, value) {
  mkdirSync(path.join(repo, ".ddduck"), { recursive: true });
  writeFileSync(path.join(repo, ".ddduck", "config.json"), `${JSON.stringify(value, null, 2)}\n`);
}

test("findRepositoryRoot falls back to the containing directory when a file has no .git ancestor", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ddduck-reporoot-"));
  const file = path.join(dir, "some-file.txt");
  writeFileSync(file, "x\n");
  // With no .git anywhere above a temp dir the fallback must be the file's
  // directory, never the file path itself (callers treat it as a directory).
  assert.equal(findRepositoryRoot(file), path.resolve(dir));
});

test("findRepositoryRoot returns the directory itself when it has no .git ancestor", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ddduck-reporoot-dir-"));
  assert.equal(findRepositoryRoot(dir), path.resolve(dir));
});

test("resolveConfiguredIgnores returns defaults when config is absent", () => {
  assert.deepEqual(resolveConfiguredIgnores(makeRepo()), [...defaultConfigIgnore]);
});

test("resolveConfiguredIgnores returns defaults when the ignore key is absent", () => {
  const repo = makeRepo();
  writeConfig(repo, { schemaVersion: "1", productRoot: "docs/ddd" });
  assert.deepEqual(resolveConfiguredIgnores(repo), [...defaultConfigIgnore]);
});

test("resolveConfiguredIgnores returns the declared list verbatim, including empty", () => {
  const repo = makeRepo();
  writeConfig(repo, { schemaVersion: "1", productRoot: "docs/ddd", ignore: ["custom"] });
  assert.deepEqual(resolveConfiguredIgnores(repo), ["custom"]);
  writeConfig(repo, { schemaVersion: "1", productRoot: "docs/ddd", ignore: [] });
  assert.deepEqual(resolveConfiguredIgnores(repo), []);
});

test("loadDdduckConfig rejects a non-array ignore", () => {
  const repo = makeRepo();
  writeConfig(repo, { schemaVersion: "1", productRoot: "docs/ddd", ignore: "vendor" });
  assert.throws(() => loadDdduckConfig(repo), /ignore must be an array/);
});

test("loadDdduckConfig rejects ignore entries with path separators", () => {
  const repo = makeRepo();
  writeConfig(repo, { schemaVersion: "1", productRoot: "docs/ddd", ignore: ["a/b"] });
  assert.throws(() => loadDdduckConfig(repo), /plain directory names/);
});

test("loadDdduckConfig rejects empty ignore entries", () => {
  const repo = makeRepo();
  writeConfig(repo, { schemaVersion: "1", productRoot: "docs/ddd", ignore: [""] });
  assert.throws(() => loadDdduckConfig(repo), /non-empty/);
});

test("loadDdduckConfig rejects ignore entries equal to .", () => {
  const repo = makeRepo();
  writeConfig(repo, { schemaVersion: "1", productRoot: "docs/ddd", ignore: ["."] });
  assert.throws(() => loadDdduckConfig(repo), /plain directory names/);
});

test("loadDdduckConfig rejects ignore entries equal to ..", () => {
  const repo = makeRepo();
  writeConfig(repo, { schemaVersion: "1", productRoot: "docs/ddd", ignore: [".."] });
  assert.throws(() => loadDdduckConfig(repo), /plain directory names/);
});

test("loadDdduckConfig rejects ignore entries containing backslash", () => {
  const repo = makeRepo();
  writeConfig(repo, { schemaVersion: "1", productRoot: "docs/ddd", ignore: ["a\\b"] });
  assert.throws(() => loadDdduckConfig(repo), /plain directory names/);
});

function writeAt(repo, relativePath, source) {
  mkdirSync(path.dirname(path.join(repo, relativePath)), { recursive: true });
  writeFileSync(path.join(repo, relativePath), source);
}

const sources = {
  json: '{ "schemaVersion": "1", "productRoot": "specs", "ignore": ["out"] }\n',
  jsonc:
    '// comment\n{\n  "schemaVersion": "1", // inline\n  /* block */ "productRoot": "specs",\n  "ignore": ["out"]\n}\n',
  yaml: '# comment\nschemaVersion: "1"\nproductRoot: specs\nignore: [out]\n',
};
sources.yml = sources.yaml;

test("configCandidates lists .config/, then ddduck.config.*, then .ddduck/ in json, jsonc, yaml, yml order", () => {
  assert.deepEqual(configCandidates, [
    ".config/ddduck.json",
    ".config/ddduck.jsonc",
    ".config/ddduck.yaml",
    ".config/ddduck.yml",
    "ddduck.config.json",
    "ddduck.config.jsonc",
    "ddduck.config.yaml",
    "ddduck.config.yml",
    ".ddduck/config.json",
    ".ddduck/config.jsonc",
    ".ddduck/config.yaml",
    ".ddduck/config.yml",
  ]);
});

for (const candidate of configCandidates) {
  test(`loadDdduckConfig reads ${candidate}`, () => {
    const repo = makeRepo();
    writeAt(repo, candidate, sources[path.extname(candidate).slice(1)]);
    assert.equal(findDdduckConfigFile(repo), candidate);
    assert.deepEqual(loadDdduckConfig(repo), { schemaVersion: "1", productRoot: "specs", ignore: ["out"] });
  });
}

test("loadDdduckConfig refuses several config files and lists them in documented order", () => {
  const repo = makeRepo();
  writeAt(repo, ".ddduck/config.json", sources.json);
  writeAt(repo, ".config/ddduck.yaml", sources.yaml);
  assert.throws(
    () => loadDdduckConfig(repo),
    (error) =>
      /Multiple ddduck configuration files found .*: \.config\/ddduck\.yaml, \.ddduck\/config\.json; keep exactly one/.test(
        error.message,
      ) && /Merge the settings/.test(error.nextAction),
  );
});

test("loadDdduckConfig refuses .yaml and .yml side by side", () => {
  const repo = makeRepo();
  writeAt(repo, "ddduck.config.yaml", sources.yaml);
  writeAt(repo, "ddduck.config.yml", sources.yaml);
  assert.throws(() => loadDdduckConfig(repo), /ddduck\.config\.yaml, ddduck\.config\.yml/);
});

test("loadDdduckConfig names the actual file in validation errors", () => {
  const repo = makeRepo();
  writeAt(repo, ".config/ddduck.yml", 'schemaVersion: "2"\nproductRoot: specs\n');
  assert.throws(() => loadDdduckConfig(repo), /^Error: \.config\/ddduck\.yml: schemaVersion must be "1"/);
});

test("loadDdduckConfig accepts JSONC trailing commas, as Prettier writes them", () => {
  const repo = makeRepo();
  writeAt(repo, "ddduck.config.jsonc", '{ "schemaVersion": "1", "ignore": ["out",], "productRoot": "specs", }\n');
  assert.deepEqual(loadDdduckConfig(repo), { schemaVersion: "1", productRoot: "specs", ignore: ["out"] });
});

test("loadDdduckConfig rejects other JSONC parse errors", () => {
  const repo = makeRepo();
  writeAt(repo, "ddduck.config.jsonc", '{ "schemaVersion": "1" "productRoot": "specs" }\n');
  assert.throws(() => loadDdduckConfig(repo), /ddduck\.config\.jsonc: invalid JSONC/);
});

test("loadDdduckConfig rejects invalid YAML, duplicate keys, and non-object documents", () => {
  const repo = makeRepo();
  writeAt(repo, "ddduck.config.yaml", 'schemaVersion: "1"\nproductRoot: a\nproductRoot: b\n');
  assert.throws(() => loadDdduckConfig(repo), /ddduck\.config\.yaml: invalid YAML/);
  writeAt(repo, "ddduck.config.yaml", "- just\n- a list\n");
  assert.throws(() => loadDdduckConfig(repo), /ddduck\.config\.yaml: configuration must be an object/);
});

test("loadDdduckConfig rejects a directory in a config location", () => {
  const repo = makeRepo();
  mkdirSync(path.join(repo, "ddduck.config.json"));
  assert.throws(() => loadDdduckConfig(repo), /ddduck\.config\.json: must be a regular file/);
});

test("initConfigRelativePath prefers an existing .config/ directory and never picks .ddduck/", () => {
  const repo = makeRepo();
  assert.equal(initConfigRelativePath(repo), "ddduck.config.jsonc");
  mkdirSync(path.join(repo, ".ddduck"));
  assert.equal(initConfigRelativePath(repo), "ddduck.config.jsonc");
  mkdirSync(path.join(repo, ".config"));
  assert.equal(initConfigRelativePath(repo), ".config/ddduck.jsonc");
});

test("writeInitConfigIfAbsent treats a config created between discovery and write as pre-existing", (t) => {
  const repo = makeRepo();
  const original = fs.writeFileSync;
  // Simulate a parallel init winning the race: the file appears right before
  // this process's exclusive write, which then fails with EEXIST.
  t.mock.method(fs, "writeFileSync", (filePath, data, options) => {
    if (options?.flag === "wx") original(filePath, '{ "schemaVersion": "1", "productRoot": "other" }\n');
    return original(filePath, data, options);
  });

  const result = writeInitConfigIfAbsent(repo, "ddd");

  t.mock.restoreAll();
  assert.deepEqual(result, {
    configPath: path.join(repo, "ddduck.config.jsonc"),
    repositoryRoot: repo,
    created: false,
  });
  assert.equal(loadDdduckConfig(repo).productRoot, "other", "the concurrent config must be left untouched");
});

test("writeInitConfigIfAbsent still surfaces write failures other than EEXIST", (t) => {
  const repo = makeRepo();
  t.mock.method(fs, "writeFileSync", () => {
    throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
  });
  assert.throws(() => writeInitConfigIfAbsent(repo, "ddd"), /disk full/);
});
