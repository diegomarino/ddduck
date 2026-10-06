import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

test("commit-msg accepts project conventions and rejects malformed messages", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "ddduck-commitlint-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const messageFile = path.join(directory, "commit message");
  for (const [message, expected] of [
    ["fix(cli): Node.js PATH resolution\n\n" + "a".repeat(230), 0],
    ["chore(main): release ddduck 0.3.2 (#20)\n\nCo-authored-by: Bot <" + "a".repeat(100) + "@example.com>", 0],
    ["feat(api)!: change response shape", 0],
    ["Merge branch 'feature'", 0],
    ["update dependencies", 1],
    ["feature: add flag", 1],
    ["fix: " + "a".repeat(96), 1],
  ]) {
    writeFileSync(messageFile, message + "\n");
    const result = spawnSync("sh", [".husky/commit-msg", messageFile], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${path.join(root, "node_modules/.bin")}${path.delimiter}${process.env.PATH}` },
    });
    assert.equal(result.status, expected, result.stdout + result.stderr);
  }
});
