#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildModelGraph } from "./generate-graph.mjs";
import { buildModelGraphSvg, svgOutputPath } from "./generate-graph-svg.mjs";
import { resolveProductRoot } from "./lib/product-root-resolver.mjs";

function staleMessage(root) {
  return `${svgOutputPath} is missing or stale; run ddduck generate --root ${root}`;
}

// Pin the canonical SVG byte-for-byte: rebuild it from the source model and
// compare against the committed file. Deterministic because @hpcc-js/wasm is
// version-pinned in the lockfile (the SVG embeds its Graphviz version).
export async function checkGeneratedGraphSvg(rootPath) {
  const root = path.resolve(rootPath);
  const expected = await buildModelGraphSvg(buildModelGraph(root));
  let actual;
  try {
    actual = readFileSync(path.join(root, svgOutputPath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(staleMessage(root));
    throw error;
  }
  if (actual !== expected) throw new Error(staleMessage(root));
}

function parseArgs(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") {
      parsed.root = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--verbose") {
      parsed.verbose = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  try {
    await checkGeneratedGraphSvg(resolveProductRoot({ explicitRoot: options.root }));
    if (options.verbose) console.log("generated graph svg ok");
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
