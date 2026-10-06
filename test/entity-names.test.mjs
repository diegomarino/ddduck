import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildModelGraph } from "../scripts/generate-graph.mjs";
for (const name of [undefined, "Readable entity title", ""]) {
  test(`Guarantee and Relationship names ${name === undefined ? "remain optional" : name ? "reach the graph" : "reject empty values"}`, () => {
    const root = mkdtempSync(path.join(tmpdir(), "ddduck-entity-names-"));
    try {
      cpSync("examples/reminders/ddd", root, { recursive: true });
      const targets = ["guarantees", "relationships"].map((folder) =>
        path.join(
          root,
          "model",
          folder,
          readdirSync(path.join(root, "model", folder)).find(
            (file) =>
              folder !== "guarantees" ||
              /status: active/.test(readFileSync(path.join(root, "model", folder, file), "utf8")),
          ),
        ),
      );
      for (const file of targets)
        if (name !== undefined) writeFileSync(file, readFileSync(file, "utf8") + `\nname: ${JSON.stringify(name)}\n`);
      const result = spawnSync(process.execPath, ["scripts/check-model.mjs", "--root", root], { encoding: "utf8" });
      if (name === "") {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /name/);
      } else {
        assert.equal(result.status, 0, result.stderr);
        const graph = buildModelGraph(root);
        for (const file of targets) {
          const id = readFileSync(file, "utf8").match(/^id: (.+)$/m)[1];
          assert.equal(graph.nodes.find((node) => node.id === id).name, name ?? null);
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
