#!/usr/bin/env node

/**
 * Freshness gate for the canonical SVG view generated/graph/model-graph.svg.
 * Rendering uses the async Graphviz WASM engine, so unlike the docs and
 * JSON/NDJSON gates this one is always executed as a child process by
 * `ddduck check`, the staged operation runner, and query freshness — never
 * imported into their synchronous flows. Standalone runs exit 1 on a missing
 * or stale SVG with a regenerate remedy.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildModelGraph } from "./generate-graph.mjs";
import { buildModelGraphSvg, svgOutputPath } from "./generate-graph-svg.mjs";
import { resolveProductRoot } from "./lib/product-root-resolver.mjs";

// The message states the fact only, so callers that add their own next-action
// line never state the remedy twice; `remedy` carries the regenerate hint for
// callers with no next-action surface (the standalone gate below).
function staleError(root) {
  const error = new Error(`${svgOutputPath} is missing or stale`);
  error.remedy = `run ddduck generate --root ${root}`;
  return error;
}

/**
 * Pin the canonical SVG byte-for-byte: rebuild it from the source model and
 * compare against the committed file. Deterministic because @hpcc-js/wasm is
 * version-pinned in the lockfile (the SVG embeds its Graphviz version).
 * @param {string} rootPath - Product root path.
 * @returns {Promise<void>} Rejects when the SVG is missing or stale.
 */
export async function checkGeneratedGraphSvg(rootPath) {
  const root = path.resolve(rootPath);
  const expected = await buildModelGraphSvg(buildModelGraph(root));
  let actual;
  try {
    actual = readFileSync(path.join(root, svgOutputPath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw staleError(root);
    throw error;
  }
  if (actual !== expected) throw staleError(root);
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
    console.error(error.remedy ? `${error.message}; ${error.remedy}` : error.message);
    process.exit(1);
  }
}
