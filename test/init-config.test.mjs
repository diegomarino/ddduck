import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { configCandidates, loadDdduckConfig } from "../scripts/lib/ddduck-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "scripts", "ddduck.mjs");

function makeRepo(prefix) {
  const repo = mkdtempSync(path.join(tmpdir(), prefix));
  mkdirSync(path.join(repo, ".git"), { recursive: true });
  return repo;
}

function init(repo) {
  return spawnSync(process.execPath, [cli, "init", "--yes", "ddd", "--id", "model:sample"], {
    cwd: repo,
    encoding: "utf8",
  });
}

test("init writes a commented ddduck.config.jsonc with every option when no config exists", () => {
  const repo = makeRepo("ddduck-init-config-");

  const result = init(repo);

  assert.equal(result.status, 0, result.stderr);
  const source = readFileSync(path.join(repo, "ddduck.config.jsonc"), "utf8");
  assert.match(source, /^\/\/ ddduck repository configuration/);
  for (const key of ["schemaVersion", "productRoot", "ignore"]) {
    assert.match(source, new RegExp(`// .*\\n(?:  // .*\\n)*  "${key}"`), `${key} must be documented by a comment`);
  }
  assert.deepEqual(loadDdduckConfig(repo), {
    schemaVersion: "1",
    productRoot: "ddd",
    ignore: ["vendor", "target", "build", "dist", "__pycache__"],
  });
  assert.equal(existsSync(path.join(repo, ".ddduck")), false, "init must not create .ddduck/ just for config");
});

test("init writes .config/ddduck.jsonc when the repository already has a .config directory", () => {
  const repo = makeRepo("ddduck-init-config-dir-");
  mkdirSync(path.join(repo, ".config"));

  const result = init(repo);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(path.join(repo, ".config", "ddduck.jsonc")), true);
  assert.equal(existsSync(path.join(repo, "ddduck.config.jsonc")), false);
  assert.equal(loadDdduckConfig(repo).productRoot, "ddd");
});

for (const candidate of [".ddduck/config.json", ".config/ddduck.yaml", "ddduck.config.json"]) {
  test(`init does not clobber an existing ${candidate} or add a second config`, () => {
    const repo = makeRepo("ddduck-init-config-keep-");
    mkdirSync(path.dirname(path.join(repo, candidate)), { recursive: true });
    const existing = candidate.endsWith(".yaml")
      ? 'schemaVersion: "1"\nproductRoot: ddd\nignore: []\n'
      : `${JSON.stringify({ schemaVersion: "1", productRoot: "ddd", ignore: [] }, null, 2)}\n`;
    writeFileSync(path.join(repo, candidate), existing);

    const result = init(repo);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(path.join(repo, candidate), "utf8"), existing);
    assert.deepEqual(
      configCandidates.filter((other) => existsSync(path.join(repo, other))),
      [candidate],
    );
  });
}

test(
  "init rolls back the published product when the config write fails so a retry is not blocked",
  { skip: process.getuid?.() === 0 ? "root ignores directory permissions" : false },
  () => {
    const repo = makeRepo("ddduck-init-config-fail-");
    // A read-only .config directory selects .config/ddduck.jsonc as the target
    // and makes the config write fail after the product tree is published.
    mkdirSync(path.join(repo, ".config"));
    chmodSync(path.join(repo, ".config"), 0o555);

    try {
      const result = init(repo);

      assert.notEqual(result.status, 0, "init must fail when it cannot write the config");
      assert.equal(
        existsSync(path.join(repo, "ddd")),
        false,
        "the published product directory must be rolled back so a corrected retry is not refused",
      );
    } finally {
      chmodSync(path.join(repo, ".config"), 0o755);
    }
  },
);

test("check --root reports a conflicting repository config as a validation error, not a crash", () => {
  const repo = makeRepo("ddduck-check-config-conflict-");
  assert.equal(init(repo).status, 0);
  mkdirSync(path.join(repo, ".ddduck"));
  writeFileSync(path.join(repo, ".ddduck", "config.json"), '{"schemaVersion":"1","productRoot":"ddd"}\n');

  const result = spawnSync(process.execPath, [cli, "check", "--root", "ddd"], { cwd: repo, encoding: "utf8" });

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /repository config: Multiple ddduck configuration files found .*: ddduck\.config\.jsonc, \.ddduck\/config\.json; keep exactly one/,
  );
  assert.doesNotMatch(result.stderr, /at findDdduckConfigFile/);
});

test("parallel inits of sibling destinations all publish and leave exactly one config", async () => {
  const repo = makeRepo("ddduck-init-config-race-");
  const destinations = Array.from({ length: 6 }, (_, index) => `apps/p${index}/ddd`);

  const results = await Promise.all(
    destinations.map(
      (destination, index) =>
        new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [cli, "init", "--yes", destination, "--id", `model:p${index}`], {
            cwd: repo,
          });
          let stderr = "";
          child.stderr.setEncoding("utf8");
          child.stderr.on("data", (chunk) => (stderr += chunk));
          child.on("error", reject);
          child.on("close", (status) => resolve({ status, stderr }));
        }),
    ),
  );

  for (const [index, result] of results.entries()) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(path.join(repo, destinations[index], "product.yaml")), true);
  }
  assert.deepEqual(
    configCandidates.filter((candidate) => existsSync(path.join(repo, candidate))),
    ["ddduck.config.jsonc"],
  );
  assert.ok(destinations.includes(loadDdduckConfig(repo).productRoot));
});
