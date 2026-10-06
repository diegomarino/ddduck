import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";
import { PassThrough } from "node:stream";
import { setImmediate } from "node:timers";
import { parse } from "yaml";
import { resolveInitInput } from "../scripts/lib/init-input.mjs";
import { shellQuote } from "../scripts/lib/context-pack.mjs";

const cli = fileURLToPath(new URL("../scripts/ddduck.mjs", import.meta.url));

function repository(t, name = "My App") {
  const temporary = mkdtempSync(path.join(tmpdir(), "ddduck-init-ux-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, name);
  mkdirSync(path.join(root, ".git"), { recursive: true });
  return root;
}

function run(cwd, args) {
  return spawnSync(process.execPath, [cli, "init", ...args], { cwd, encoding: "utf8" });
}

test("init --yes infers identity from the repository and keeps source inside ddd", (t) => {
  const root = repository(t);
  const result = run(root, ["--yes", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.affectedIds, ["model:my-app"]);
  assert.equal(result.stderr, "");
  assert.equal(existsSync(path.join(root, "product.yaml")), false);
  const product = parse(readFileSync(path.join(root, "ddd", "product.yaml"), "utf8"));
  assert.equal(product.name, "My App");
  assert.equal(product.id, "model:my-app");
  assert.equal(JSON.parse(readFileSync(path.join(root, ".ddduck", "config.json"))).productRoot, "ddd");
  assert.equal(existsSync(path.join(root, "ddd", "generated", "graph", "model-graph.svg")), true);
});

test("init --yes uses repository identity from a subdirectory and honors a configured destination", (t) => {
  const root = repository(t, "Café Tools");
  mkdirSync(path.join(root, ".ddduck"));
  const config = JSON.stringify({ schemaVersion: "1", productRoot: "specs" });
  writeFileSync(path.join(root, ".ddduck", "config.json"), config);
  const nested = path.join(root, "src");
  mkdirSync(nested);
  const result = run(nested, ["--yes"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(parse(readFileSync(path.join(root, "specs", "product.yaml"), "utf8")).id, "model:cafe-tools");
  assert.equal(readFileSync(path.join(root, ".ddduck", "config.json"), "utf8"), config);
});

test("init explicit name, ID, and destination override inferred answers", (t) => {
  const root = repository(t);
  const result = run(root, ["specs", "--name", "Library", "--id", "model:catalog", "--yes"]);
  assert.equal(result.status, 0, result.stderr);
  const product = parse(readFileSync(path.join(root, "specs", "product.yaml"), "utf8"));
  assert.equal(product.name, "Library");
  assert.equal(product.id, "model:catalog");
  assert.equal(existsSync(path.join(root, "ddd")), false);
  assert.ok(result.stdout.includes(path.join(root, "specs", "product.yaml")));
  assert.ok(result.stdout.includes("ddduck generate"));
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "ddduck"), `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(cli)} "$@"\n`, {
    mode: 0o755,
  });
  const nextCommand = result.stdout.match(/ddduck generate --root .+/)[0];
  const check = spawnSync("/bin/sh", ["-c", nextCommand], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  assert.equal(check.status, 0, check.stderr);
});

test("init --name derives the ID without treating the destination as identity", (t) => {
  const root = repository(t);
  const result = run(root, ["specs", "--name", "Reading Room", "--yes"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(parse(readFileSync(path.join(root, "specs", "product.yaml"), "utf8")).id, "model:reading-room");
});

test("init without --yes fails promptly on noninteractive input and writes nothing", (t) => {
  const root = repository(t);
  for (const args of [[], ["--json"], ["--id", "model:sample"]]) {
    const result = run(root, args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--yes/);
    assert.equal(result.stdout, "");
  }
  assert.equal(existsSync(path.join(root, "ddd")), false);
  assert.equal(existsSync(path.join(root, ".ddduck")), false);
});

test("init rejects unusable inferred identity before creating directories", (t) => {
  const root = repository(t, "💡");
  const result = run(root, ["nested/specs", "--yes"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--id/);
  assert.equal(existsSync(path.join(root, "nested")), false);
});

test("init --yes preserves occupied destinations and rejects --force", (t) => {
  const root = repository(t);
  mkdirSync(path.join(root, "ddd"));
  writeFileSync(path.join(root, "ddd", "keep.txt"), "keep these bytes\n");
  for (const args of [["--yes"], ["--yes", "--force"]]) {
    const result = run(root, args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
  }
  assert.equal(readFileSync(path.join(root, "ddd", "keep.txt"), "utf8"), "keep these bytes\n");
  assert.equal(existsSync(path.join(root, ".ddduck")), false);
});

test("interactive init pre-fills editable answers and derives ID from the edited name", async (t) => {
  const root = repository(t);
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = output.isTTY = true;
  let transcript = "";
  const answers = [
    ["Product name: ", "My App", "\x15Reading Room\r"],
    ["Model ID: ", "model:reading-room", "\r"],
    ["Product directory: ", "ddd", "\x15specs\r"],
  ];
  let next = 0;
  output.on("data", (chunk) => {
    transcript += chunk.toString();
    if (next < answers.length && transcript.includes(answers[next][0])) {
      const [, expected, keys] = answers[next++];
      setImmediate(() => {
        assert.ok(transcript.includes(expected), `missing pre-filled value ${expected}`);
        input.write(keys);
      });
    }
  });
  const result = await resolveInitInput([], { cwd: root, input, output });
  assert.equal(result.name, "Reading Room");
  assert.equal(result.productId, "model:reading-room");
  assert.equal(result.destination, path.join(root, "specs"));
  assert.equal(next, 3);
  assert.equal(existsSync(path.join(root, "specs")), false);
});

test("interactive init skips explicitly supplied answers", async (t) => {
  const root = repository(t);
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = output.isTTY = true;
  let transcript = "";
  output.on("data", (chunk) => {
    transcript += chunk.toString();
  });
  const result = await resolveInitInput(["specs", "--name", "Library", "--id", "model:library"], {
    cwd: root,
    input,
    output,
  });
  assert.equal(result.name, "Library");
  assert.equal(result.destination, path.join(root, "specs"));
  assert.equal(transcript, "");
});

test("interactive cancellation and closed input reject without creating anything", async (t) => {
  const root = repository(t);
  for (const keys of ["\x03", "\x04"]) {
    const input = new PassThrough();
    const output = new PassThrough();
    input.isTTY = output.isTTY = true;
    output.once("data", () =>
      setImmediate(() => {
        if (keys === "\x04") input.end();
        else input.write(keys);
      }),
    );
    await assert.rejects(resolveInitInput([], { cwd: root, input, output }), /cancelled.*nothing was created/);
  }
  assert.equal(existsSync(path.join(root, "ddd")), false);
  assert.equal(existsSync(path.join(root, ".ddduck")), false);
});

test("cancellation arriving with the final answer still prevents initialization", async (t) => {
  const root = repository(t);
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = output.isTTY = true;
  output.once("data", () => setImmediate(() => input.write("\r\x03")));
  await assert.rejects(
    resolveInitInput(["--name", "Library", "--id", "model:library"], { cwd: root, input, output }),
    /cancelled.*nothing was created/,
  );
});
