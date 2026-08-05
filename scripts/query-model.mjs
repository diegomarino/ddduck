#!/usr/bin/env node

import path from "node:path";
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
  if (operation === "context") {
    if (options.history) throw new CliUsageError("query context does not support --history");
    if (!options.root) throw new CliUsageError("query context requires --root <product-root>");
  }
  if (operation !== "spec" && !id) throw new CliUsageError(`query ${operation} requires --id <model-node-id>`);

  const root =
    operation === "context" ? path.resolve(cwd, options.root) : resolveProductRoot({ cwd, explicitRoot: options.root });
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
