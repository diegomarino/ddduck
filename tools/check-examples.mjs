#!/usr/bin/env node

/**
 * Repository gate for the example products: every `examples/<name>/ddd` that
 * holds a product.yaml must validate, and its generated views (docs, graph
 * JSON/NDJSON, SVG) must be byte-identical to a fresh regeneration. Markdown
 * under `examples/<name>/` is checked for documentation references against that
 * example's own product (generated/ excluded), not against the framework's
 * self-model; the repository-wide `check:model` gate excludes examples/ for
 * that reason. Directories without ddd/product.yaml are skipped. Exports
 * checkExamples for tests; runs standalone as a CLI (exit 1 on any failure).
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateProduct } from "../scripts/check-model.mjs";
import { checkGeneratedDocs } from "../scripts/check-generated-docs.mjs";
import { checkGeneratedGraph } from "../scripts/check-generated-graph.mjs";
import { checkGeneratedGraphSvg } from "../scripts/check-generated-graph-svg.mjs";

const defaultExamplesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "examples");

/**
 * List the example product roots (`<examplesRoot>/<name>/ddd` with a product.yaml).
 * @param {string} examplesRoot - Directory holding one subdirectory per example.
 * @returns {{name: string, exampleDir: string, productRoot: string}[]} Examples sorted by name.
 */
export function listExampleProducts(examplesRoot) {
  return readdirSync(examplesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const exampleDir = path.join(examplesRoot, entry.name);
      return { name: entry.name, exampleDir, productRoot: path.join(exampleDir, "ddd") };
    })
    .filter(({ productRoot }) => existsSync(path.join(productRoot, "product.yaml")))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Validate every example product and the freshness of its generated views.
 * @param {string} [examplesRoot] - Examples directory; defaults to this checkout's examples/.
 * @returns {Promise<{name: string, errors: string[]}[]>} One entry per example; empty errors means it passed.
 */
export async function checkExamples(examplesRoot = defaultExamplesRoot) {
  const results = [];
  for (const { name, exampleDir, productRoot } of listExampleProducts(path.resolve(examplesRoot))) {
    const check = validateProduct(productRoot, {
      documentationRoots: [exampleDir, productRoot],
      sourceOnly: true,
    });
    const errors = [...check.errors];
    // Freshness is only meaningful for a valid source model.
    if (errors.length === 0) {
      for (const gate of [checkGeneratedDocs, checkGeneratedGraph, checkGeneratedGraphSvg]) {
        try {
          await gate(productRoot);
        } catch (error) {
          errors.push(error.remedy ? `${error.message}; ${error.remedy}` : error.message);
        }
      }
    }
    results.push({ name, errors });
  }
  return results;
}

function parseArgs(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--examples-root") {
      parsed.examplesRoot = args[index + 1];
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
  const results = await checkExamples(options.examplesRoot ?? defaultExamplesRoot);
  const failures = results.filter(({ errors }) => errors.length > 0);
  for (const { name, errors } of failures) {
    console.error(`examples/${name}:\n${errors.map((error) => `  ${error}`).join("\n")}`);
  }
  if (failures.length > 0) process.exit(1);
  if (options.verbose) console.log(`examples=${results.map(({ name }) => name).join(",")} ok`);
}
