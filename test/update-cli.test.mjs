import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";
import { shellQuote } from "../scripts/lib/context-pack.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dependencies = createRequire(import.meta.url)
  .resolve.paths("yaml")
  .find((directory) => existsSync(path.join(directory, "yaml", "package.json")));

test("update rejects unsupported hosts before calling npm", () => {
  for (const platform of ["win32", "freebsd"]) {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)} });
      const { updateCli } = await import(${JSON.stringify(new URL("../scripts/lib/update-cli.mjs", import.meta.url).href)});
      updateCli({ frameworkRoot: ${JSON.stringify(root)}, assumeYes: true });
    `,
      ],
      { encoding: "utf8", env: { ...process.env, PATH: "" } },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /update supports macOS and Linux only/);
    assert.doesNotMatch(result.stderr, /npm .*failed/);
  }
});

function fixture(t, options = {}) {
  const temporary = mkdtempSync(path.join(tmpdir(), "ddduck-update-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const prefix = path.join(temporary, "prefix with spaces");
  const globalRoot = path.join(prefix, "lib", "node_modules");
  const globalPackage = path.join(globalRoot, "ddduck");
  const packageRoot = options.linked || options.local ? path.join(temporary, "checkout") : globalPackage;
  mkdirSync(packageRoot, { recursive: true });
  mkdirSync(globalRoot, { recursive: true });
  if (options.linked) symlinkSync(packageRoot, globalPackage);
  for (const directory of ["scripts", "schemas", "policies"]) {
    cpSync(path.join(root, directory), path.join(packageRoot, directory), { recursive: true });
  }
  symlinkSync(dependencies, path.join(packageRoot, "node_modules"));
  const manifest = {
    ...JSON.parse(readFileSync(path.join(root, "package.json"))),
    version: options.current ?? "0.3.9",
  };
  writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify(manifest));
  const log = path.join(temporary, "npm-calls.jsonl");
  const config = path.join(temporary, "npm-fixture.json");
  writeFileSync(config, JSON.stringify({ prefix, globalRoot, globalPackage, log, latest: "0.3.10", ...options }));
  const npmScript = path.join(temporary, "npm.mjs");
  writeFileSync(
    npmScript,
    `
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const fixture = JSON.parse(readFileSync(process.env.DDDUCK_UPDATE_FIXTURE));
const args = process.argv.slice(2);
appendFileSync(fixture.log, JSON.stringify(args) + "\\n");
if (fixture.fail === args[0]) {
  process.stderr.write("fixture npm failure\\n");
  process.exit(1);
}
if (args[0] === "prefix") console.log(fixture.prefix);
else if (args[0] === "root") console.log(fixture.globalRoot);
else if (args[0] === "view") console.log(fixture.invalidJson ? "not json" : JSON.stringify(fixture.latest));
else if (args[0] === "install") {
  const file = path.join(fixture.globalPackage, "package.json");
  const manifest = JSON.parse(readFileSync(file));
  manifest.version = fixture.resultVersion ?? args.find(value => value.startsWith("ddduck@")).slice(7);
  writeFileSync(file, JSON.stringify(manifest));
} else process.exit(2);
`,
  );
  const bin = path.join(temporary, "bin");
  mkdirSync(bin);
  writeFileSync(
    path.join(bin, "npm"),
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(npmScript)} "$@"\n`,
    { mode: 0o755 },
  );
  return {
    packageRoot,
    prefix,
    run(args = [], input = "") {
      return spawnSync(process.execPath, [path.join(packageRoot, "scripts", "ddduck.mjs"), "update", ...args], {
        encoding: "utf8",
        input,
        env: { ...process.env, DDDUCK_UPDATE_FIXTURE: config, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
      });
    },
    calls() {
      try {
        return readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
    },
    version() {
      return JSON.parse(readFileSync(path.join(packageRoot, "package.json"))).version;
    },
  };
}

test("update pins the displayed version and global prefix, then verifies the updated CLI", (t) => {
  const installed = fixture(t);
  const result = installed.run(["--yes"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(installed.version(), "0.3.10");
  assert.match(result.stdout, /0\.3\.9/);
  assert.match(result.stdout, /0\.3\.10/);
  assert.match(result.stdout, /Updated ddduck/);
  assert.match(result.stdout, /ddduck install skill/);
  assert.deepEqual(
    installed.calls().find((args) => args[0] === "view"),
    ["view", "--global", "--prefix", installed.prefix, "ddduck@latest", "version", "--json"],
  );
  const installation = installed.calls().find((args) => args[0] === "install");
  assert.deepEqual(installation, [
    "install",
    "--global",
    "--prefix",
    installed.prefix,
    "--engine-strict",
    "--force=false",
    "ddduck@0.3.10",
  ]);
});

test("update requires confirmation and closed input never installs unattended", (t) => {
  for (const input of ["", "n\n", "y\n"]) {
    const installed = fixture(t);
    const result = installed.run([], input);
    assert.equal(result.status, input === "y\n" ? 0 : 1, result.stderr);
    assert.equal(
      installed.calls().some((args) => args[0] === "install"),
      input === "y\n",
    );
    assert.match(result.stdout, /npm install .*ddduck@0\.3\.10[\s\S]*\[y\/n\]/);
  }
});

test("update skips current versions and never downgrades a newer installed release", (t) => {
  for (const current of ["0.3.10", "0.4.0", "1.0.0"]) {
    const installed = fixture(t, { current });
    const result = installed.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(installed.version(), current);
    assert.equal(
      installed.calls().some((args) => args[0] === "install"),
      false,
    );
    assert.doesNotMatch(result.stdout, /\[y\/n\]/);
  }
});

test("update refuses local and npm-linked checkouts before querying or installing", (t) => {
  for (const options of [{ local: true }, { linked: true }]) {
    const installed = fixture(t, options);
    const result = installed.run(["--yes"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /global|linked|checkout/);
    assert.equal(
      installed.calls().some((args) => ["view", "install"].includes(args[0])),
      false,
    );
    assert.equal(installed.version(), "0.3.9");
  }
});

test("update reports npm and verification failures without claiming success", (t) => {
  for (const options of [{ fail: "prefix" }, { fail: "view" }, { fail: "install" }, { resultVersion: "0.3.9" }]) {
    const installed = fixture(t, options);
    const result = installed.run(["--yes"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Error: .*Next:/);
    assert.doesNotMatch(result.stdout, /Updated ddduck/);
  }
});

test("update validates registry output and declines unsupported prerelease builds", (t) => {
  for (const options of [{ invalidJson: true }, { latest: "invalid" }, { current: "0.4.0-beta.1" }]) {
    const installed = fixture(t, options);
    const result = installed.run(["--yes"]);
    assert.equal(result.status, 1);
    assert.equal(
      installed.calls().some((args) => args[0] === "install"),
      false,
    );
  }
});

test("update help is available without npm or product state and rejects unknown flags", () => {
  const cli = path.join(root, "scripts", "ddduck.mjs");
  const help = spawnSync(process.execPath, [cli, "update", "--help"], {
    encoding: "utf8",
    env: { ...process.env, PATH: "" },
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Syntax: ddduck update/);
  assert.match(help.stdout, /--yes/);
  const invalid = spawnSync(process.execPath, [cli, "update", "--force"], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown option --force/);
});
