import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { checkGeneratedGraphSvg } from "../scripts/check-generated-graph-svg.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const referenceProduct = path.join(here, "..", "examples", "reminders", "ddd");

async function withProductCopy(run) {
  const root = mkdtempSync(path.join(tmpdir(), "ddduck-graph-svg-"));
  try {
    cpSync(referenceProduct, root, { recursive: true });
    return await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("checkGeneratedGraphSvg accepts a freshly generated canonical SVG", async () => {
  await withProductCopy(async (root) => {
    await assert.doesNotReject(() => checkGeneratedGraphSvg(root));
  });
});

test("checkGeneratedGraphSvg rejects a stale SVG", async () => {
  await withProductCopy(async (root) => {
    writeFileSync(path.join(root, "generated", "graph", "model-graph.svg"), "<svg>stale</svg>\n");
    await assert.rejects(() => checkGeneratedGraphSvg(root), /missing or stale/);
  });
});

test("checkGeneratedGraphSvg rejects a missing SVG", async () => {
  await withProductCopy(async (root) => {
    rmSync(path.join(root, "generated", "graph", "model-graph.svg"), { force: true });
    await assert.rejects(() => checkGeneratedGraphSvg(root), /missing or stale/);
  });
});
