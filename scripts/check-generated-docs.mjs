#!/usr/bin/env node

/**
 * Freshness gate for the generated docs view: rebuilds
 * generated/docs/model-overview.md from the canonical YAML and compares it
 * byte-for-byte against the committed file. Consumed by `ddduck check` and the
 * staged operation runner (both import checkGeneratedDocs); also runnable
 * standalone, where a stale view exits 1 with a regenerate remedy.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildModelOverview } from "./generate-docs.mjs";
import { resolveProductRoot } from "./lib/product-root-resolver.mjs";

const outputPath = path.join("generated", "docs", "model-overview.md");

// The message states the fact only, so callers that add their own next-action
// line never state the remedy twice; `remedy` carries the regenerate hint for
// callers with no next-action surface (the standalone gate below).
function staleError(root) {
  const error = new Error(`${outputPath} is missing or stale`);
  error.remedy = `run ddduck generate --root ${root}`;
  return error;
}

/**
 * Throw if generated/docs/model-overview.md is missing or differs from the
 * output rebuilt from the current canonical YAML.
 * @param {string} rootPath - Product root path.
 * @returns {void}
 */
export function checkGeneratedDocs(rootPath) {
  const root = path.resolve(rootPath);
  const expected = buildModelOverview(root);
  let actual;
  try {
    actual = readFileSync(path.join(root, outputPath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw staleError(root);
    throw error;
  }
  if (actual !== expected) throw staleError(root);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  try {
    checkGeneratedDocs(resolveProductRoot({ explicitRoot: options.root }));
    if (options.verbose) console.log("generated docs ok");
  } catch (error) {
    console.error(error.remedy ? `${error.message}; ${error.remedy}` : error.message);
    process.exit(1);
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
