#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildModelOverview } from "./generate-docs.mjs";
import { resolveProductRoot } from "./lib/product-root-resolver.mjs";

const outputPath = path.join("generated", "docs", "model-overview.md");

function staleMessage(root) {
  return `${outputPath} is missing or stale; run ddduck generate --root ${root}`;
}

export function checkGeneratedDocs(rootPath) {
  const root = path.resolve(rootPath);
  const expected = buildModelOverview(root);
  let actual;
  try {
    actual = readFileSync(path.join(root, outputPath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(staleMessage(root));
    throw error;
  }
  if (actual !== expected) throw new Error(staleMessage(root));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  try {
    checkGeneratedDocs(resolveProductRoot({ explicitRoot: options.root }));
    if (options.verbose) console.log("generated docs ok");
  } catch (error) {
    console.error(error.message);
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
