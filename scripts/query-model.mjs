#!/usr/bin/env node

/**
 * Implements `ddduck query`, the read-only query surface: dispatches the
 * operations node, neighbors, impact, anchors, spec, and context to
 * lib/product-query.mjs and lib/context-pack.mjs, emitting exactly one JSON
 * document on stdout. The product root auto-resolves (enclosing directory,
 * config, or unique discovery) unless --root is passed; busy or interrupted
 * roots are refused before any answer is served. Also imported by ddduck.mjs
 * and the agent-readiness evals as the runQuery entry point.
 */

import { fileURLToPath } from "node:url";
import { resolveContextPack } from "./lib/context-pack.mjs";
import { resolveProductRoot } from "./lib/product-root-resolver.mjs";
import {
  loadQueryProduct,
  queryAnchors,
  queryImpact,
  queryNeighbors,
  queryNode,
  querySpec,
} from "./lib/product-query.mjs";
import { CliUsageError, parseCommandArgs, renderHelp, writeCliError } from "./lib/cli-contract.mjs";

/**
 * Parse and run one query invocation, writing the JSON document to stdout.
 * @param {string[]} args - Arguments after the `query` command word.
 * @param {{cwd?: string, stdout?: {write: (chunk: string) => unknown}}} [io] - Working directory for root resolution and the output stream (used by the evals harness to capture output).
 * @returns {void}
 */
export function runQuery(args, { cwd = process.cwd(), stdout = process.stdout } = {}) {
  if (args.includes("--help")) {
    stdout.write(renderHelp("query"));
    return;
  }
  const { positionals, options } = parseCommandArgs(args, {
    positionals: { min: 1, max: 1 },
    options: { id: { value: true, repeatable: true }, root: { value: true }, history: {}, json: {} },
  });
  const [operation] = positionals;
  if (!operation || !["node", "neighbors", "impact", "anchors", "spec", "context"].includes(operation)) {
    throw new CliUsageError("query requires operation node, neighbors, impact, anchors, spec, or context");
  }
  const ids = options.id;
  const id = ids[0];
  if (operation !== "context" && ids.length > 1) throw new CliUsageError(`query ${operation} accepts exactly one --id`);
  if (operation === "context" && options.history) throw new CliUsageError("query context does not support --history");
  if (operation !== "spec" && !id) throw new CliUsageError(`query ${operation} requires --id <model-node-id>`);

  const root = resolveProductRoot({ cwd, explicitRoot: options.root });
  const product = loadQueryProduct(root, { history: options.history });
  if (operation === "spec" && id && id !== product.rootModelId) {
    throw new CliUsageError(`query spec --id must be ${product.rootModelId}`);
  }
  const document = {
    node: () => queryNode(product, id, { history: options.history }),
    neighbors: () => queryNeighbors(product, id, { history: options.history }),
    impact: () => queryImpact(product, id, { history: options.history }),
    anchors: () => queryAnchors(product, id, { history: options.history }),
    spec: () => querySpec(product, { history: options.history }),
    context: () => resolveContextPack(product, ids),
  }[operation]();
  stdout.write(`${JSON.stringify(document)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runQuery(process.argv.slice(2));
  } catch (error) {
    writeCliError(error, {
      nextAction: "Run ddduck query --help, correct the input, and retry.",
    });
  }
}
