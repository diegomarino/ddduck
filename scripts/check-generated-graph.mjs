#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildModelGraphOutputs, jsonOutputPath, ndjsonOutputPath } from "./generate-graph.mjs";
import { resolveProductRoot } from "./lib/product-root-resolver.mjs";

function staleMessage(relativePath, root) {
  return `${relativePath} is missing or stale; run ddduck generate --root ${root}`;
}

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
      throw new Error(staleMessage(relativePath, root));
    }
    throw error;
  }

  if (actual !== expected) {
    throw new Error(staleMessage(relativePath, root));
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
    console.error(error.message);
    process.exit(1);
  }
}
