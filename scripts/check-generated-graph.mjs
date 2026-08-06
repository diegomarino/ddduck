#!/usr/bin/env node

/**
 * Freshness gate for the generated graph views: rebuilds
 * generated/graph/model-graph.json and .ndjson from the canonical YAML and
 * compares each byte-for-byte against the committed files. Consumed by
 * `ddduck check` and the staged operation runner (both import
 * checkGeneratedGraph); also runnable standalone, where a stale view exits 1
 * with a regenerate remedy.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildModelGraphOutputs, jsonOutputPath, ndjsonOutputPath } from "./generate-graph.mjs";
import { resolveProductRoot } from "./lib/product-root-resolver.mjs";

// The message states the fact only, so callers that add their own next-action
// line never state the remedy twice; `remedy` carries the regenerate hint for
// callers with no next-action surface (the standalone gate below).
function staleError(relativePath, root) {
  const error = new Error(`${relativePath} is missing or stale`);
  error.remedy = `run ddduck generate --root ${root}`;
  return error;
}

/**
 * Throw if model-graph.json or model-graph.ndjson is missing or differs from
 * the outputs rebuilt from the current canonical YAML.
 * @param {string} rootPath - Product root path.
 * @returns {void}
 */
export function checkGeneratedGraph(rootPath) {
  const root = path.resolve(rootPath);
  const expected = buildModelGraphOutputs(root);
  checkOutput(root, jsonOutputPath, expected.json);
  checkOutput(root, ndjsonOutputPath, expected.ndjson);
}

function checkOutput(root, relativePath, expected) {
  let actual;
  try {
    actual = readFileSync(path.join(root, relativePath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw staleError(relativePath, root);
    }
    throw error;
  }

  if (actual !== expected) {
    throw staleError(relativePath, root);
  }
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
    checkGeneratedGraph(resolveProductRoot({ explicitRoot: options.root }));
    if (options.verbose) console.log("generated graph ok");
  } catch (error) {
    console.error(error.remedy ? `${error.message}; ${error.remedy}` : error.message);
    process.exit(1);
  }
}
